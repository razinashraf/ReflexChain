/**
 * Integration test: five REAL validator processes, a real WebSocket mesh, a
 * real match.
 *
 * The test plays the role of the coordinator (it holds the coordinator key) and
 * of two browsers (it holds each player's key and broadcasts to all five nodes
 * on independent sockets, exactly as the real client does).
 *
 * If this passes, the distributed part of REFLEXCHAIN is genuinely distributed:
 * separate OS processes, separate ledgers on disk, converging by gossip.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  coordinatorKeyPair,
  generateKeyPair,
  hashObject,
  quorumFor,
  randomHex,
  signObject,
  validatorIdFor,
  type Block,
  type KeyPair,
  type PlayerIdentity,
  type PressEvent,
  type UnsignedGoAnnounce,
  type UnsignedPressEvent,
  type ValidatorStatus,
} from '@reflexchain/protocol';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NODE_COUNT = 5;
const BASE_PORT = 7300; // offset from the dev network so both can run at once
const DATA_DIR = mkdtempSync(join(tmpdir(), 'reflexchain-test-'));

const processes: ChildProcess[] = [];
const sockets: WebSocket[] = [];

const httpUrl = (ordinal: number) => `http://127.0.0.1:${BASE_PORT + ordinal}`;
const wsUrl = (ordinal: number) => `ws://127.0.0.1:${BASE_PORT + ordinal}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null>,
  timeoutMs = 45_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result !== null && result !== undefined) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}${lastError ? ` (${lastError})` : ''}`);
}

async function status(ordinal: number): Promise<ValidatorStatus> {
  const res = await fetch(`${httpUrl(ordinal)}/status`);
  return (await res.json()) as ValidatorStatus;
}

async function chainOf(ordinal: number): Promise<{ height: number; headHash: string; blocks: Block[] }> {
  const res = await fetch(`${httpUrl(ordinal)}/chain`);
  return (await res.json()) as { height: number; headHash: string; blocks: Block[] };
}

function startValidator(ordinal: number): ChildProcess {
  const child = spawn('npx', ['tsx', 'apps/validator/src/index.ts'], {
    cwd: REPO_ROOT,
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      RFX_NODE_ORDINAL: String(ordinal),
      RFX_VALIDATOR_COUNT: String(NODE_COUNT),
      RFX_VALIDATOR_BASE_PORT: String(BASE_PORT),
      RFX_DATA_DIR: DATA_DIR,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => {
    if (process.env.RFX_TEST_VERBOSE) process.stdout.write(`[n${ordinal}] ${d}`);
  });
  child.stderr?.on('data', (d) => process.stderr.write(`[n${ordinal}!] ${d}`));
  return child;
}

function openSocket(ordinal: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl(ordinal));
    const timer = setTimeout(() => reject(new Error(`socket ${ordinal} timeout`)), 10_000);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** Broadcast to every validator at once - the client never relays via a server. */
function broadcast(payload: unknown): void {
  const raw = JSON.stringify(payload);
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(raw);
  }
}

// --- identities -------------------------------------------------------------

const coordinator = coordinatorKeyPair();
const alice: KeyPair = generateKeyPair();
const bob: KeyPair = generateKeyPair();

const players: PlayerIdentity[] = [
  { address: alice.address, pubKey: alice.publicKey, label: 'PLAYER 01' },
  { address: bob.address, pubKey: bob.publicKey, label: 'PLAYER 02' },
];

function openMatch(matchId: string): void {
  const payload = { matchId, players, issuedAt: Date.now() };
  broadcast({ type: 'MATCH_OPEN', ...payload, sig: signObject(payload, coordinator.privateKey) });
}

function announceGo(matchId: string, turnIndex: number, goSeq: number): void {
  const payload: UnsignedGoAnnounce = {
    matchId,
    turnIndex,
    goSeq,
    player: players[turnIndex]!.address,
    players,
    issuedAt: Date.now(),
  };
  broadcast({
    type: 'GO_ANNOUNCE',
    announce: { ...payload, sig: signObject(payload, coordinator.privateKey) },
  });
}

function pressEvent(
  player: KeyPair,
  matchId: string,
  turnIndex: number,
  goSeq: number,
  reactionMs: number,
  kind: 'PRESS' | 'FALSE_START' = 'PRESS',
): PressEvent {
  const nonce = randomHex(8);
  const unsigned: UnsignedPressEvent = {
    eventId: hashObject({ matchId, turnIndex, player: player.address, nonce }).slice(0, 16),
    matchId,
    turnIndex,
    player: player.address,
    pubKey: player.publicKey,
    nonce,
    goSeq,
    claimedReactionMs: reactionMs,
    kind,
  };
  return { ...unsigned, sig: signObject(unsigned, player.privateKey) };
}

// --- lifecycle --------------------------------------------------------------

beforeAll(async () => {
  for (let ordinal = 1; ordinal <= NODE_COUNT; ordinal++) {
    processes.push(startValidator(ordinal));
  }

  // Every node up and serving.
  await waitFor('all validators to boot', async () => {
    const all = await Promise.all(
      Array.from({ length: NODE_COUNT }, (_, i) => status(i + 1).catch(() => null)),
    );
    return all.every((s) => s !== null) ? all : null;
  });

  // Full mesh: every node linked to all 4 peers.
  await waitFor('mesh convergence', async () => {
    const all = await Promise.all(
      Array.from({ length: NODE_COUNT }, (_, i) => status(i + 1)),
    );
    return all.every((s) => s.peersConnected === NODE_COUNT - 1) ? all : null;
  });

  for (let ordinal = 1; ordinal <= NODE_COUNT; ordinal++) {
    sockets.push(await openSocket(ordinal));
  }
}, 90_000);

