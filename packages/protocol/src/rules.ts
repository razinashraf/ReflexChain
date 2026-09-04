/**
 * Independent event validation - the heart of Proof of Reflex.
 *
 * This function is PURE. The validator process supplies its own private view of
 * the world (its own GO timestamp, its own arrival timestamp, its own seen-set)
 * and gets back a verdict. Two validators running this same code on the same
 * event legitimately reach different conclusions, because their inputs differ.
 * That is the whole design: the disagreement is real, not simulated.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not measure anyone's reflex. Only the client can observe the moment a
 * key went down. What a validator can do is bound the client's CLAIM against
 * facts it observed itself, and refuse claims that do not fit.
 */
import {
  DEFAULT_LATENCY_EPSILON_MS,
  MAX_REACTION_MS,
  MIN_HUMAN_REACTION_MS,
} from './config.js';
import { addressFromPublicKey, verifyObject } from './crypto.js';
import type { PressEvent, ReasonCode, UnsignedPressEvent, Verdict } from './types.js';

/**
 * How far behind the claimed press a node's observation may lag before the
 * event is treated as stale or replayed rather than live.
 */
export const MAX_STALENESS_MS = 3_000;

/** What this node independently recorded when it learned GO fired. */
export interface GoRecord {
  matchId: string;
  turnIndex: number;
  goSeq: number;
  /** The address whose turn this is. */
  player: string;
  /** G_i - this node's own local clock reading when it processed the GO announce. */
  localGoAt: number;
  /** Addresses registered in this match, as this node learned them. */
  players: string[];
}

export interface ValidationContext {
  validatorId: string;
  /** A_i - this node's own local clock reading when the press event arrived. */
  arrivedAt: number;
  /** This node's own GO record for the turn, or null if it never saw one. */
  goRecord: GoRecord | null;
  /** Event ids this node has already voted on (replay protection). */
  seenEventIds: ReadonlySet<string>;
  /** Per-node tolerance. Nodes may differ, which produces honest disagreement. */
  epsilonMs?: number;
}

export interface ValidationOutcome {
  verdict: Verdict;
  reasons: ReasonCode[];
  observedArrivalDeltaMs: number | null;
  canonicalReactionMs: number | null;
}

/** The exact payload a press event signature covers. */
export function pressSignaturePayload(event: PressEvent): UnsignedPressEvent {
  const { sig: _sig, ...unsigned } = event;
  return unsigned;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function wellFormed(event: PressEvent): boolean {
  return (
    !!event &&
    typeof event.eventId === 'string' &&
    event.eventId.length > 0 &&
    typeof event.matchId === 'string' &&
    event.matchId.length > 0 &&
    Number.isInteger(event.turnIndex) &&
    event.turnIndex >= 0 &&
    typeof event.player === 'string' &&
    typeof event.pubKey === 'string' &&
    typeof event.nonce === 'string' &&
    Number.isInteger(event.goSeq) &&
    isFiniteNumber(event.claimedReactionMs) &&
    (event.kind === 'PRESS' || event.kind === 'FALSE_START') &&
    typeof event.sig === 'string'
  );
}

/**
 * Validate a press event against THIS node's private observations.
 *
 * Returns REJECT with reason FALSE_START for a false start. That is deliberate:
 * a false start is a legitimate, recordable turn outcome, not a malformed
 * event, and the tally maps a quorum of FALSE_START rejections onto the
 * FALSE_START turn outcome so it still lands on the chain with real votes.
 */
export function validateEvent(event: PressEvent, ctx: ValidationContext): ValidationOutcome {
  const epsilon = ctx.epsilonMs ?? DEFAULT_LATENCY_EPSILON_MS;
  const reject = (
    reason: ReasonCode,
    observed: number | null = null,
  ): ValidationOutcome => ({
    verdict: 'REJECT',
    reasons: [reason],
    observedArrivalDeltaMs: observed,
    canonicalReactionMs: null,
  });

  if (!wellFormed(event)) return reject('MALFORMED');

  // --- 1. Authenticity. The address must be derived from the presented key, or
  //        anyone could sign their own event and claim another player's slot. ---
  if (addressFromPublicKey(event.pubKey) !== event.player) return reject('UNKNOWN_PLAYER');
  if (!verifyObject(pressSignaturePayload(event), event.sig, event.pubKey)) {
    return reject('BAD_SIGNATURE');
  }

  // --- 2. Replay protection. ---
  if (ctx.seenEventIds.has(event.eventId)) return reject('DUPLICATE');

  // --- 3. False start, detected independently.
  //        If this node has no GO record for the turn, the press physically
  //        preceded the GO signal reaching it. The node does not need to trust
  //        the client's self-report to reach that conclusion. ---
  const go = ctx.goRecord;
  if (!go || go.matchId !== event.matchId || go.turnIndex !== event.turnIndex) {
    return reject('FALSE_START');
  }
  if (event.kind === 'FALSE_START') return reject('FALSE_START');

  // --- 4. Round and participant checks. ---
  if (go.goSeq !== event.goSeq) return reject('WRONG_ROUND');
  if (!go.players.includes(event.player)) return reject('UNKNOWN_PLAYER');
  if (go.player !== event.player) return reject('WRONG_ROUND'); // not this player's turn

  const observed = ctx.arrivedAt - go.localGoAt;

  // --- 5. Physiological bounds.
  //        The floor is the check that actually constrains an optimistic
  //        claim: nothing else in the protocol can catch a client that shaves
  //        its own number, so we refuse anything below human capability. ---
  if (event.claimedReactionMs < MIN_HUMAN_REACTION_MS) {
    return reject('BELOW_HUMAN_FLOOR', observed);
  }
  if (event.claimedReactionMs > MAX_REACTION_MS) {
    return reject('ABOVE_MAX_REACTION', observed);
  }

  // --- 6. Latency envelope, measured against this node's own observation.
  //        Upper side: you cannot have reacted for longer than the window this
  //        node watched elapse. Lower side: if the node observed the event far
  //        later than the claim implies, it is stale or replayed rather than
  //        live. Both bounds use only facts this node measured itself. ---
  if (event.claimedReactionMs > observed + epsilon) {
    return reject('LATENCY_ENVELOPE_FAIL', observed);
  }
  if (observed - event.claimedReactionMs > MAX_STALENESS_MS) {
    return reject('LATENCY_ENVELOPE_FAIL', observed);
  }

  return {
    verdict: 'ACCEPT',
    reasons: [
      'SIG_OK',
      'ROUND_OK',
      'NOT_DUPLICATE',
      'WITHIN_HUMAN_RANGE',
      'WITHIN_LATENCY_ENVELOPE',
    ],
    observedArrivalDeltaMs: observed,
    canonicalReactionMs: event.claimedReactionMs,
  };
}
