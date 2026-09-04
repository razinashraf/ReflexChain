import { describe, expect, it } from 'vitest';
import {
  leaderFor,
  MAX_STALENESS_MS,
  MIN_HUMAN_REACTION_MS,
  quorumFor,
  settleMatch,
  tallyVotes,
  validateEvent,
  validatorSet,
  type GoRecord,
  type ValidationContext,
} from '../src/index.js';
import {
  makePlayer,
  makePressEvent,
  makeVote,
  REGISTERED,
  THRESHOLD,
  turnTransactionFor,
  unanimousVotes,
} from './helpers.js';

const player = makePlayer('PLAYER 01');
const opponent = makePlayer('PLAYER 02');

function goRecord(overrides: Partial<GoRecord> = {}): GoRecord {
  return {
    matchId: 'match-test',
    turnIndex: 0,
    goSeq: 1,
    player: player.address,
    localGoAt: 1_000_000,
    players: [player.address, opponent.address],
    ...overrides,
  };
}

function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    validatorId: 'node-01',
    arrivedAt: 1_000_000 + 210, // observed A_i - G_i = 210ms
    goRecord: goRecord(),
    seenEventIds: new Set<string>(),
    epsilonMs: 400,
    ...overrides,
  };
}

describe('quorum', () => {
  it('is 4 of 5, tolerating one faulty node', () => {
    expect(quorumFor(5)).toBe(4);
  });

  it('scales with the registered set', () => {
    expect(quorumFor(3)).toBe(3);
    expect(quorumFor(7)).toBe(5);
  });
});

describe('validateEvent', () => {
  it('accepts a well-formed, well-timed reaction', () => {
    const event = makePressEvent(player, { claimedReactionMs: 183 });
    const result = validateEvent(event, ctx());

    expect(result.verdict).toBe('ACCEPT');
    expect(result.canonicalReactionMs).toBe(183);
    expect(result.observedArrivalDeltaMs).toBe(210);
    expect(result.reasons).toContain('WITHIN_LATENCY_ENVELOPE');
  });

  it('rejects a press the node has no GO record for - an independent false start', () => {
    const event = makePressEvent(player);
    const result = validateEvent(event, ctx({ goRecord: null }));

    expect(result.verdict).toBe('REJECT');
    expect(result.reasons).toContain('FALSE_START');
  });

  it('rejects a client-declared false start', () => {
    const event = makePressEvent(player, { kind: 'FALSE_START' });
    expect(validateEvent(event, ctx()).reasons).toContain('FALSE_START');
  });

  it('rejects a replayed event', () => {
    const event = makePressEvent(player);
    const seen = new Set([event.eventId]);
    expect(validateEvent(event, ctx({ seenEventIds: seen })).reasons).toContain('DUPLICATE');
  });

  it('rejects a physiologically impossible reaction', () => {
    const event = makePressEvent(player, { claimedReactionMs: MIN_HUMAN_REACTION_MS - 1 });
    expect(validateEvent(event, ctx()).reasons).toContain('BELOW_HUMAN_FLOOR');
  });

  it('rejects a claim larger than the window the node itself observed', () => {
    // Node observed 210ms elapse; a 900ms claim cannot fit inside it.
    const event = makePressEvent(player, { claimedReactionMs: 900 });
    const result = validateEvent(event, ctx({ epsilonMs: 400 }));

    expect(result.verdict).toBe('REJECT');
    expect(result.reasons).toContain('LATENCY_ENVELOPE_FAIL');
  });

  it('rejects a stale event that arrived long after the claimed press', () => {
    const event = makePressEvent(player, { claimedReactionMs: 183 });
    const result = validateEvent(
      event,
      ctx({ arrivedAt: 1_000_000 + 183 + MAX_STALENESS_MS + 500 }),
    );
    expect(result.reasons).toContain('LATENCY_ENVELOPE_FAIL');
  });

  it('rejects a forged signature', () => {
    const event = makePressEvent(player);
    const forged = { ...event, claimedReactionMs: 90 }; // signature no longer covers this
    expect(validateEvent(forged, ctx()).reasons).toContain('BAD_SIGNATURE');
  });

  it('rejects an address that does not derive from the presented public key', () => {
    const event = makePressEvent(player);
    const impersonated = { ...event, player: opponent.address };
    expect(validateEvent(impersonated, ctx()).reasons).toContain('UNKNOWN_PLAYER');
  });

  it('rejects an event for a stale round', () => {
    const event = makePressEvent(player, { goSeq: 99 });
    expect(validateEvent(event, ctx()).reasons).toContain('WRONG_ROUND');
  });

  it('rejects a player pressing out of turn', () => {
    const event = makePressEvent(opponent, { goSeq: 1 });
    expect(validateEvent(event, ctx()).reasons).toContain('WRONG_ROUND');
  });

  it('rejects a player who is not in the match', () => {
    const stranger = makePlayer('INTRUDER');
    const event = makePressEvent(stranger);
    const result = validateEvent(
      event,
      ctx({ goRecord: goRecord({ player: stranger.address }) }),
    );
    expect(result.reasons).toContain('UNKNOWN_PLAYER');
  });

  it('rejects malformed input rather than throwing', () => {
    const junk = { type: 'nonsense' } as never;
    expect(() => validateEvent(junk, ctx())).not.toThrow();
    expect(validateEvent(junk, ctx()).reasons).toContain('MALFORMED');
  });

  /**
   * The property the whole design rests on: identical event, identical code,
   * different nodes -> genuinely different verdicts, because each node judges
   * against its own observation rather than a relayed copy of someone else's.
   */
  it('produces genuine disagreement between nodes with different observations', () => {
    const event = makePressEvent(player, { claimedReactionMs: 500 });

    const promptNode = validateEvent(
      event,
      ctx({ validatorId: 'node-01', arrivedAt: 1_000_000 + 520 }),
    );
    const laggyNode = validateEvent(
      event,
      ctx({ validatorId: 'node-02', arrivedAt: 1_000_000 + 60 }),
    );

    expect(promptNode.verdict).toBe('ACCEPT');
    expect(laggyNode.verdict).toBe('REJECT');
    expect(promptNode.observedArrivalDeltaMs).not.toBe(laggyNode.observedArrivalDeltaMs);
  });
});

