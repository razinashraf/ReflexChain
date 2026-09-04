/**
 * Hashing and ed25519 identity.
 *
 * Runs unchanged in Node and in the browser, which matters because the player's
 * browser signs press events and the validators verify them. Uses @noble rather
 * than node:crypto or WebCrypto precisely so both sides share one implementation.
 */
import * as ed from '@noble/ed25519';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2';
import { sha512 } from '@noble/hashes/sha512';
import { canonicalJSON } from './canonical.js';

// @noble/ed25519 v2 ships without a bundled hash; wire up the sync path once.
if (!ed.etc.sha512Sync) {
  ed.etc.sha512Sync = (...msgs: Uint8Array[]) => sha512(ed.etc.concatBytes(...msgs));
}

const encoder = new TextEncoder();

export function bytesToHex(bytes: Uint8Array): string {
  return ed.etc.bytesToHex(bytes);
}

export function hexToBytes(hex: string): Uint8Array {
  return ed.etc.hexToBytes(hex);
}

/** sha256 of a UTF-8 string, hex encoded. */
export function sha256(input: string): string {
  return bytesToHex(nobleSha256(encoder.encode(input)));
}

/** sha256 over the canonical serialization of an object. */
export function hashObject(value: unknown): string {
  return sha256(canonicalJSON(value));
}

export interface KeyPair {
  privateKey: string;
  publicKey: string;
  address: string;
}

/**
 * Wallet-style address: 0x + first 20 bytes of sha256(publicKey).
 * Cosmetic in the sense that no money exists, but derived honestly - the
 * address genuinely commits to the key that signs the player's events.
 */
export function addressFromPublicKey(publicKeyHex: string): string {
  return '0x' + sha256(publicKeyHex).slice(0, 40);
}

export function generateKeyPair(): KeyPair {
  const priv = ed.utils.randomPrivateKey();
  const pub = ed.getPublicKey(priv);
  const publicKey = bytesToHex(pub);
  return {
    privateKey: bytesToHex(priv),
    publicKey,
    address: addressFromPublicKey(publicKey),
  };
}

/**
 * Deterministic keypair from a seed string. Used for validator identities so a
 * node that restarts keeps the same public key and peers still recognise it.
 */
export function keyPairFromSeed(seed: string): KeyPair {
  const priv = nobleSha256(encoder.encode(`reflexchain:v1:${seed}`));
  const pub = ed.getPublicKey(priv);
  const publicKey = bytesToHex(pub);
  return {
    privateKey: bytesToHex(priv),
    publicKey,
    address: addressFromPublicKey(publicKey),
  };
}

/** Sign the canonical serialization of `payload`. */
export function signObject(payload: unknown, privateKeyHex: string): string {
  const msg = encoder.encode(canonicalJSON(payload));
  return bytesToHex(ed.sign(msg, hexToBytes(privateKeyHex)));
}

/**
 * Verify a signature over the canonical serialization of `payload`.
 * Never throws - malformed keys or signatures return false, because a
 * validator receiving garbage from the network must vote REJECT, not crash.
 */
export function verifyObject(payload: unknown, sigHex: string, publicKeyHex: string): boolean {
  try {
    if (!sigHex || !publicKeyHex) return false;
    const msg = encoder.encode(canonicalJSON(payload));
    return ed.verify(hexToBytes(sigHex), msg, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

export function randomHex(bytes = 16): string {
  return bytesToHex(ed.etc.randomBytes(bytes));
}

/** Short display form for hashes and addresses: 7AF3C1...92FE */
export function shortHash(hash: string, head = 6, tail = 4): string {
  if (!hash) return '';
  const body = hash.startsWith('0x') ? hash.slice(2) : hash;
  if (body.length <= head + tail) return hash.toUpperCase();
  const prefix = hash.startsWith('0x') ? '0x' : '';
  return `${prefix}${body.slice(0, head)}...${body.slice(-tail)}`.toUpperCase();
}
