/**
 * Synthetic-player harness.
 *
 * Plays complete matches against a RUNNING validator network using the real
 * protocol: real ed25519 keys, real signed press events, broadcast to every
 * validator over its own socket, settled by real consensus. The only thing
 * simulated is the human finger - every block it produces is genuine and
 * verifies exactly like one produced from the browser.
 *
 * Used to seed a demo chain and to build the archived snapshot for the hosted
 * build.
 *
 *   npx tsx scripts/seed-chain.ts --matches 6
 */
import { WebSocket } from 'ws';
import {
  coordinatorKeyPair,
  generateKeyPair,
  hashObject,
  randomHex,
  signObject,
  validatorSet,
  VALIDATOR_COUNT,
  type KeyPair,
  type PlayerIdentity,
  type PressEvent,
  type UnsignedGoAnnounce,
  type UnsignedPressEvent,
} from '@reflexchain/protocol';

const args = process.argv.slice(2);
const argValue = (flag: string, fallback: string) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

const MATCHES = Number(argValue('--matches', '5'));
const HOST = argValue('--host', 'localhost');

/**
 * Optional explicit endpoint list, so this harness can drive a deployment that
 * routes validators by path behind one public port rather than by port number:
 *
 *   --endpoints http://127.0.0.1:8080/node-01,...,http://127.0.0.1:8080/node-05
 *
 * Without it, endpoints are derived from the protocol's own port scheme.
 */
const ENDPOINTS = argValue('--endpoints', '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

interface Target {
  validatorId: string;
  httpUrl: string;
  wsUrl: string;
}

function targets(): Target[] {
  if (ENDPOINTS.length > 0) {
    return ENDPOINTS.map((httpUrl, i) => ({
      validatorId: `node-0${i + 1}`,
      httpUrl,
      wsUrl: httpUrl.replace(/^http/, 'ws'),
    }));
  }
  return validatorSet(VALIDATOR_COUNT, HOST).map((t) => ({
    validatorId: t.validatorId,
    httpUrl: t.httpUrl,
    wsUrl: t.wsUrl,
  }));
}

const coordinator = coordinatorKeyPair();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NAMES = ['NEO', 'TRINITY', 'MORPHEUS', 'CYPHER', 'SWITCH', 'APOC', 'TANK', 'DOZER'];

interface Player extends KeyPair {
  label: string;
}

function makePlayer(label: string): Player {
  return { ...generateKeyPair(), label };
}

/**
 * Connect to whichever validators are reachable.
 *
 * Deliberately tolerant: a killed node refuses connections outright, and the
 * whole point of a 4-of-5 quorum is that the network keeps working without it.
 * Failing here on the first unreachable node would make this harness unable to
 * exercise exactly the scenario it exists to test.
 */
async function openSockets(): Promise<WebSocket[]> {
  const list = targets();

  const results = await Promise.allSettled(
    list.map(
      (t) =>
        new Promise<WebSocket>((resolve, reject) => {
          const socket = new WebSocket(t.wsUrl);
          const timer = setTimeout(() => {
            socket.terminate();
            reject(new Error(`${t.validatorId} unreachable`));
          }, 6_000);
          socket.once('open', () => {
            clearTimeout(timer);
            resolve(socket);
          });
          socket.once('error', (e) => {
            clearTimeout(timer);
            reject(e);
          });
          socket.once('close', () => {
            clearTimeout(timer);
            reject(new Error(`${t.validatorId} closed the connection`));
          });
        }),
    ),
  );

  const open = results
    .filter((r): r is PromiseFulfilledResult<WebSocket> => r.status === 'fulfilled')
    .map((r) => r.value);

  const down = list.length - open.length;
  if (down > 0) console.log(`  (${down} validator(s) unreachable - continuing with ${open.length})`);
  if (open.length === 0) throw new Error('no validators reachable');

  return open;
}

function broadcast(sockets: WebSocket[], payload: unknown): void {
  const raw = JSON.stringify(payload);
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(raw);
  }
}

function pressEvent(
  player: Player,
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

let goSeq = 1000;

async function playMatch(
  sockets: WebSocket[],
  players: [Player, Player],
  index: number,
): Promise<void> {
  const matchId = `match-seed-${randomHex(4)}`;
  const identities: PlayerIdentity[] = players.map((p) => ({
    address: p.address,
    pubKey: p.publicKey,
    label: p.label,
  }));

  const openPayload = { matchId, players: identities, issuedAt: Date.now() };
  broadcast(sockets, {
    type: 'MATCH_OPEN',
    ...openPayload,
    sig: signObject(openPayload, coordinator.privateKey),
  });
  await sleep(250);

  // Roughly one match in six opens with a false start, so the seeded chain
  // contains the outcomes the demo needs to show.
  const falseStartTurn = index % 6 === 3 ? 0 : -1;

  for (let turnIndex = 0; turnIndex < 2; turnIndex++) {
    const player = players[turnIndex]!;

    if (turnIndex === falseStartTurn) {
      // Press with no GO announced at all: every node independently classifies
      // this as a false start because none of them has a GO record for the turn.
      broadcast(sockets, {
        type: 'SUBMIT_EVENT',
        event: pressEvent(player, matchId, turnIndex, goSeq, 0, 'FALSE_START'),
      });
      await sleep(900);
      continue;
    }

    const seq = ++goSeq;
    const announce: UnsignedGoAnnounce = {
      matchId,
      turnIndex,
      goSeq: seq,
      player: player.address,
      players: identities,
      issuedAt: Date.now(),
    };
    broadcast(sockets, {
      type: 'GO_ANNOUNCE',
      announce: { ...announce, sig: signObject(announce, coordinator.privateKey) },
    });

    const reaction = 150 + Math.floor(Math.random() * 130);
    await sleep(reaction);
    broadcast(sockets, {
      type: 'SUBMIT_EVENT',
      event: pressEvent(player, matchId, turnIndex, seq, reaction),
    });
    await sleep(700);
  }

  await sleep(1_600); // let the block seal
}

async function main(): Promise<void> {
  console.log(`seeding ${MATCHES} matches against ${HOST}...`);
  const sockets = await openSockets();
  console.log(`connected to ${sockets.length} validators`);

  const roster = NAMES.map(makePlayer);

  for (let i = 0; i < MATCHES; i++) {
    const a = roster[i % roster.length]!;
    const b = roster[(i + 1 + (i % 3)) % roster.length]!;
    await playMatch(sockets, [a, b], i);
    process.stdout.write(`  match ${i + 1}/${MATCHES} sealed\n`);
  }

  for (const socket of sockets) socket.close();

  // Report from whichever node answers - node-01 may be the one that is down.
  for (const target of targets()) {
    try {
      const res = await fetch(`${target.httpUrl}/chain`, { signal: AbortSignal.timeout(2_500) });
      if (!res.ok) continue;
      const chain = (await res.json()) as { height: number; headHash: string };
      console.log(
        `done. height=${chain.height} head=${chain.headHash.slice(0, 16)} (via ${target.validatorId})`,
      );
      process.exit(0);
    } catch {
      continue;
    }
  }
  console.log('done, but no validator answered for the final height check');
  process.exit(0);
}

main().catch((error) => {
  console.error('seed failed:', error);
  process.exit(1);
});
