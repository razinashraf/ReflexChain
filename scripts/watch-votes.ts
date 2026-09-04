/**
 * Live vote inspector. Subscribes to a validator's telemetry and prints every
 * vote with its reason codes, so a rejection can be diagnosed rather than guessed at.
 *
 *   npx tsx scripts/watch-votes.ts [seconds]
 */
import { WebSocket } from 'ws';
import { validatorSet, VALIDATOR_COUNT, type Vote } from '@reflexchain/protocol';

const SECONDS = Number(process.argv[2] ?? 60);
const target = validatorSet(VALIDATOR_COUNT, '127.0.0.1')[0]!;

const socket = new WebSocket(target.wsUrl);
const seen = new Set<string>();

socket.on('open', () => {
  socket.send(JSON.stringify({ type: 'SUBSCRIBE', role: 'SPECTATOR' }));
  console.log(`watching ${target.validatorId} for ${SECONDS}s...`);
});

socket.on('message', (raw) => {
  let msg: { type?: string; vote?: Vote; tally?: unknown; matchId?: string; turnIndex?: number };
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }

  if (msg.type === 'TELEMETRY_VOTE' && msg.vote) {
    const v = msg.vote;
    const key = `${v.validatorId}:${v.eventId}`;
    if (seen.has(key)) return;
    seen.add(key);
    console.log(
      `  VOTE ${v.validatorId} turn${v.turnIndex} ${v.verdict.padEnd(6)} ` +
        `obsΔ=${String(v.observedArrivalDeltaMs ?? '-').padStart(5)}ms ` +
        `claim=${String(v.canonicalReactionMs ?? '-').padStart(5)} ` +
        `[${v.reasons.join(',')}]`,
    );
  }

  if (msg.type === 'TELEMETRY_TALLY') {
    const t = msg.tally as { status: string; approvals: number; rejections: number };
    console.log(`  TALLY turn${msg.turnIndex} ${t.status} +${t.approvals}/-${t.rejections}`);
  }
});

socket.on('error', (e) => console.error('socket error:', e.message));

setTimeout(() => {
  socket.close();
  process.exit(0);
}, SECONDS * 1000);
