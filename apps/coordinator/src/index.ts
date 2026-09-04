/**
 * Coordinator process.
 *
 * Runs the game: lobbies, match codes, turn order, the randomized red-light
 * delay, and the GO signal. It is NOT part of consensus. It never validates a
 * reaction, never counts a vote, never touches the chain, and never decides a
 * winner - it only decides when the light turns green and whose turn is next.
 */
import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import {
  COORDINATOR_PORT,
  VALIDATOR_COUNT,
  addressFromPublicKey,
  coordinatorKeyPair,
  quorumFor,
  validatorSet,
  type PlayerIdentity,
} from '@reflexchain/protocol';
import { Match, type ClientTurnReport } from './match.js';
import { ValidatorLink } from './validatorLink.js';

const link = new ValidatorLink();
link.start();

const matchesByCode = new Map<string, Match>();
const matchesById = new Map<string, Match>();
/** socket.id -> { matchId, seat } */
const seats = new Map<string, { matchId: string; seat: number }>();

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// ---------------------------------------------------------------------------
// Match wiring
// ---------------------------------------------------------------------------

function emitMatch(match: Match, event: string, payload: Record<string, unknown> = {}): void {
  io.to(match.matchId).emit(event, { ...payload, match: match.snapshot() });
}

const callbacks = {
  onPhase: (match: Match, phase: string, extra: Record<string, unknown> = {}) => {
    emitMatch(match, 'phase', { phase, ...extra });
  },

  onOpen: (match: Match) => {
    link.openMatch(match.matchId, match.players);
    console.log(
      `[coordinator] match ${match.code} (${match.matchId}) opened -> ` +
        `${link.connectedCount}/${VALIDATOR_COUNT} validators`,
    );
  },

  /**
   * The instant GO fires: race it to every validator AND to the player. Each
   * validator stamps its own arrival, which is what makes their later
   * observations genuinely independent.
   */
  onGo: (match: Match, turnIndex: number, goSeq: number) => {
    link.announceGo(
      match.matchId,
      turnIndex,
      goSeq,
      match.players[turnIndex]!.address,
      match.players,
    );
  },

  onComplete: (match: Match) => {
    link.closeMatch(match.matchId);
    emitMatch(match, 'match_complete', {});
    console.log(`[coordinator] match ${match.code} turns complete, awaiting block`);
  },
};

function cleanupMatch(match: Match): void {
  matchesByCode.delete(match.code);
  matchesById.delete(match.matchId);
}

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

function identityFrom(raw: unknown, fallbackLabel: string): PlayerIdentity | null {
  if (!raw || typeof raw !== 'object') return null;
  const { pubKey, label } = raw as { pubKey?: unknown; label?: unknown };
  if (typeof pubKey !== 'string' || pubKey.length !== 64) return null;
  return {
    address: addressFromPublicKey(pubKey),
    pubKey,
    label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 24) : fallbackLabel,
  };
}

