/**
 * Validator process entry point.
 *
 * One program, N instances. Each instance:
 *   - serves REST (status, chain, chain validation, admin demo controls)
 *   - accepts direct WebSocket connections from players' browsers
 *   - maintains a full mesh with its peers and gossips votes and blocks
 *
 * Mesh topology: a node dials peers with a LOWER ordinal and accepts inbound
 * from higher ones. That yields exactly one link per pair with no duplicate-
 * connection flapping, and it still reconnects in both directions after a node
 * is killed and revived (the revived node dials down, its seniors dial it).
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import cors from 'cors';
import { WebSocket, WebSocketServer } from 'ws';
import {
  deriveLeaderboard,
  parseMessage,
  validatorIdFor,
  validatorSet,
  VALIDATOR_BASE_PORT,
  VALIDATOR_COUNT,
  type AnyMessage,
  type Block,
  type OutboundMessage,
} from '@reflexchain/protocol';
import { ValidatorNode } from './node.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..', '..', '..');

const ORDINAL = Number(process.env.RFX_NODE_ORDINAL ?? 1);
const VALIDATOR_ID = process.env.RFX_NODE_ID ?? validatorIdFor(ORDINAL);
const PORT = Number(process.env.RFX_NODE_PORT ?? VALIDATOR_BASE_PORT + ORDINAL);
const DATA_DIR = process.env.RFX_DATA_DIR ?? join(REPO_ROOT, 'data');
const EPSILON = process.env.RFX_EPSILON_MS ? Number(process.env.RFX_EPSILON_MS) : undefined;

const node = new ValidatorNode({
  validatorId: VALIDATOR_ID,
  ordinal: ORDINAL,
  port: PORT,
  dataDir: DATA_DIR,
  registeredValidators: VALIDATOR_COUNT,
  epsilonMs: EPSILON,
});

// ---------------------------------------------------------------------------
// Transport state
// ---------------------------------------------------------------------------

/** Live peer links, keyed by the peer's validatorId. */
const peers = new Map<string, WebSocket>();
/** Browser subscribers receiving telemetry. */
const observers = new Set<WebSocket>();

node.peerCount = () => peers.size;

