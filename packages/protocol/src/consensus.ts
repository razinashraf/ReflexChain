/**
 * Vote tallying and match settlement. Pure functions - every validator runs
 * these over the votes it has gossiped and received, and reaches the same
 * conclusion given the same vote set.
 */
import { VALIDATOR_COUNT, quorumFor } from './config.js';
import { computeTxId } from './block.js';
import type { TallyResult, TurnOutcome, TurnTransaction, Vote } from './types.js';

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export interface TallyOptions {
  registeredValidators?: number;
  /** True once the collection window has closed; turns PENDING into INCONCLUSIVE. */
  windowClosed?: boolean;
}

/**
 * Tally votes for one turn.
 *
 * Quorum is computed over the REGISTERED validator set, never the online set.
 * If it were computed over whoever happens to be reachable, a single partitioned
 * node could "reach quorum" alone, which would not be safety in any meaningful
 * sense.
 */
export function tallyVotes(votes: Vote[], options: TallyOptions = {}): TallyResult {
  const registered = options.registeredValidators ?? VALIDATOR_COUNT;
  const threshold = quorumFor(registered);

  // One vote per validator; a node that votes twice does not get two votes.
  const byValidator = new Map<string, Vote>();
  for (const vote of votes) {
    if (!byValidator.has(vote.validatorId)) byValidator.set(vote.validatorId, vote);
  }
  const unique = [...byValidator.values()];

  const accepts = unique.filter((v) => v.verdict === 'ACCEPT');
  const rejects = unique.filter((v) => v.verdict === 'REJECT');
  const approvals = accepts.length;
  const rejections = rejects.length;

  // Once this many nodes have rejected, the remaining nodes cannot reach the
  // threshold even if every one of them accepts.
  const quorumUnreachable = rejections > registered - threshold;

  // An ACCEPT is decided the moment the threshold is met - more votes cannot
  // unmake it. A REJECT is different: quorum can become arithmetically
  // unreachable after only two votes, but WHY the turn failed is not yet known.
  // Settling there would label a false start as a generic rejection, so we wait
  // until every registered node has spoken or the window closes.
  const allVotesIn = unique.length >= registered;
  const rejectionDecided = quorumUnreachable && (allVotesIn || options.windowClosed === true);

  let status: TallyResult['status'];
  let outcome: TurnOutcome;

  if (approvals >= threshold) {
    status = 'CONFIRMED';
    outcome = 'VALID';
  } else if (rejectionDecided) {
    status = 'REJECTED';
    // Classify the rejection by its dominant cause among the nodes that
    // actually rejected. A press that preceded GO is a false start - a real,
    // recordable turn outcome - rather than a protocol error.
    const falseStarts = rejects.filter((v) => v.reasons.includes('FALSE_START')).length;
    outcome = falseStarts > rejections / 2 ? 'FALSE_START' : 'REJECTED';
  } else if (options.windowClosed) {
    status = 'INCONCLUSIVE';
    outcome = 'INCONCLUSIVE';
  } else {
    status = 'PENDING';
    outcome = 'INCONCLUSIVE';
  }

  // Median rather than mean: one Byzantine node reporting an absurd number
  // cannot drag the canonical value, because it only shifts the ordering.
  const canonicalReactionMs =
    status === 'CONFIRMED'
      ? median(
          accepts
            .map((v) => v.canonicalReactionMs)
            .filter((n): n is number => typeof n === 'number'),
        )
      : null;

  const majority: 'ACCEPT' | 'REJECT' = approvals >= rejections ? 'ACCEPT' : 'REJECT';
  const dissenters = unique.filter((v) => v.verdict !== majority).map((v) => v.validatorId);

  return {
    status,
    approvals,
    rejections,
    total: unique.length,
    threshold,
    registered,
    canonicalReactionMs,
    outcome,
    dissenters,
  };
}

/** Build the on-chain transaction for a settled turn. */
export function buildTurnTransaction(args: {
  matchId: string;
  turnIndex: number;
  player: string;
  eventId: string;
  votes: Vote[];
  tally: TallyResult;
}): TurnTransaction {
  const body = {
    matchId: args.matchId,
    turnIndex: args.turnIndex,
    player: args.player,
    outcome: args.tally.outcome,
    reactionMs: args.tally.canonicalReactionMs,
    eventId: args.eventId,
    // Votes are sorted so every node builds a byte-identical transaction and
    // therefore an identical block hash.
    votes: [...args.votes].sort((a, b) => a.validatorId.localeCompare(b.validatorId)),
    approvals: args.tally.approvals,
    total: args.tally.registered,
  };
  return { txId: computeTxId(body), ...body };
}
