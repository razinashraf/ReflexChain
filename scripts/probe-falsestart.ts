/** Focused probe: does a press with no GO announcement record as FALSE_START? */
import { WebSocket } from 'ws';
import {
  coordinatorKeyPair,
  generateKeyPair,
  hashObject,
  randomHex,
  signObject,
  validatorSet,
  VALIDATOR_COUNT,
  type PlayerIdentity,
  type UnsignedGoAnnounce,
  type UnsignedPressEvent,
} from '@reflexchain/protocol';

const coord = coordinatorKeyPair();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const a = generateKeyPair();
const b = generateKeyPair();
const identities: PlayerIdentity[] = [
  { address: a.address, pubKey: a.publicKey, label: 'FS-A' },
  { address: b.address, pubKey: b.publicKey, label: 'FS-B' },
];

const sockets = await Promise.all(
  validatorSet(VALIDATOR_COUNT).map(
    (t) =>
      new Promise<WebSocket>((res, rej) => {
        const s = new WebSocket(t.wsUrl);
        s.once('open', () => res(s));
        s.once('error', rej);
      }),
  ),
);

const send = (p: unknown) => {
  const raw = JSON.stringify(p);
  for (const s of sockets) if (s.readyState === WebSocket.OPEN) s.send(raw);
};

const matchId = `match-probe-${randomHex(4)}`;
const openPayload = { matchId, players: identities, issuedAt: Date.now() };
send({ type: 'MATCH_OPEN', ...openPayload, sig: signObject(openPayload, coord.privateKey) });
await sleep(300);

function press(
  p: typeof a,
  turnIndex: number,
  goSeq: number,
  ms: number,
  kind: 'PRESS' | 'FALSE_START',
) {
  const nonce = randomHex(8);
  const u: UnsignedPressEvent = {
    eventId: hashObject({ matchId, turnIndex, player: p.address, nonce }).slice(0, 16),
    matchId,
    turnIndex,
    player: p.address,
    pubKey: p.publicKey,
    nonce,
    goSeq,
    claimedReactionMs: ms,
    kind,
  };
  return { ...u, sig: signObject(u, p.privateKey) };
}

console.log('turn 0: pressing with NO GO announced (expect FALSE_START)');
send({ type: 'SUBMIT_EVENT', event: press(a, 0, 9001, 0, 'FALSE_START') });
await sleep(4000); // longer than the 2.5s vote window

console.log('turn 1: clean turn');
const seq = 9002;
const ann: UnsignedGoAnnounce = {
  matchId,
  turnIndex: 1,
  goSeq: seq,
  player: b.address,
  players: identities,
  issuedAt: Date.now(),
};
send({ type: 'GO_ANNOUNCE', announce: { ...ann, sig: signObject(ann, coord.privateKey) } });
await sleep(190);
send({ type: 'SUBMIT_EVENT', event: press(b, 1, seq, 190, 'PRESS') });
await sleep(3500);

const res = await fetch('http://127.0.0.1:7001/chain');
const chain = (await res.json()) as { blocks: any[] };
const block = chain.blocks.find((x) => x.matchId === matchId);

if (!block) {
  console.log('NO BLOCK PRODUCED for', matchId);
} else {
  console.log(`block #${block.index} winner=${block.winner} ${block.winningReactionMs}ms`);
  for (const t of block.transactions) {
    console.log(`  turn${t.turnIndex} ${t.outcome} reaction=${t.reactionMs} votes=${t.votes.length}`);
    for (const v of t.votes) console.log(`     ${v.validatorId} ${v.verdict} ${v.reasons.join('|')}`);
  }
}

for (const s of sockets) s.close();
process.exit(0);
