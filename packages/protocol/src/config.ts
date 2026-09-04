/**
 * REFLEXCHAIN protocol constants.
 *
 * These values are part of consensus: every validator must agree on them or
 * nodes will legitimately disagree about whether an event was admissible.
 */

export const PROTOCOL_VERSION = 'proof-of-reflex/1.0.0';

/** Number of registered validators in the network. */
export const VALIDATOR_COUNT = Number(process.env.RFX_VALIDATOR_COUNT ?? 5);

/** Base TCP port; validator N listens on BASE_PORT + N. node-01 -> 7001. */
export const VALIDATOR_BASE_PORT = Number(process.env.RFX_VALIDATOR_BASE_PORT ?? 7000);

export const COORDINATOR_PORT = Number(process.env.RFX_COORDINATOR_PORT ?? 4000);

/**
 * Byzantine-fault-tolerant quorum: floor(2n/3) + 1.
 * n=5 -> 4. Tolerates 1 faulty/offline node; halts at 2.
 *
 * IMPORTANT: this is always computed over the REGISTERED validator set, never
 * the currently-online set. Recomputing it over online nodes would let a
 * partition of one node "reach quorum" by itself, which is not safety.
 */
export function quorumFor(registeredValidators: number): number {
  return Math.floor((2 * registeredValidators) / 3) + 1;
}

/**
 * Human reaction floor. Below this you did not react to the GO signal, you
 * anticipated it. ~80ms is faster than the fastest recorded simple visual
 * reaction times, so anything under it is rejected as physiologically invalid.
 */
export const MIN_HUMAN_REACTION_MS = 80;

/** Upper sanity bound; beyond this the client almost certainly stalled. */
export const MAX_REACTION_MS = 10_000;

/**
 * Latency envelope slack, in ms.
 *
 * A validator observed the press arrive `A_i - G_i` ms after it learned GO
 * fired. The client's claimed reaction must fit inside that window plus this
 * epsilon, which absorbs network transit, render latency and scheduler jitter.
 *
 * Per-node overridable via RFX_EPSILON_MS so nodes can legitimately disagree
 * on borderline events -- that divergence is the point.
 */
export const DEFAULT_LATENCY_EPSILON_MS = Number(process.env.RFX_EPSILON_MS ?? 400);

/** How long a validator waits for peer votes before declaring INCONCLUSIVE. */
export const VOTE_TIMEOUT_MS = 2500;

/** Fixed genesis timestamp so all nodes independently derive an identical genesis block. */
export const GENESIS_TIMESTAMP = 1_735_689_600_000; // 2025-01-01T00:00:00.000Z

export const ZERO_HASH = '0'.repeat(64);

/** Turn phase timings owned by the coordinator. */
export const RED_LIGHT_MIN_MS = 1_500;
export const RED_LIGHT_MAX_MS = 4_500;
