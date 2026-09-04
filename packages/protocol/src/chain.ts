/**
 * Whole-chain validation.
 *
 * This is the function behind the CHAIN COMPROMISED banner. It is real: it
 * recomputes every hash, re-walks every previousHash link, and re-verifies
 * every embedded signature. Nothing about the tamper demo is animated.
 */
import { ZERO_HASH } from './config.js';
import { computeBlockHash, createGenesisBlock, verifyBlock, type VerifyBlockOptions } from './block.js';
import type { Block, ChainError, ChainValidationResult } from './types.js';

export function validateChain(
  chain: Block[],
  options: VerifyBlockOptions = {},
): ChainValidationResult {
  const errors: ChainError[] = [];
  const height = chain.length === 0 ? 0 : chain.length - 1;
  const headHash = chain.length === 0 ? '' : chain[chain.length - 1]!.hash;

  if (chain.length === 0) {
    return {
      valid: false,
      firstInvalidIndex: 0,
      errors: [{ index: 0, code: 'EMPTY_CHAIN', detail: 'chain has no blocks' }],
      height: 0,
      headHash: '',
    };
  }

  // --- genesis must be the canonical one every node derives independently ---
  const genesis = chain[0]!;
  const expectedGenesis = createGenesisBlock();
  if (genesis.index !== 0 || genesis.hash !== expectedGenesis.hash) {
    errors.push({
      index: 0,
      code: 'BAD_GENESIS',
      detail: `genesis hash ${genesis.hash.slice(0, 16)} != canonical ${expectedGenesis.hash.slice(0, 16)}`,
    });
  }
  if (genesis.previousHash !== ZERO_HASH) {
    errors.push({
      index: 0,
      code: 'PREVIOUS_HASH_BROKEN',
      detail: 'genesis previousHash must be all zeroes',
    });
  }

  for (let i = 0; i < chain.length; i++) {
    const block = chain[i]!;

    if (block.index !== i) {
      errors.push({
        index: i,
        code: 'INDEX_OUT_OF_ORDER',
        detail: `block declares index ${block.index} at position ${i}`,
      });
    }

    // Per-block internal consistency: hash, merkle root, quorum, signatures.
    errors.push(...verifyBlock(block, options));

    if (i > 0) {
      const previous = chain[i - 1]!;

      if (block.previousHash !== previous.hash) {
        errors.push({
          index: i,
          code: 'PREVIOUS_HASH_BROKEN',
          detail: `previousHash ${block.previousHash.slice(0, 16)} != block #${previous.index} hash ${previous.hash.slice(0, 16)}`,
        });
      }

      if (block.timestamp < previous.timestamp) {
        errors.push({
          index: i,
          code: 'NON_MONOTONIC_TIMESTAMP',
          detail: `block #${i} timestamp precedes block #${i - 1}`,
        });
      }
    }
  }

  const firstInvalidIndex =
    errors.length === 0 ? null : errors.reduce((min, e) => Math.min(min, e.index), Infinity);

  return {
    valid: errors.length === 0,
    firstInvalidIndex: firstInvalidIndex === null ? null : (firstInvalidIndex as number),
    errors,
    height,
    headHash,
  };
}

/**
 * Is `block` a valid successor to `tip`? This is the check a node runs before
 * appending a proposed block to its own chain, and refusing here is exactly how
 * a tampered node ends up forked away from its peers.
 */
export function verifyBlockAgainstTip(
  block: Block,
  tip: Block,
  options: VerifyBlockOptions = {},
): ChainError[] {
  const errors = verifyBlock(block, options);

  if (block.index !== tip.index + 1) {
    errors.push({
      index: block.index,
      code: 'INDEX_OUT_OF_ORDER',
      detail: `expected index ${tip.index + 1}, got ${block.index}`,
    });
  }

  if (block.previousHash !== tip.hash) {
    errors.push({
      index: block.index,
      code: 'PREVIOUS_HASH_BROKEN',
      detail: `previousHash ${block.previousHash.slice(0, 16)} != local tip ${tip.hash.slice(0, 16)}`,
    });
  }

  return errors;
}

export function chainHeight(chain: Block[]): number {
  return chain.length === 0 ? 0 : chain.length - 1;
}

export function headOf(chain: Block[]): Block | null {
  return chain.length === 0 ? null : chain[chain.length - 1]!;
}

export function countTransactions(chain: Block[]): number {
  return chain.reduce((total, block) => total + block.transactions.length, 0);
}

/**
 * Re-derives a block hash the way a naive tamperer would after editing a field.
 * Exposed so the tamper demo can offer both the sloppy variant (leave the hash
 * alone -> HASH_MISMATCH on that block) and the sophisticated variant (fix the
 * local hash -> the break moves to previousHash on every later block, and the
 * proposer signature stops matching).
 */
export function rehashBlock(block: Block): Block {
  return { ...block, hash: computeBlockHash(block) };
}