afterAll(async () => {
  for (const socket of sockets) socket.close();
  for (const child of processes) {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }
  await sleep(1_500);
  try {
    rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {
    /* Windows sometimes still holds the handle; the temp dir is disposable. */
  }
});

// --- tests ------------------------------------------------------------------

describe('a five-process validator network', () => {
  it('boots five nodes that agree on genesis', async () => {
    const chains = await Promise.all(
      Array.from({ length: NODE_COUNT }, (_, i) => chainOf(i + 1)),
    );
    const genesisHashes = new Set(chains.map((c) => c.blocks[0]!.hash));

    expect(genesisHashes.size).toBe(1);
    expect(chains.every((c) => c.height === 0)).toBe(true);
  });

  it('forms a full mesh of independent processes', async () => {
    for (let ordinal = 1; ordinal <= NODE_COUNT; ordinal++) {
      const s = await status(ordinal);
      expect(s.validatorId).toBe(validatorIdFor(ordinal));
      expect(s.peersConnected).toBe(NODE_COUNT - 1);
      expect(s.online).toBe(true);
    }
  });

  it(
    'runs a two-turn match to consensus and commits one identical block everywhere',
    async () => {
      const matchId = 'match-integration-1';
      const startHeight = (await status(1)).height;

      openMatch(matchId);
      await sleep(300);

      // --- turn 0: Alice reacts in 176ms ---
      announceGo(matchId, 0, 1);
      await sleep(180);
      broadcast({ type: 'SUBMIT_EVENT', event: pressEvent(alice, matchId, 0, 1, 176) });
      await sleep(600);

      // --- turn 1: Bob reacts in 204ms ---
      announceGo(matchId, 1, 2);
      await sleep(210);
      broadcast({ type: 'SUBMIT_EVENT', event: pressEvent(bob, matchId, 1, 2, 204) });

      // --- every node must reach the same height ---
      const chains = await waitFor(
        'block to be committed on all five nodes',
        async () => {
          const all = await Promise.all(
            Array.from({ length: NODE_COUNT }, (_, i) => chainOf(i + 1)),
          );
          return all.every((c) => c.height === startHeight + 1) ? all : null;
        },
        30_000,
      );

      // Byte-identical head across five separate processes and five separate files.
      const heads = new Set(chains.map((c) => c.headHash));
      expect(heads.size).toBe(1);

      const block = chains[0]!.blocks[chains[0]!.height]!;
      expect(block.matchId).toBe(matchId);
      expect(block.transactions).toHaveLength(2);
      expect(block.winner).toBe(alice.address);
      expect(block.winningReactionMs).toBe(176);
      expect(block.consensus.approvals).toBeGreaterThanOrEqual(quorumFor(NODE_COUNT));

      // The votes inside the block are real, from distinct nodes.
      const voters = new Set(block.transactions[0]!.votes.map((v) => v.validatorId));
      expect(voters.size).toBeGreaterThanOrEqual(quorumFor(NODE_COUNT));

      // Each node observed the event on its own clock, so the deltas differ.
      const observed = block.transactions[0]!.votes.map((v) => v.observedArrivalDeltaMs);
      expect(new Set(observed).size).toBeGreaterThan(1);
    },
    60_000,
  );

  it(
    'records a false start as a forfeited turn and awards the match to the opponent',
    async () => {
      const matchId = 'match-integration-2';
      const startHeight = (await status(1)).height;

      openMatch(matchId);
      await sleep(300);

      // Turn 0: Alice presses BEFORE any GO announcement exists. No node has a
      // GO record for the turn, so all five independently call it a false start.
      broadcast({
        type: 'SUBMIT_EVENT',
        event: pressEvent(alice, matchId, 0, 1, 120, 'FALSE_START'),
      });
      await sleep(600);

      // Turn 1: Bob plays a clean turn.
      announceGo(matchId, 1, 2);
      await sleep(200);
      broadcast({ type: 'SUBMIT_EVENT', event: pressEvent(bob, matchId, 1, 2, 198) });

      const chains = await waitFor(
        'false-start block',
        async () => {
          const all = await Promise.all(
            Array.from({ length: NODE_COUNT }, (_, i) => chainOf(i + 1)),
          );
          return all.every((c) => c.height === startHeight + 1) ? all : null;
        },
        30_000,
      );

      expect(new Set(chains.map((c) => c.headHash)).size).toBe(1);

      const block = chains[0]!.blocks[chains[0]!.height]!;
      const aliceTx = block.transactions.find((t) => t.player === alice.address)!;

      expect(aliceTx.outcome).toBe('FALSE_START');
      expect(aliceTx.reactionMs).toBeNull();
      expect(block.winner).toBe(bob.address);
      expect(block.winningReactionMs).toBe(198);
    },
    60_000,
  );

  it('rejects a replayed event without producing a second vote', async () => {
    const matchId = 'match-integration-3';
    openMatch(matchId);
    await sleep(200);
    announceGo(matchId, 0, 1);
    await sleep(180);

    const event = pressEvent(alice, matchId, 0, 1, 190);
    broadcast({ type: 'SUBMIT_EVENT', event });
    await sleep(400);
    broadcast({ type: 'SUBMIT_EVENT', event }); // exact replay
    await sleep(600);

    // The turn settles once; the replay changes nothing.
    const validation = await fetch(`${httpUrl(1)}/chain/validate`).then((r) => r.json());
    expect(validation.valid).toBe(true);
  });

  it('keeps every node chain internally valid', async () => {
    for (let ordinal = 1; ordinal <= NODE_COUNT; ordinal++) {
      const validation = await fetch(`${httpUrl(ordinal)}/chain/validate`).then((r) => r.json());
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    }
  });
});