describe('tallyVotes', () => {
  const event = makePressEvent(player);
  const nodes = validatorSet(REGISTERED).map((v) => v.validatorId);

  it('confirms at exactly the quorum threshold', () => {
    const votes = [
      ...nodes.slice(0, THRESHOLD).map((id) => makeVote(id, event, 'ACCEPT')),
      makeVote(nodes[4]!, event, 'REJECT'),
    ];
    const tally = tallyVotes(votes, { registeredValidators: REGISTERED });

    expect(tally.status).toBe('CONFIRMED');
    expect(tally.approvals).toBe(4);
    expect(tally.outcome).toBe('VALID');
    expect(tally.dissenters).toEqual([nodes[4]]);
  });

  it('does not confirm one vote short of quorum', () => {
    const votes = nodes.slice(0, 3).map((id) => makeVote(id, event, 'ACCEPT'));
    const tally = tallyVotes(votes, { registeredValidators: REGISTERED });

    expect(tally.status).toBe('PENDING');
    expect(tally.canonicalReactionMs).toBeNull();
  });

  it('goes inconclusive when the window closes short of quorum', () => {
    const votes = nodes.slice(0, 3).map((id) => makeVote(id, event, 'ACCEPT'));
    const tally = tallyVotes(votes, {
      registeredValidators: REGISTERED,
      windowClosed: true,
    });
    expect(tally.status).toBe('INCONCLUSIVE');
  });

  it('rejects once quorum is unreachable and every node has voted', () => {
    // 2 rejections out of 5 means at most 3 can accept, below the threshold of 4.
    const votes = [
      makeVote(nodes[0]!, event, 'REJECT'),
      makeVote(nodes[1]!, event, 'REJECT'),
      makeVote(nodes[2]!, event, 'ACCEPT'),
      makeVote(nodes[3]!, event, 'ACCEPT'),
      makeVote(nodes[4]!, event, 'ACCEPT'),
    ];
    const tally = tallyVotes(votes, { registeredValidators: REGISTERED });
    expect(tally.status).toBe('REJECTED');
  });

  it('holds a rejection open while votes are still outstanding', () => {
    // Quorum is already unreachable here, but only two nodes have spoken. If we
    // settled now we would not yet know WHY the turn failed, and a false start
    // would be mislabelled as a generic rejection.
    const votes = [
      makeVote(nodes[0]!, event, 'REJECT', { reasons: ['FALSE_START'] }),
      makeVote(nodes[1]!, event, 'REJECT', { reasons: ['FALSE_START'] }),
    ];
    const tally = tallyVotes(votes, { registeredValidators: REGISTERED });
    expect(tally.status).toBe('PENDING');

    // Closing the window settles it, and now the reason is visible.
    const closed = tallyVotes(votes, {
      registeredValidators: REGISTERED,
      windowClosed: true,
    });
    expect(closed.status).toBe('REJECTED');
    expect(closed.outcome).toBe('FALSE_START');
  });

  it('records a quorum of false-start rejections as a FALSE_START outcome', () => {
    const votes = nodes.map((id) =>
      makeVote(id, event, 'REJECT', { reasons: ['FALSE_START'] }),
    );
    const tally = tallyVotes(votes, { registeredValidators: REGISTERED });

    expect(tally.status).toBe('REJECTED');
    expect(tally.outcome).toBe('FALSE_START');
  });

  it('takes the median so one lying node cannot drag the canonical time', () => {
    const votes = [
      makeVote(nodes[0]!, event, 'ACCEPT', { canonicalReactionMs: 183 }),
      makeVote(nodes[1]!, event, 'ACCEPT', { canonicalReactionMs: 183 }),
      makeVote(nodes[2]!, event, 'ACCEPT', { canonicalReactionMs: 184 }),
      makeVote(nodes[3]!, event, 'ACCEPT', { canonicalReactionMs: 183 }),
      makeVote(nodes[4]!, event, 'ACCEPT', { canonicalReactionMs: 1 }), // byzantine
    ];
    const tally = tallyVotes(votes, { registeredValidators: REGISTERED });
    expect(tally.canonicalReactionMs).toBe(183);
  });

  it('counts a double-voting validator only once', () => {
    const votes = [
      makeVote(nodes[0]!, event, 'ACCEPT'),
      makeVote(nodes[0]!, event, 'ACCEPT'),
      makeVote(nodes[0]!, event, 'ACCEPT'),
      makeVote(nodes[1]!, event, 'ACCEPT'),
    ];
    const tally = tallyVotes(votes, { registeredValidators: REGISTERED });
    expect(tally.approvals).toBe(2);
    expect(tally.status).toBe('PENDING');
  });
});

