/**
 * Deployment gateway.
 *
 * Runs the whole REFLEXCHAIN backend inside a single container and exposes it on
 * one public port, so a hosted frontend can reach every process over TLS.
 *
 *   /socket.io/*     -> coordinator :4000   (prefix preserved; Socket.IO default)
 *   /coordinator/*   -> coordinator :4000   (prefix stripped)
 *   /node-0N/*       -> validator   :700N   (prefix stripped)
 *   /                -> this gateway's own health JSON
 *
 * The validators still address each OTHER as ws://localhost:700X, exactly as
 * they do on a laptop. Only the browser needs public URLs, which is what makes
 * this deployable without rewriting peer discovery.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import httpProxy from 'http-proxy';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const PORT = Number(process.env.PORT ?? 8080);
const VALIDATOR_COUNT = Number(process.env.RFX_VALIDATOR_COUNT ?? 5);
const BASE_PORT = Number(process.env.RFX_VALIDATOR_BASE_PORT ?? 7000);
const COORDINATOR_PORT = Number(process.env.RFX_COORDINATOR_PORT ?? 4000);

const startedAt = Date.now();

// ---------------------------------------------------------------------------
// Child processes
// ---------------------------------------------------------------------------

interface Child {
  name: string;
  entry: string;
  env: Record<string, string>;
  proc: ChildProcess | null;
  restarts: number;
  lastExit: string | null;
}

const children: Child[] = [];

for (let ordinal = 1; ordinal <= VALIDATOR_COUNT; ordinal++) {
  children.push({
    name: `node-0${ordinal}`,
    entry: 'apps/validator/src/index.ts',
    env: {
      RFX_NODE_ORDINAL: String(ordinal),
      RFX_VALIDATOR_COUNT: String(VALIDATOR_COUNT),
      RFX_VALIDATOR_BASE_PORT: String(BASE_PORT),
    },
    proc: null,
    restarts: 0,
    lastExit: null,
  });
}

children.push({
  name: 'coordinator',
  entry: 'apps/coordinator/src/index.ts',
  env: {
    RFX_VALIDATOR_COUNT: String(VALIDATOR_COUNT),
    RFX_COORDINATOR_PORT: String(COORDINATOR_PORT),
  },
  proc: null,
  restarts: 0,
  lastExit: null,
});

let shuttingDown = false;

function launch(child: Child): void {
  if (shuttingDown) return;

  const proc = spawn(process.execPath, ['--import', 'tsx', child.entry], {
    cwd: ROOT,
    env: { ...process.env, ...child.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.proc = proc;

  const pipe = (stream: NodeJS.ReadableStream, isErr: boolean) => {
    let buffer = '';
    stream.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        (isErr ? process.stderr : process.stdout).write(`${child.name.padEnd(11)} ${line}\n`);
      }
    });
  };

  if (proc.stdout) pipe(proc.stdout, false);
  if (proc.stderr) pipe(proc.stderr, true);

  proc.on('exit', (code, signal) => {
    child.proc = null;
    child.lastExit = `code=${code ?? 'null'} signal=${signal ?? 'none'}`;
    if (shuttingDown) return;

    // One crashed validator must not permanently degrade a live demo.
    child.restarts += 1;
    const delay = Math.min(10_000, 500 * child.restarts);
    console.log(`[gateway] ${child.name} exited (${child.lastExit}) - restarting in ${delay}ms`);
    setTimeout(() => launch(child), delay).unref();
  });
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

const proxy = httpProxy.createProxyServer({ ws: true, xfwd: true });

proxy.on('error', (err, _req, res) => {
  console.error('[gateway] proxy error:', err.message);
  const response = res as ServerResponse | undefined;
  if (response && 'writeHead' in response && !response.headersSent) {
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'upstream unavailable', detail: err.message }));
  }
});

interface Route {
  target: string;
  /** Remove the matched prefix before forwarding. */
  strip: string | null;
}

/** Resolve a request path to an upstream, or null if the gateway handles it. */
function resolve(pathname: string): Route | null {
  // Socket.IO must keep its own prefix - the client uses the default /socket.io path.
  if (pathname === '/socket.io' || pathname.startsWith('/socket.io/')) {
    return { target: `http://127.0.0.1:${COORDINATOR_PORT}`, strip: null };
  }

  if (pathname === '/coordinator' || pathname.startsWith('/coordinator/')) {
    return { target: `http://127.0.0.1:${COORDINATOR_PORT}`, strip: '/coordinator' };
  }

  const validator = /^\/node-0([1-9])(?=\/|$)/.exec(pathname);
  if (validator) {
    const ordinal = Number(validator[1]);
    if (ordinal >= 1 && ordinal <= VALIDATOR_COUNT) {
      return {
        target: `http://127.0.0.1:${BASE_PORT + ordinal}`,
        strip: `/node-0${ordinal}`,
      };
    }
  }

  return null;
}

/** Rewrite the URL in place so the upstream sees a root-relative path. */
function applyStrip(req: IncomingMessage, route: Route): void {
  if (!route.strip || !req.url) return;
  const rest = req.url.slice(route.strip.length);
  req.url = rest.startsWith('/') ? rest : `/${rest || ''}` || '/';
}

function health() {
  return {
    service: 'reflexchain-gateway',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    validators: VALIDATOR_COUNT,
    routes: [
      '/socket.io/*  -> coordinator',
      '/coordinator/* -> coordinator',
      ...Array.from({ length: VALIDATOR_COUNT }, (_, i) => `/node-0${i + 1}/* -> validator ${i + 1}`),
    ],
    children: children.map((c) => ({
      name: c.name,
      running: c.proc !== null,
      pid: c.proc?.pid ?? null,
      restarts: c.restarts,
      lastExit: c.lastExit,
    })),
  };
}

const server = createServer((req, res) => {
  const pathname = (req.url ?? '/').split('?')[0] ?? '/';

  // CORS is deliberately NOT set here for proxied routes. The coordinator and
  // every validator already send their own headers via express cors(), and
  // setting them again on the way out produces a duplicated
  // Access-Control-Allow-Origin, which browsers reject as invalid CORS - so the
  // whole frontend would fail with a header the gateway added "to help".
  // Preflights are forwarded upstream for the same reason.
  if (pathname === '/' || pathname === '/health') {
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify(health(), null, 2));
    return;
  }

  const route = resolve(pathname);
  if (!route) {
    res.writeHead(404, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify({ error: 'no route', path: pathname }));
    return;
  }

  applyStrip(req, route);
  proxy.web(req, res, { target: route.target });
});

/**
 * WebSocket upgrades. This is the part that actually matters: every press event,
 * every vote and all telemetry rides an upgraded connection, so a gateway that
 * only proxies plain HTTP would look healthy and do nothing.
 */
server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  const pathname = (req.url ?? '/').split('?')[0] ?? '/';
  const route = resolve(pathname);

  if (!route) {
    socket.destroy();
    return;
  }

  applyStrip(req, route);
  proxy.ws(req, socket, head, { target: route.target }, (err?: Error) => {
    if (err) console.error('[gateway] ws proxy error:', err.message);
    socket.destroy();
  });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

console.log('');
console.log('  REFLEXCHAIN gateway');
console.log(`  validators : ${VALIDATOR_COUNT}`);
console.log(`  public port: ${PORT}`);
console.log('');

for (const child of children) launch(child);

server.listen(PORT, () => {
  console.log(`[gateway] listening on ${PORT}`);
});

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[gateway] shutting down');
  for (const child of children) child.proc?.kill('SIGTERM');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
