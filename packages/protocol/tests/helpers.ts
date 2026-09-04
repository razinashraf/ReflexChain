/**
 * Test fixtures that build genuinely signed events, votes and blocks using the
 * real validator identities. Nothing here fakes a signature - if the protocol
 * code is wrong, these fixtures fail to verify.
 */
import {
  blockAgreement,
  buildTurnTransaction,
  createBlock,
  createGenesisBlock,
  generateKeyPair,
  hashObject,
  quorumFor,
  randomHex,
  signObject,
  tallyVotes,
  validatorKeyPair,
  validatorSet,
  type Block,
  type KeyPair,
  type PressEvent,
  type TurnTransaction,
  type UnsignedPressEvent,
  type UnsignedVote,
  type Verdict,
  type Vote,
} from '../src/index.js';

export const REGISTERED = 5;
export const THRESHOLD = quorumFor(REGISTERED);

export function makePlayer(label: string): KeyPair & { label: string } {
  return { ...generateKeyPair(), label };
}

export interface PressEventOverrides {
  matchId?: string;
  turnIndex?: number;
  goSeq?: number;
  claimedReactionMs?: number;
  kind?: 'PRESS' | 'FALSE_START';
  nonce?: string;
}

export function makePressEvent(
  player: KeyPair,
  overrides: PressEventOverrides = {},
): PressEvent {
  const matchId = overrides.matchId ?? 'match-test';
  const turnIndex = overrides.turnIndex ?? 0;
  const nonce = overrides.nonce ?? randomHex(8);

  const unsigned: UnsignedPressEvent = {
    eventId: hashObject({ matchId, turnIndex, player: player.address, nonce }).slice(0, 16),
    matchId,
    turnIndex,
    player: player.address,
    pubKey: player.publicKey,
    nonce,
    goSeq: overrides.goSeq ?? 1,
    claimedReactionMs: overrides.claimedReactionMs ?? 183,
    kind: overrides.kind ?? 'PRESS',
  };

  return { ...unsigned, sig: signObject(unsigned, player.privateKey) };
}

export function makeVote(
  validatorId: string,
  event: PressEvent,
  verdict: Verdict,
  extras: Partial<UnsignedVote> = {},
): Vote {
  const kp = validatorKeyPair(validatorId);
  const unsigned: UnsignedVote = {
    validatorId,
    eventId: event.eventId,
    matchId: event.matchId,
    turnIndex: event.turnIndex,
    player: event.player,
    verdict,
    reasons: verdict === 'ACCEPT' ? ['SIG_OK', 'ROUND_OK'] : ['LATENCY_ENVELOPE_FAIL'],
    observedArrivalDeltaMs: 210,
    canonicalReactionMs: verdict === 'ACCEPT' ? event.claimedReactionMs : null,
    votedAt: 1_760_000_000_000,
    ...extras,
  };
  return { ...unsigned, sig: signObject(unsigned, kp.privateKey) };
}

/** All five validators accept the event. */
export function unanimousVotes(event: PressEvent): Vote[] {
  return validatorSet(REGISTERED).map((v) => makeVote(v.validatorId, event, 'ACCEPT'));
}

export function turnTransactionFor(event: PressEvent, votes: Vote[]): TurnTransaction {
  const tally = tallyVotes(votes, { registeredValidators: REGISTERED });
  return buildTurnTransaction({
    matchId: event.matchId,
    turnIndex: event.turnIndex,
    player: event.player,
    eventId: event.eventId,
    votes,
    tally,
  });
}

export interface BuiltMatch {
  block: Block;
  transactions: TurnTransaction[];
  players: (KeyPair & { label: string })[];
}

/**
 * Build one realistic match block: two turns, two players, real votes from the
 * real validator set, signed by the real proposer key.
 */
export function buildMatchBlock(options: {
  index: number;
  previousHash: string;
  matchId: string;
  reactions: [number, number];
  proposer?: string;
  timestamp?: number;
  players?: (KeyPair & { label: string })[];
}): BuiltMatch {
  const players =
    options.players ?? [makePlayer('PLAYER 01'), makePlayer('PLAYER 02')];
  const proposer = options.proposer ?? 'node-01';

  const transactions = players.map((player, turnIndex) => {
    const event = makePressEvent(player, {
      matchId: options.matchId,
      turnIndex,
      goSeq: turnIndex + 1,
      claimedReactionMs: options.reactions[turnIndex] as number,
    });
    return turnTransactionFor(event, unanimousVotes(event));
  });

  const fastest = [...transactions].sort((a, b) => a.reactionMs! - b.reactionMs!)[0]!;

  const block = createBlock({
    index: options.index,
    previousHash: options.previousHash,
    matchId: options.matchId,
    transactions,
    winner: fastest.player,
    winningReactionMs: fastest.reactionMs,
    proposer,
    consensus: {
      approvals: blockAgreement(transactions),
      total: REGISTERED,
      threshold: THRESHOLD,
    },
    privateKey: validatorKeyPair(proposer).privateKey,
    timestamp: options.timestamp ?? 1_760_000_000_000 + options.index * 1000,
  });

  return { block, transactions, players };
}

/** A block whose first turn was a false start rejected by every validator. */
export function buildFalseStartBlock(options: {
  index: number;
  previousHash: string;
  matchId: string;
}): { block: Block; falseStartTx: TurnTransaction } {
  const loser = makePlayer('PLAYER 01');
  const winner = makePlayer('PLAYER 02');

  const fsEvent = makePressEvent(loser, {
    matchId: options.matchId,
    turnIndex: 0,
    kind: 'FALSE_START',
  });
  const fsVotes = validatorSet(REGISTERED).map((v) =>
    makeVote(v.validatorId, fsEvent, 'REJECT', { reasons: ['FALSE_START'] }),
  );
  const falseStartTx = turnTransactionFor(fsEvent, fsVotes);

  const goodEvent = makePressEvent(winner, {
    matchId: options.matchId,
    turnIndex: 1,
    goSeq: 2,
    claimedReactionMs: 198,
  });
  const goodTx = turnTransactionFor(goodEvent, unanimousVotes(goodEvent));

  const transactions = [falseStartTx, goodTx];
  const proposer = 'node-02';

  const block = createBlock({
    index: options.index,
    previousHash: options.previousHash,
    matchId: options.matchId,
    transactions,
    winner: winner.address,
    winningReactionMs: 198,
    proposer,
    consensus: {
      approvals: blockAgreement(transactions),
      total: REGISTERED,
      threshold: THRESHOLD,
    },
    privateKey: validatorKeyPair(proposer).privateKey,
    timestamp: 1_760_000_000_000 + options.index * 1000,
  });

  return { block, falseStartTx };
}

/** A genesis + `matches` valid match blocks, correctly linked. */
export function buildChain(matches: number): Block[] {
  const chain: Block[] = [createGenesisBlock()];
  for (let i = 1; i <= matches; i++) {
    const { block } = buildMatchBlock({
      index: i,
      previousHash: chain[chain.length - 1]!.hash,
      matchId: `match-${i}`,
      reactions: [180 + i, 200 + i],
    });
    chain.push(block);
  }
  return chain;
}