io.on('connection', (socket: Socket) => {
  socket.emit('welcome', {
    coordinatorPublicKey: coordinatorKeyPair().publicKey,
    validators: validatorSet(VALIDATOR_COUNT).map((v) => ({
      validatorId: v.validatorId,
      ordinal: v.ordinal,
      port: v.port,
      httpUrl: v.httpUrl,
      wsUrl: v.wsUrl,
      publicKey: v.publicKey,
    })),
    quorum: quorumFor(VALIDATOR_COUNT),
    registeredValidators: VALIDATOR_COUNT,
    validatorsLinked: link.connectedIds,
  });

  socket.on('create_match', (payload: unknown, ack?: (r: unknown) => void) => {
    const body = (payload ?? {}) as { hotseat?: boolean; identity?: unknown };
    const identity = identityFrom(body.identity, 'PLAYER 01');
    if (!identity) {
      ack?.({ ok: false, error: 'a valid ed25519 public key is required' });
      return;
    }

    const match = new Match({ hotseat: body.hotseat === true, callbacks });
    match.addPlayer(identity);
    matchesByCode.set(match.code, match);
    matchesById.set(match.matchId, match);

    socket.join(match.matchId);
    seats.set(socket.id, { matchId: match.matchId, seat: 0 });

    console.log(`[coordinator] match ${match.code} created (hotseat=${match.hotseat})`);
    ack?.({ ok: true, seat: 0, match: match.snapshot() });
    emitMatch(match, 'lobby', {});
  });

  socket.on('join_match', (payload: unknown, ack?: (r: unknown) => void) => {
    const body = (payload ?? {}) as { code?: unknown; identity?: unknown };
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    const match = matchesByCode.get(code);

    if (!match) {
      ack?.({ ok: false, error: `no match with code ${code || '(empty)'}` });
      return;
    }
    if (match.isFull) {
      ack?.({ ok: false, error: 'match is already full' });
      return;
    }

    const identity = identityFrom(body.identity, 'PLAYER 02');
    if (!identity) {
      ack?.({ ok: false, error: 'a valid ed25519 public key is required' });
      return;
    }
    if (match.players.some((p) => p.address === identity.address)) {
      // Most likely two tabs on one machine sharing a stored wallet. Say so,
      // rather than leaving the player staring at a generic refusal.
      ack?.({
        ok: false,
        error: 'that identity already holds a seat - use a second device, or HOTSEAT mode',
      });
      return;
    }
    if (!match.addPlayer(identity)) {
      ack?.({ ok: false, error: 'could not seat player' });
      return;
    }

    socket.join(match.matchId);
    seats.set(socket.id, { matchId: match.matchId, seat: 1 });

    ack?.({ ok: true, seat: 1, match: match.snapshot() });
    emitMatch(match, 'lobby', {});
  });

  /** Hotseat: one client occupies both seats on a single keyboard. */
  socket.on('seat_second_player', (payload: unknown, ack?: (r: unknown) => void) => {
    const seat = seats.get(socket.id);
    const match = seat ? matchesById.get(seat.matchId) : null;
    if (!match || !match.hotseat) {
      ack?.({ ok: false, error: 'not in a hotseat match' });
      return;
    }

    const identity = identityFrom((payload as { identity?: unknown })?.identity, 'PLAYER 02');
    if (!identity || !match.addPlayer(identity)) {
      ack?.({ ok: false, error: 'could not seat second player' });
      return;
    }

    ack?.({ ok: true, match: match.snapshot() });
    emitMatch(match, 'lobby', {});
  });

  /**
   * Rejoin a match after a dropped connection.
   *
   * Socket.IO reconnects with a NEW socket id, which means the old room
   * membership and seat are gone - a player who backgrounded their tab long
   * enough to miss a heartbeat would silently stop receiving the lights. The
   * seat is proven by the signing identity, not by the socket.
   */
  socket.on('resume_match', (payload: unknown, ack?: (r: unknown) => void) => {
    const body = (payload ?? {}) as { matchId?: unknown; identity?: unknown };
    const matchId = typeof body.matchId === 'string' ? body.matchId : '';
    const match = matchesById.get(matchId);

    if (!match) {
      ack?.({ ok: false, error: 'match no longer exists' });
      return;
    }

    const identity = identityFrom(body.identity, 'PLAYER');
    if (!identity) {
      ack?.({ ok: false, error: 'a valid ed25519 public key is required' });
      return;
    }

    const seatIndex = match.players.findIndex((p) => p.address === identity.address);
    if (seatIndex < 0) {
      ack?.({ ok: false, error: 'that identity does not hold a seat in this match' });
      return;
    }

    socket.join(match.matchId);
    seats.set(socket.id, { matchId: match.matchId, seat: seatIndex });
    console.log(`[coordinator] ${identity.address.slice(0, 10)} resumed seat ${seatIndex} in ${match.code}`);
    ack?.({ ok: true, seat: seatIndex, match: match.snapshot() });
  });

  socket.on('start_match', (_payload: unknown, ack?: (r: unknown) => void) => {
    const seat = seats.get(socket.id);
    const match = seat ? matchesById.get(seat.matchId) : null;
    if (!match) {
      ack?.({ ok: false, error: 'not in a match' });
      return;
    }
    if (!match.isFull) {
      ack?.({ ok: false, error: 'need two players' });
      return;
    }
    if (link.connectedCount < quorumFor(VALIDATOR_COUNT)) {
      ack?.({
        ok: false,
        error: `only ${link.connectedCount}/${VALIDATOR_COUNT} validators reachable; quorum needs ${quorumFor(VALIDATOR_COUNT)}`,
      });
      return;
    }

    match.start();
    ack?.({ ok: true });
  });

  /**
   * Turn advancement only. The coordinator takes the client's word for the sake
   * of pacing the UI; it is explicitly not evidence, and the number shown as
   * canonical comes from the block, not from here.
   */
  socket.on('turn_pressed', (payload: unknown) => {
    const seat = seats.get(socket.id);
    const match = seat ? matchesById.get(seat.matchId) : null;
    if (!match) return;

    const body = (payload ?? {}) as Partial<ClientTurnReport>;
    const turnIndex = Number(body.turnIndex);
    if (!Number.isInteger(turnIndex)) return;

    // Only the player whose turn it is may end it. Without this, the waiting
    // player pressing space on their own device would cut their opponent's turn
    // short. (In hotseat one client legitimately owns both seats.)
    if (!match.hotseat && seat!.seat !== turnIndex) return;

    match.reportTurn(turnIndex, {
      turnIndex,
      reactionMs: typeof body.reactionMs === 'number' ? body.reactionMs : null,
      falseStart: body.falseStart === true,
    });
  });

  socket.on('disconnect', () => {
    const seat = seats.get(socket.id);
    seats.delete(socket.id);
    if (!seat) return;

    const match = matchesById.get(seat.matchId);
    if (!match) return;

    // Only tear the match down if nobody is left watching it.
    const room = io.sockets.adapter.rooms.get(match.matchId);
    if (!room || room.size === 0) {
      match.abandon();
      cleanupMatch(match);
      console.log(`[coordinator] match ${match.code} abandoned (all players gone)`);
    }
  });
});

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

