/**
 * The player's local identity.
 *
 * An ed25519 keypair generated in the browser and kept in localStorage. The
 * private key never leaves the device; it signs every press event, and the
 * validators verify that signature before counting a vote.
 *
 * There is no currency, no balance and no transfer of anything. The address is
 * a wallet-shaped name for a signing key, and nothing else.
 */
import {
  addressFromPublicKey,
  generateKeyPair,
  hashObject,
  randomHex,
  signObject,
  type KeyPair,
  type PressEvent,
  type PressKind,
  type UnsignedPressEvent,
} from '@reflexchain/protocol';

const STORAGE_KEY = 'reflexchain.wallet.v1';

export interface Wallet extends KeyPair {
  label: string;
}

function makeLabel(address: string): string {
  return `PLAYER ${address.slice(2, 6).toUpperCase()}`;
}

export function loadWallet(): Wallet {
  if (typeof window === 'undefined') {
    const kp = generateKeyPair();
    return { ...kp, label: makeLabel(kp.address) };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Wallet;
      // Recompute rather than trust what was stored, so a hand-edited entry
      // cannot claim an address that does not follow from its key.
      if (parsed?.privateKey && parsed?.publicKey) {
        const address = addressFromPublicKey(parsed.publicKey);
        return { ...parsed, address, label: parsed.label || makeLabel(address) };
      }
    }
  } catch {
    /* corrupt or unavailable storage - fall through and mint a fresh one */
  }

  const kp = generateKeyPair();
  const wallet: Wallet = { ...kp, label: makeLabel(kp.address) };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
  } catch {
    /* private mode; the wallet just will not persist across reloads */
  }
  return wallet;
}

export function saveWallet(wallet: Wallet): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
  } catch {
    /* nothing to do; the in-memory wallet still works for this session */
  }
}

/** A second identity for hotseat mode, so both seats sign with distinct keys. */
export function mintWallet(label: string): Wallet {
  const kp = generateKeyPair();
  return { ...kp, label };
}

export interface BuildPressArgs {
  wallet: Wallet;
  matchId: string;
  turnIndex: number;
  goSeq: number;
  reactionMs: number;
  kind?: PressKind;
}

/**
 * Build and sign a press event.
 *
 * `reactionMs` comes from performance.now() deltas measured in this tab. That
 * is an honest, monotonic, client-side measurement - and it is a CLAIM. The
 * network's job is to decide whether the claim is admissible, not to reproduce it.
 */
export function buildPressEvent(args: BuildPressArgs): PressEvent {
  const nonce = randomHex(8);
  const unsigned: UnsignedPressEvent = {
    eventId: hashObject({
      matchId: args.matchId,
      turnIndex: args.turnIndex,
      player: args.wallet.address,
      nonce,
    }).slice(0, 16),
    matchId: args.matchId,
    turnIndex: args.turnIndex,
    player: args.wallet.address,
    pubKey: args.wallet.publicKey,
    nonce,
    goSeq: args.goSeq,
    claimedReactionMs: Math.round(args.reactionMs),
    kind: args.kind ?? 'PRESS',
  };

  return { ...unsigned, sig: signObject(unsigned, args.wallet.privateKey) };
}
