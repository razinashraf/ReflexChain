import { describe, expect, it } from 'vitest';
import {
  canonicalJSON,
  computeBlockHash,
  computeMerkleRoot,
  createGenesisBlock,
  rehashBlock,
  validateChain,
  verifyBlockAgainstTip,
  ZERO_HASH,
} from '../src/index.js';
import { agreementFor, blockAgreement } from '../src/index.js';
import { buildChain, buildFalseStartBlock, buildMatchBlock } from './helpers.js';

describe('canonical serialization', () => {
  it('is independent of key insertion order', () => {
    const a = { winner: 'PLAYER 01', index: 4, nested: { b: 2, a: 1 } };
    const b = { nested: { a: 1, b: 2 }, index: 4, winner: 'PLAYER 01' };
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
  });

  it('omits undefined rather than emitting null', () => {
    expect(canonicalJSON({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('refuses non-finite numbers instead of silently emitting null', () => {
    expect(() => canonicalJSON({ x: Number.NaN })).toThrow();
  });
});

describe('genesis block', () => {
  it('is deterministic, so every node derives an identical genesis', () => {
    const a = createGenesisBlock();
    const b = createGenesisBlock();
    expect(a.hash).toBe(b.hash);
    expect(a.index).toBe(0);
    expect(a.previousHash).toBe(ZERO_HASH);
  });

  it('has a hash that matches its own contents', () => {
    const genesis = createGenesisBlock();
    expect(computeBlockHash(genesis)).toBe(genesis.hash);
  });
});

describe('block hashing', () => {
  it('produces a 64-char sha256 hex digest', () => {
    const { block } = buildMatchBlock({
      index: 1,
      previousHash: createGenesisBlock().hash,
      matchId: 'match-1',
      reactions: [183, 205],
    });
    expect(block.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any field of the block changes', () => {
    const { block } = buildMatchBlock({
      index: 1,
      previousHash: createGenesisBlock().hash,
      matchId: 'match-1',
      reactions: [183, 205],
    });
    const mutated = { ...block, winner: '0xdeadbeef' };
    expect(computeBlockHash(mutated)).not.toBe(block.hash);
  });

  it('excludes proposerSig from its own preimage', () => {
    const { block } = buildMatchBlock({
      index: 1,
      previousHash: createGenesisBlock().hash,
      matchId: 'match-1',
      reactions: [183, 205],
    });
    expect(computeBlockHash({ ...block, proposerSig: 'ffff' })).toBe(block.hash);
  });
});

describe('merkle root', () => {
  it('is the zero hash for an empty transaction list', () => {
    expect(computeMerkleRoot([])).toBe(ZERO_HASH);
  });

  it('changes when a transaction is altered', () => {
    const { block, transactions } = buildMatchBlock({
      index: 1,
      previousHash: createGenesisBlock().hash,
      matchId: 'match-1',
      reactions: [183, 205],
    });
    const altered = [{ ...transactions[0]!, reactionMs: 1 }, transactions[1]!];
    expect(computeMerkleRoot(altered)).not.toBe(block.merkleRoot);
  });
});

describe('chain validation', () => {
  it('accepts a well-formed chain', () => {
    const result = validateChain(buildChain(4));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.height).toBe(4);
  });

  it('rejects an empty chain', () => {
    const result = validateChain([]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.code).toBe('EMPTY_CHAIN');
  });

  it('detects a tampered block whose hash was left alone', () => {
    const chain = buildChain(4);
    // The sloppy tamper: rewrite the winner, do not touch the stored hash.
    chain[2] = { ...chain[2]!, winner: '0xattacker' };

    const result = validateChain(chain);
    expect(result.valid).toBe(false);
    expect(result.firstInvalidIndex).toBe(2);
    expect(result.errors.some((e) => e.index === 2 && e.code === 'HASH_MISMATCH')).toBe(true);
  });

  it('cascades to every later block when the tamperer recomputes the hash', () => {
    const chain = buildChain(4);
    // The sophisticated tamper: rewrite the winner AND fix the local hash so
    // the block is internally self-consistent.
    chain[2] = rehashBlock({ ...chain[2]!, winner: '0xattacker' });

    const result = validateChain(chain);
    expect(result.valid).toBe(false);

    // Block 2 now hashes correctly, but the signature was over the OLD hash.
    expect(
      result.errors.some((e) => e.index === 2 && e.code === 'BAD_PROPOSER_SIGNATURE'),
    ).toBe(true);

    // And every subsequent block is orphaned from the rewritten one.
    expect(
      result.errors.some((e) => e.index === 3 && e.code === 'PREVIOUS_HASH_BROKEN'),
    ).toBe(true);
    expect(result.firstInvalidIndex).toBe(2);
  });

  it('detects a broken previousHash link', () => {
    const chain = buildChain(3);
    chain[2] = rehashBlock({ ...chain[2]!, previousHash: ZERO_HASH });

    const result = validateChain(chain);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.index === 2 && e.code === 'PREVIOUS_HASH_BROKEN'),
    ).toBe(true);
  });

  it('detects a forged genesis', () => {
    const chain = buildChain(2);
    chain[0] = rehashBlock({ ...chain[0]!, timestamp: 1 });

    const result = validateChain(chain);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'BAD_GENESIS')).toBe(true);
  });

  it('detects a block that does not meet quorum', () => {
    const chain = buildChain(2);
    chain[1] = rehashBlock({
      ...chain[1]!,
      consensus: { approvals: 2, total: 5, threshold: 4 },
    });

    const result = validateChain(chain);
    expect(result.errors.some((e) => e.code === 'QUORUM_NOT_MET')).toBe(true);
  });

  it('catches a block that names a winner its own transactions do not support', () => {
    // A Byzantine proposer can hash and sign a block perfectly. What it cannot
    // do is make a wrong winner follow from the votes the block itself carries.
    const chain = buildChain(2);
    const block = chain[1]!;
    const loser = block.transactions.find((tx) => tx.player !== block.winner)!;
    chain[1] = rehashBlock({
      ...block,
      winner: loser.player,
      winningReactionMs: loser.reactionMs,
    });

    const result = validateChain(chain);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'WINNER_MISMATCH')).toBe(true);
  });

  it('detects a forged vote signature inside a block', () => {
    const chain = buildChain(2);
    const block = chain[1]!;
    const tx = block.transactions[0]!;
    const forgedVotes = [{ ...tx.votes[0]!, canonicalReactionMs: 1 }, ...tx.votes.slice(1)];
    const forgedTx = { ...tx, votes: forgedVotes };
    chain[1] = rehashBlock({
      ...block,
      transactions: [forgedTx, block.transactions[1]!],
      merkleRoot: computeMerkleRoot([forgedTx, block.transactions[1]!]),
    });

    const result = validateChain(chain);
    expect(result.errors.some((e) => e.code === 'BAD_VOTE_SIGNATURE')).toBe(true);
  });
});

