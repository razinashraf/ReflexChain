/**
 * Match settlement.
 *
 * Lives in its own module (rather than inside consensus.ts) so that block.ts
 * can re-derive a block's winner during verification without creating an import
 * cycle. That re-derivation matters: without it, a dishonest block proposer
 * could publish a perfectly-hashed, perfectly-signed block naming the WRONG
 * winner, and every structural check would pass.
 */
import type { TurnTransaction } from './types.js';

/**
 * How many validators agreed with the outcome this transaction records.
 *
 * NOT the same as approvals. A false start is settled by a quorum of nodes
 * REJECTING the press - the network agreed decisively about what happened, and
 * its approval count is legitimately zero. Quorum must therefore be measured
 * against the recorded outcome, not against acceptance, or every false start
 * would be unable to reach a block.
 *
 * Recomputable by any observer from the votes the block itself carries.
 */
export function agreementFor(tx: TurnTransaction): number {
  const wanted = tx.outcome === 'VALID' ? 'ACCEPT' : 'REJECT';
  return tx.votes.filter((v) => v.verdict === wanted).length;
}

/** The weakest-settled turn in a block; this is what quorum is checked against. */
export function blockAgreement(transactions: TurnTransaction[]): number {
  if (transactions.length === 0) return 0;
  return Math.min(...transactions.map(agreementFor));
}

export interface MatchSettlement {
  winner: string | null;
  winningReactionMs: number | null;
  /** Human-readable reason, for the UI. */
  note: string;
}

/**
 * Decide the match from its settled turns. Only turns the network confirmed as
 * VALID are eligible - a false start forfeits that turn outright.
 */
export function settleMatch(transactions: TurnTransaction[]): MatchSettlement {
  const valid = transactions.filter(
    (tx) => tx.outcome === 'VALID' && typeof tx.reactionMs === 'number',
  );

  if (valid.length === 0) {
    return { winner: null, winningReactionMs: null, note: 'NO VALID REACTIONS' };
  }

  if (valid.length === 1) {
    const only = valid[0]!;
    return {
      winner: only.player,
      winningReactionMs: only.reactionMs,
      note: 'OPPONENT FORFEITED TURN',
    };
  }

  const sorted = [...valid].sort((a, b) => a.reactionMs! - b.reactionMs!);
  const best = sorted[0]!;
  const runnerUp = sorted[1]!;

  if (best.reactionMs === runnerUp.reactionMs) {
    return { winner: null, winningReactionMs: best.reactionMs, note: 'TIE' };
  }

  return {
    winner: best.player,
    winningReactionMs: best.reactionMs,
    note: `FASTEST VALID REACTION BY ${runnerUp.reactionMs! - best.reactionMs!} MS`,
  };
}