describe('settleMatch', () => {
  const fast = makePressEvent(player, { turnIndex: 0, claimedReactionMs: 176 });
  const slow = makePressEvent(opponent, { turnIndex: 1, claimedReactionMs: 183 });

  it('awards the match to the fastest confirmed reaction', () => {
    const txs = [
      turnTransactionFor(fast, unanimousVotes(fast)),
      turnTransactionFor(slow, unanimousVotes(slow)),
    ];
    const settlement = settleMatch(txs);

    expect(settlement.winner).toBe(player.address);
    expect(settlement.winningReactionMs).toBe(176);
    expect(settlement.note).toContain('7 MS');
  });

  it('forfeits a false-start turn to the opponent', () => {
    const falseStart = makePressEvent(player, { turnIndex: 0, kind: 'FALSE_START' });
    const fsVotes = validatorSet(REGISTERED).map((v) =>
      makeVote(v.validatorId, falseStart, 'REJECT', { reasons: ['FALSE_START'] }),
    );
    const txs = [
      turnTransactionFor(falseStart, fsVotes),
      turnTransactionFor(slow, unanimousVotes(slow)),
    ];
    const settlement = settleMatch(txs);

    expect(settlement.winner).toBe(opponent.address);
    expect(settlement.note).toBe('OPPONENT FORFEITED TURN');
  });

  it('returns no winner when both players false-start', () => {
    const a = makePressEvent(player, { turnIndex: 0, kind: 'FALSE_START' });
    const b = makePressEvent(opponent, { turnIndex: 1, kind: 'FALSE_START' });
    const reject = (e: typeof a) =>
      validatorSet(REGISTERED).map((v) =>
        makeVote(v.validatorId, e, 'REJECT', { reasons: ['FALSE_START'] }),
      );
    const settlement = settleMatch([
      turnTransactionFor(a, reject(a)),
      turnTransactionFor(b, reject(b)),
    ]);

    expect(settlement.winner).toBeNull();
    expect(settlement.note).toBe('NO VALID REACTIONS');
  });

  it('reports a tie without inventing a winner', () => {
    const a = makePressEvent(player, { turnIndex: 0, claimedReactionMs: 190 });
    const b = makePressEvent(opponent, { turnIndex: 1, claimedReactionMs: 190 });
    const settlement = settleMatch([
      turnTransactionFor(a, unanimousVotes(a)),
      turnTransactionFor(b, unanimousVotes(b)),
    ]);

    expect(settlement.winner).toBeNull();
    expect(settlement.note).toBe('TIE');
  });
});

describe('leader election', () => {
  it('is deterministic for a given match', () => {
    expect(leaderFor('match-abc', 5)).toBe(leaderFor('match-abc', 5));
  });

  /**
   * Regression: a rolling `acc * 31 + c` hash degenerates with five validators
   * because 31 = 1 (mod 5), collapsing to the sum of character codes. Matches
   * sharing a prefix then all elect the same leader.
   */
  it('spreads leadership across the whole validator set', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 400; i++) {
      const leader = leaderFor(`match-seed-${i.toString(16).padStart(8, '0')}`, 5);
      counts.set(leader, (counts.get(leader) ?? 0) + 1);
    }

    expect(counts.size).toBe(5);
    // No node should take more than double its fair share of 80.
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(30);
      expect(count).toBeLessThan(160);
    }
  });
});
