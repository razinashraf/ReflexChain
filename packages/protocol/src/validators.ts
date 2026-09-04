/**
 * The registered validator set.
 *
 * Identities are derived deterministically from seeds so that every node, the
 * coordinator, and the browser all independently arrive at the same public keys
 * without a discovery handshake. This models a genesis-configured validator set
 * (which is how most permissioned chains actually bootstrap) and means a node
 * that restarts keeps its identity and is still recognised by its peers.
 */
import { keyPairFromSeed, sha256, type KeyPair } from './crypto.js';
import { VALIDATOR_BASE_PORT, VALIDATOR_COUNT } from './config.js';

export interface ValidatorIdentity {
  /** 1-based ordinal. */
  ordinal: number;
  validatorId: string; // node-01
  publicKey: string;
  address: string;
  port: number;
  httpUrl: string;
  wsUrl: string;
}

export function validatorIdFor(ordinal: number): string {
  return `node-${String(ordinal).padStart(2, '0')}`;
}

/** Full keypair - only the node itself should ever call this for its own id. */
export function validatorKeyPair(validatorId: string): KeyPair {
  return keyPairFromSeed(`validator:${validatorId}`);
}

export function coordinatorKeyPair(): KeyPair {
  return keyPairFromSeed('coordinator:reflexchain');
}

export const COORDINATOR_PUBLIC_KEY = coordinatorKeyPair().publicKey;

function buildIdentity(ordinal: number, host: string): ValidatorIdentity {
  const validatorId = validatorIdFor(ordinal);
  const kp = validatorKeyPair(validatorId);
  const port = VALIDATOR_BASE_PORT + ordinal;
  return {
    ordinal,
    validatorId,
    publicKey: kp.publicKey,
    address: kp.address,
    port,
    httpUrl: `http://${host}:${port}`,
    wsUrl: `ws://${host}:${port}`,
  };
}

/** The canonical, ordered validator set. */
export function validatorSet(count = VALIDATOR_COUNT, host = 'localhost'): ValidatorIdentity[] {
  return Array.from({ length: count }, (_, i) => buildIdentity(i + 1, host));
}

/** validatorId -> public key, for verifying votes and block proposals. */
export function validatorKeyRegistry(count = VALIDATOR_COUNT): Map<string, string> {
  const registry = new Map<string, string>();
  for (const v of validatorSet(count)) registry.set(v.validatorId, v.publicKey);
  return registry;
}

/**
 * Deterministic block proposer for a match. Every node computes the same leader
 * from the matchId alone, so no leader election round-trip is needed.
 */
export function leaderFor(matchId: string, count = VALIDATOR_COUNT): string {
  // sha256 rather than a rolling polynomial hash. The obvious `acc * 31 + c`
  // is badly behaved here: 31 = 1 (mod 5), so with five validators it collapses
  // to the sum of the character codes, and matchIds sharing a prefix pile onto
  // the same leader. A digest distributes evenly and is still deterministic,
  // so every node independently elects the same one.
  const digest = sha256(`leader:${matchId}`);
  return validatorIdFor((parseInt(digest.slice(0, 8), 16) % count) + 1);
}
