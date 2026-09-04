/**
 * Boots the whole REFLEXCHAIN network with one command.
 *
 * 5 validators + 1 coordinator + the Next.js dashboard. Uses spawn with
 * shell:true on Windows so the .cmd shims for npx/next resolve correctly, and
 * forwards a single Ctrl-C to every child so nothing is left holding a port.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const isWindows = process.platform === 'win32';

const VALIDATOR_COUNT = Number(process.env.RFX_VALIDATOR_COUNT ?? 5);
const BASE_PORT = Number(process.env.RFX_VALIDATOR_BASE_PORT ?? 7000);
const includeWeb = !process.argv.includes('--no-web');

const PALETTE = [
  '\x1b[38;5;45m',
  '\x1b[38;5;213m',
  '\x1b[38;5;220m',
  '\x1b[38;5;120m',
  '\x1b[38;5;209m',
  '\x1b[38;5;147m',
  '\x1b[38;5;250m',
];
const RESET = '\x1b[0m';

const children = [];
let shuttingDown = false;

function launch(name, command, args, options = {}) {
  const colour = PALETTE[children.length % PALETTE.length];
  const label = `${colour}${name.padEnd(12)}${RESET}`;

  const child = spawn(command, args, {
    cwd: ROOT,
    shell: isWindows,
    env: { ...process.env, ...options.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const pipe = (stream, isError) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        const out = isError ? process.stderr : process.stdout;
        out.write(`${label} ${line}\n`);
      }
    });
  };

  pipe(child.stdout, false);
  pipe(child.stderr, true);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`${label} exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})`);
  });

  children.push({ name, child });
  return child;
}

console.log('');
console.log('  REFLEXCHAIN  ::  PROOF OF REFLEX(TM)');
console.log('  "The fastest valid reaction becomes the next block."');
console.log('');
console.log(`  validators : ${VALIDATOR_COUNT}  (ports ${BASE_PORT + 1}-${BASE_PORT + VALIDATOR_COUNT})`);
console.log(`  quorum     : ${Math.floor((2 * VALIDATOR_COUNT) / 3) + 1} of ${VALIDATOR_COUNT}`);
console.log('  coordinator: 4000');
if (includeWeb) console.log('  dashboard  : http://localhost:3000');
console.log('');

for (let ordinal = 1; ordinal <= VALIDATOR_COUNT; ordinal++) {
  launch(`node-0${ordinal}`, 'npx', ['tsx', 'apps/validator/src/index.ts'], {
    env: {
      RFX_NODE_ORDINAL: String(ordinal),
      RFX_VALIDATOR_COUNT: String(VALIDATOR_COUNT),
      RFX_VALIDATOR_BASE_PORT: String(BASE_PORT),
    },
  });
}

launch('coordinator', 'npx', ['tsx', 'apps/coordinator/src/index.ts'], {
  env: { RFX_VALIDATOR_COUNT: String(VALIDATOR_COUNT) },
});

if (includeWeb) {
  launch('web', 'npm', ['run', 'dev', '-w', '@reflexchain/web']);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n  shutting down network...');

  for (const { child } of children) {
    if (child.exitCode !== null) continue;
    if (isWindows) {
      // Children were started through a shell, so kill the whole process tree.
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => process.exit(0), 1200);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