describe('quorum is measured against the recorded outcome', () => {
  /**
   * Regression: a false start is settled by a quorum REJECTING the press, so
   * its approval count is legitimately zero. Checking raw approvals made it
   * impossible to ever commit a block containing one.
   */
  it('accepts a block whose turn was settled by a quorum of rejections', () => {
    const { block, falseStartTx } = buildFalseStartBlock({
      index: 1,
      previousHash: createGenesisBlock().hash,
      matchId: 'match-fs',
    });

    expect(falseStartTx.outcome).toBe('FALSE_START');
    expect(falseStartTx.approvals).toBe(0);
    expect(agreementFor(falseStartTx)).toBe(5);

    const result = validateChain([createGenesisBlock(), block]);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects a block whose advertised agreement does not match its votes', () => {
    const chain = buildChain(2);
    // Every vote in this block is an ACCEPT, so the true agreement is 5.
    expect(blockAgreement(chain[1]!.transactions)).toBe(5);

    // Advertise 4 instead. Still above threshold, so only the consistency check
    // can catch it - the number a block claims must follow from its own votes.
    chain[1] = rehashBlock({
      ...chain[1]!,
      consensus: { approvals: 4, total: 5, threshold: 4 },
    });

    const result = validateChain(chain);
    expect(result.errors.some((e) => e.code === 'QUORUM_NOT_MET')).toBe(true);
  });

  it('measures a block by its weakest turn', () => {
    const { block } = buildMatchBlock({
      index: 1,
      previousHash: createGenesisBlock().hash,
      matchId: 'match-1',
      reactions: [183, 205],
    });
    expect(blockAgreement(block.transactions)).toBe(
      Math.min(...block.transactions.map(agreementFor)),
    );
  });
});

describe('appending against a local tip', () => {
  it('accepts a correctly linked successor', () => {
    const chain = buildChain(2);
    const tip = chain[chain.length - 1]!;
    const { block } = buildMatchBlock({
      index: 3,
      previousHash: tip.hash,
      matchId: 'match-3',
      reactions: [190, 240],
      timestamp: tip.timestamp + 1000,
    });
    expect(verifyBlockAgainstTip(block, tip)).toEqual([]);
  });

  it('refuses a block built on a different tip, which is how a fork is caught', () => {
    const chain = buildChain(2);
    const tip = chain[chain.length - 1]!;
    const { block } = buildMatchBlock({
      index: 3,
      previousHash: ZERO_HASH, // built on someone else's history
      matchId: 'match-3',
      reactions: [190, 240],
    });
    const errors = verifyBlockAgainstTip(block, tip);
    expect(errors.some((e) => e.code === 'PREVIOUS_HASH_BROKEN')).toBe(true);
  });
});