function send(socket: WebSocket, msg: OutboundMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

node.onGossip = (msg) => {
  if (node.offline) return;
  for (const socket of peers.values()) send(socket, msg);
};

node.onTelemetry = (msg) => {
  for (const socket of observers) send(socket, msg);
};

function helloMessage(): OutboundMessage {
  return {
    type: 'HELLO',
    validatorId: node.id,
    publicKey: node.keyPair.publicKey,
    height: node.store.height,
    headHash: node.store.head.hash,
  };
}

// ---------------------------------------------------------------------------
// Message routing (identical for peer links and browser links)
// ---------------------------------------------------------------------------

function routeMessage(socket: WebSocket, msg: AnyMessage): void {
  switch (msg.type) {
    // --- from the player's browser ---
    case 'SUBSCRIBE': {
      observers.add(socket);
      send(socket, { type: 'TELEMETRY_STATUS', status: node.status() });
      break;
    }

    case 'SUBMIT_EVENT': {
      const result = node.handlePressEvent(msg.event);
      send(socket, {
        type: 'ACK',
        ok: result.accepted,
        eventId: msg.event.eventId,
        detail: result.detail,
      });
      break;
    }

    // --- from the coordinator ---
    case 'MATCH_OPEN': {
      node.handleMatchOpen(msg);
      break;
    }

    case 'GO_ANNOUNCE': {
      node.handleGoAnnounce(msg.announce);
      break;
    }

    case 'MATCH_CLOSE':
      break;

    // --- from peers ---
    case 'HELLO': {
      registerPeer(msg.validatorId, socket);

      // Ask for a peer's chain when it is ahead, and ALSO when it is level with
      // us but on a different head. Without the second case two nodes that
      // proposed simultaneously sit on equal-length forks forever, because
      // neither is behind and neither ever asks.
      const behind = msg.height > node.store.height;
      const diverged =
        msg.height === node.store.height && msg.headHash !== node.store.head.hash;

      if (behind || diverged) {
        send(socket, {
          type: 'CHAIN_REQUEST',
          fromHeight: node.store.height,
          requestedBy: node.id,
        });
      }
      break;
    }

    case 'VOTE': {
      node.handlePeerVote(msg.vote);
      break;
    }

    case 'BLOCK_PROPOSAL': {
      node.handleBlockProposal(msg.block);
      break;
    }

    case 'CHAIN_REQUEST': {
      send(socket, {
        type: 'CHAIN_RESPONSE',
        validatorId: node.id,
        blocks: node.store.chain,
        height: node.store.height,
        headHash: node.store.head.hash,
      });
      break;
    }

    case 'CHAIN_RESPONSE': {
      if (node.offline) break;
      if (node.adoptChain(msg.blocks, node.repairRequested)) {
        node.repairRequested = false;
        node.tampered = false;
      }
      break;
    }

    default:
      break;
  }
}

function registerPeer(peerId: string, socket: WebSocket): void {
  if (peerId === node.id) return;
  if (node.offline) {
    if (socket.readyState === WebSocket.OPEN) socket.close();
    return;
  }
  const existing = peers.get(peerId);
  if (existing && existing !== socket && existing.readyState === WebSocket.OPEN) {
    // Keep the established link; drop the duplicate rather than flapping.
    if (socket.readyState === WebSocket.OPEN) socket.close();
    return;
  }
  peers.set(peerId, socket);
  socket.once('close', () => {
    if (peers.get(peerId) === socket) peers.delete(peerId);
  });
}

// ---------------------------------------------------------------------------
// Outbound dialling
// ---------------------------------------------------------------------------

const lowerOrdinalPeers = validatorSet(VALIDATOR_COUNT).filter((v) => v.ordinal < ORDINAL);
const dialling = new Set<string>();

function dialPeers(): void {
  if (node.offline) return;

  for (const peer of lowerOrdinalPeers) {
    if (peers.has(peer.validatorId) || dialling.has(peer.validatorId)) continue;

    dialling.add(peer.validatorId);
    const socket = new WebSocket(peer.wsUrl);

    socket.on('open', () => {
      dialling.delete(peer.validatorId);
      registerPeer(peer.validatorId, socket);
      send(socket, helloMessage());
    });

    socket.on('message', (raw) => {
      const msg = parseMessage(raw.toString());
      if (msg) routeMessage(socket, msg);
    });

    socket.on('error', () => {
      dialling.delete(peer.validatorId);
    });

    socket.on('close', () => {
      dialling.delete(peer.validatorId);
      if (peers.get(peer.validatorId) === socket) peers.delete(peer.validatorId);
    });
  }
}

const dialTimer = setInterval(dialPeers, 2_500);

function dropAllPeers(): void {
  for (const socket of peers.values()) socket.close();
  peers.clear();
  dialling.clear();
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json());

app.get('/status', (_req, res) => {
  res.json(node.status());
});

app.get('/chain', (_req, res) => {
  res.json({
    validatorId: node.id,
    height: node.store.height,
    headHash: node.store.head.hash,
    transactions: node.store.transactionCount,
    blocks: node.store.chain,
  });
});

app.get('/chain/validate', (_req, res) => {
  res.json(node.store.validate());
});

app.get('/leaderboard', (_req, res) => {
  res.json(deriveLeaderboard(node.store.chain));
});

app.get('/peers', (_req, res) => {
  res.json({
    validatorId: node.id,
    connected: [...peers.keys()].sort(),
    expected: validatorSet(VALIDATOR_COUNT)
      .map((v) => v.validatorId)
      .filter((id) => id !== node.id),
  });
});

// --- demo controls ---------------------------------------------------------

app.post('/admin/kill', (_req, res) => {
  node.offline = true;
  dropAllPeers();
  // Peers keep dialling a downed node; drop anything that reconnects until it
  // is revived, so "OFFLINE" means what it says.
  const reaper = setInterval(() => {
    if (!node.offline) {
      clearInterval(reaper);
      return;
    }
    dropAllPeers();
  }, 500);
  reaper.unref?.();
  console.log(`[${node.id}] OFFLINE (admin)`);
  res.json({ ok: true, status: node.status() });
});

app.post('/admin/revive', (_req, res) => {
  node.offline = false;
  console.log(`[${node.id}] REVIVING - dialling peers and requesting chains`);
  dialPeers();
  // Ask whoever is already connected for their chain so we catch up on blocks
  // produced while we were down.
  setTimeout(() => {
    for (const socket of peers.values()) {
      send(socket, {
        type: 'CHAIN_REQUEST',
        fromHeight: node.store.height,
        requestedBy: node.id,
      });
    }
  }, 500);
  res.json({ ok: true, status: node.status() });
});

app.post('/admin/byzantine', (req, res) => {
  const on = req.body?.on !== false;
  node.byzantine = on;
  console.log(`[${node.id}] BYZANTINE=${on}`);
  res.json({ ok: true, status: node.status() });
});

/**
 * Rewrite a block in this node's own ledger.
 *
 * mode 'naive'   -> HASH_MISMATCH on that block.
 * mode 'rehash'  -> block self-consistent, but BAD_PROPOSER_SIGNATURE on it and
 *                   PREVIOUS_HASH_BROKEN on the next one.
 * mode 'cascade' -> whole suffix re-linked: this node's head hash genuinely
 *                   diverges from the honest network (a real fork), and every
 *                   rewritten block fails its proposer signature.
 */
app.post('/admin/tamper', (req, res) => {
  const index = Number(req.body?.blockIndex);
  const field = String(req.body?.field ?? 'winner');
  const value = req.body?.value;
  const mode = (req.body?.mode ?? 'cascade') as 'naive' | 'rehash' | 'cascade';

  if (!['naive', 'rehash', 'cascade'].includes(mode)) {
    res.status(400).json({ ok: false, error: 'mode must be naive, rehash or cascade' });
    return;
  }
  if (!Number.isInteger(index) || index < 1 || index > node.store.height) {
    res.status(400).json({ ok: false, error: `blockIndex must be 1..${node.store.height}` });
    return;
  }

  try {
    const mutated = node.store.tamper(index, { [field]: value } as Partial<Block>, mode);
    node.tampered = true;

    const validation = node.store.validate();
    console.log(
      `[${node.id}] TAMPERED block #${index}.${field} mode=${mode} -> ` +
        `chainValid=${validation.valid} head=${node.store.head.hash.slice(0, 12)}`,
    );
    node.onTelemetry({ type: 'TELEMETRY_STATUS', status: node.status() });
    res.json({ ok: true, mode, block: mutated, validation });
  } catch (error) {
    res.status(400).json({ ok: false, error: (error as Error).message });
  }
});

app.post('/admin/restore', (_req, res) => {
  // Recover the honest chain from a peer rather than from a local backup, so
  // the repair is itself a real synchronisation.
  node.repairRequested = true;
  let asked = 0;
  for (const socket of peers.values()) {
    send(socket, { type: 'CHAIN_REQUEST', fromHeight: -1, requestedBy: node.id });
    asked++;
  }
  res.json({ ok: true, askedPeers: asked, note: 'requested honest chain from peers' });
});

app.post('/admin/epsilon', (req, res) => {
  const value = Number(req.body?.epsilonMs);
  if (!Number.isFinite(value) || value < 0) {
    res.status(400).json({ ok: false, error: 'epsilonMs must be a non-negative number' });
    return;
  }
  node.epsilonMs = value;
  res.json({ ok: true, status: node.status() });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  // A killed node is genuinely unreachable: it refuses inbound links too,
  // rather than quietly staying meshed while reporting itself offline.
  if (node.offline) {
    socket.close();
    return;
  }

  socket.on('message', (raw) => {
    const msg = parseMessage(raw.toString());
    if (msg) routeMessage(socket, msg);
  });
  socket.on('close', () => observers.delete(socket));
  socket.on('error', () => observers.delete(socket));
  send(socket, helloMessage());
});

// Push status to the dashboard on a slow tick so node cards stay live even
// when nothing is happening.
const statusTimer = setInterval(() => {
  node.onTelemetry({ type: 'TELEMETRY_STATUS', status: node.status() });
}, 2_000);

/**
 * Periodic reconciliation.
 *
 * A node can miss a block proposal - a momentary stall, a socket hiccup - and
 * without this it would sit behind forever, because catch-up otherwise only
 * happens on connect. Re-announcing our height lets any peer that is ahead
 * answer with its chain through the existing HELLO -> CHAIN_REQUEST path.
 */
const syncTimer = setInterval(() => {
  if (node.offline) return;
  for (const socket of peers.values()) send(socket, helloMessage());
}, 4_000);

server.listen(PORT, () => {
  console.log(
    `[${node.id}] listening on ${PORT} | height ${node.store.height} | ` +
      `quorum ${node.threshold}/${VALIDATOR_COUNT} | epsilon ${node.epsilonMs}ms`,
  );
  dialPeers();
});

function shutdown(): void {
  clearInterval(dialTimer);
  clearInterval(statusTimer);
  clearInterval(syncTimer);
  dropAllPeers();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