app.get('/status', (_req, res) => {
  res.json({
    service: 'coordinator',
    publicKey: coordinatorKeyPair().publicKey,
    validatorsLinked: link.connectedIds,
    validatorsExpected: VALIDATOR_COUNT,
    quorum: quorumFor(VALIDATOR_COUNT),
    activeMatches: matchesById.size,
  });
});

app.get('/matches', (_req, res) => {
  res.json([...matchesById.values()].map((m) => m.snapshot()));
});

app.get('/network', (_req, res) => {
  res.json({
    validators: validatorSet(VALIDATOR_COUNT),
    quorum: quorumFor(VALIDATOR_COUNT),
    registeredValidators: VALIDATOR_COUNT,
    linked: link.connectedIds,
  });
});

/**
 * Drop matches that finished a while ago. Nothing depends on them once the
 * block is sealed - the chain is the record - and without this the lobby table
 * grows for the life of the process.
 */
const MATCH_TTL_MS = 10 * 60_000;
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const match of [...matchesById.values()]) {
    const finished = match.phase === 'BLOCK_PROPOSAL' || match.phase === 'FINALIZED';
    const stale = now - match.createdAt > MATCH_TTL_MS;
    if (!finished && !stale) continue;
    if (now - match.createdAt < 60_000) continue; // give clients time to resume
    const room = io.sockets.adapter.rooms.get(match.matchId);
    if (room && room.size > 0) continue;
    cleanupMatch(match);
  }
}, 60_000);
sweeper.unref();

server.listen(COORDINATOR_PORT, () => {
  console.log(
    `[coordinator] listening on ${COORDINATOR_PORT} | ` +
      `quorum ${quorumFor(VALIDATOR_COUNT)}/${VALIDATOR_COUNT}`,
  );
});

function shutdown(): void {
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
