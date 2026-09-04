/**
 * Block construction, hashing and single-block verification.
 *
 * The hash preimage is the entire block minus `proposerSig` and `hash`. The
 * proposer then signs the resulting hash, which is why the signature can be
 * excluded from its own preimage without any circularity.
 */
import { GENESIS_TIMESTAMP, ZERO_HASH, quorumFor, VALIDATOR_COUNT } from './config.js';
import { hashObject, randomHex, sha256, signObject, verifyObject } from './crypto.js';
import { canonicalJSON } from './canonical.js';
import { validatorKeyRegistry } from './validators.js';
import { blockAgreement, settleMatch } from './settlement.js';
import type {
  Block,
  BlockHashInput,
  ChainError,
  ConsensusMeta,
  TurnTransaction,
  Vote,
} from './types.js';

/** The exact bytes hashed for a block. */
export function blockHashInput(block: Block | BlockHashInput): BlockHashInput {
  return {
    index: block.index,
    timestamp: block.timestamp,
    matchId: block.matchId,
    transactions: block.transactions,
    winner: block.winner,
    winningReactionMs: block.winningReactionMs,
    previousHash: block.previousHash,
    merkleRoot: block.merkleRoot,
    nonce: block.nonce,
    proposer: block.proposer,
    consensus: block.consensus,
  };
}

export function computeBlockHash(block: Block | BlockHashInput): string {
  return hashObject(blockHashInput(block));
}

/** Stable id for a turn transaction. */
export function computeTxId(tx: Omit<TurnTransaction, 'txId'>): string {
  return hashObject({
    matchId: tx.matchId,
    turnIndex: tx.turnIndex,
    player: tx.player,
    eventId: tx.eventId,
    outcome: tx.outcome,
    reactionMs: tx.reactionMs,
  }).slice(0, 16);
}

/**
 * Binary merkle root over transaction ids. With two transactions per block this
 * is admittedly a one-level tree, but it is genuinely computed and genuinely
 * re-verified by every node, so a tampered transaction list is caught here as
 * well as by the block hash.
 */
export function computeMerkleRoot(transactions: TurnTransaction[]): string {
  if (transactions.length === 0) return ZERO_HASH;

  let level = transactions.map((tx) => sha256(canonicalJSON(tx)));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1] ?? left; // odd node duplicates
      next.push(sha256(left + right));
    }
    level = next;
  }
  return level[0]!;
}

/**
 * The genesis block. Fully deterministic: every node derives byte-identical
 * genesis independently, which is what lets them agree on a common ancestor
 * without ever exchanging it.
 */
export function createGenesisBlock(): Block {
  const base: BlockHashInput = {
    index: 0,
    timestamp: GENESIS_TIMESTAMP,
    matchId: 'genesis',
    transactions: [],
    winner: null,
    winningReactionMs: null,
    previousHash: ZERO_HASH,
    merkleRoot: ZERO_HASH,
    nonce: 'the-fastest-valid-reaction-becomes-the-next-block',
    proposer: 'network',
    consensus: { approvals: 0, total: 0, threshold: 0 },
  };
  return { ...base, proposerSig: '', hash: computeBlockHash(base) };
}

export interface CreateBlockArgs {
  index: number;
  previousHash: string;
  matchId: string;
  transactions: TurnTransaction[];
  winner: string | null;
  winningReactionMs: number | null;
  proposer: string;
  consensus: ConsensusMeta;
  /** Proposer private key; the block is signed on creation. */
  privateKey: string;
  timestamp?: number;
  nonce?: string;
}

export function createBlock(args: CreateBlockArgs): Block {
  const base: BlockHashInput = {
    index: args.index,
    timestamp: args.timestamp ?? Date.now(),
    matchId: args.matchId,
    transactions: args.transactions,
    winner: args.winner,
    winningReactionMs: args.winningReactionMs,
    previousHash: args.previousHash,
    merkleRoot: computeMerkleRoot(args.transactions),
    nonce: args.nonce ?? randomHex(8),
    proposer: args.proposer,
    consensus: args.consensus,
  };

  const hash = computeBlockHash(base);
  // The proposer signs the hash itself, not the body, so verification is one
  // cheap check once the hash has already been recomputed.
  const proposerSig = signHash(hash, args.privateKey);
  return { ...base, proposerSig, hash };
}

function signHash(hash: string, privateKey: string): string {
  return signObject({ blockHash: hash }, privateKey);
}

export function verifyProposerSignature(block: Block, publicKey: string): boolean {
  return verifyObject({ blockHash: block.hash }, block.proposerSig, publicKey);
}

/** The unsigned view of a vote, i.e. exactly what the validator signed. */
export function voteSignaturePayload(vote: Vote) {
  const { sig: _sig, ...unsigned } = vote;
  return unsigned;
}

export function verifyVoteSignature(vote: Vote, publicKey: string): boolean {
  return verifyObject(voteSignaturePayload(vote), vote.sig, publicKey);
}

export interface VerifyBlockOptions {
  registeredValidators?: number;
  keyRegistry?: Map<string, string>;
  /** Skip signature checks (used by tests that build blocks with throwaway keys). */
  skipSignatures?: boolean;
}

/**
 * Verify a block in isolation: internal consistency, quorum, and every embedded
 * signature. Chain linkage (index / previousHash) is checked by validateChain.
 */
export function verifyBlock(block: Block, options: VerifyBlockOptions = {}): ChainError[] {
  const errors: ChainError[] = [];
  const registered = options.registeredValidators ?? VALIDATOR_COUNT;
  const registry = options.keyRegistry ?? validatorKeyRegistry(registered);

  const recomputed = computeBlockHash(block);
  if (recomputed !== block.hash) {
    errors.push({
      index: block.index,
      code: 'HASH_MISMATCH',
      detail: `stored ${block.hash.slice(0, 16)} != recomputed ${recomputed.slice(0, 16)}`,
    });
    // A wrong hash means the signature over it is meaningless too; the caller
    // already has the fatal finding, so stop here rather than pile on noise.
    return errors;
  }

  const merkle = computeMerkleRoot(block.transactions);
  if (merkle !== block.merkleRoot) {
    errors.push({
      index: block.index,
      code: 'MERKLE_MISMATCH',
      detail: `stored ${block.merkleRoot.slice(0, 16)} != recomputed ${merkle.slice(0, 16)}`,
    });
  }

  if (block.index === 0) return errors; // genesis carries no votes or signature

  // Re-derive the result from the transactions the block itself carries. A
  // dishonest proposer can hash and sign a block perfectly well; what it cannot
  // do is make a wrong winner follow from the votes it published.
  const settlement = settleMatch(block.transactions);
  if (settlement.winner !== block.winner) {
    errors.push({
      index: block.index,
      code: 'WINNER_MISMATCH',
      detail: `block declares winner ${block.winner ?? 'none'} but its transactions settle to ${settlement.winner ?? 'none'}`,
    });
  }
  if (settlement.winningReactionMs !== block.winningReactionMs) {
    errors.push({
      index: block.index,
      code: 'WINNER_MISMATCH',
      detail: `declared winning reaction ${block.winningReactionMs}ms does not match settled ${settlement.winningReactionMs}ms`,
    });
  }

  // Quorum is measured against how many nodes agreed with each recorded
  // outcome, recomputed here from the votes the block carries. A false start is
  // settled by a quorum REJECTING the press, so checking raw approvals would
  // make it impossible to ever commit one.
  const threshold = quorumFor(registered);
  const agreement = blockAgreement(block.transactions);

  if (agreement < threshold) {
    errors.push({
      index: block.index,
      code: 'QUORUM_NOT_MET',
      detail: `weakest turn settled by ${agreement}/${registered}, need ${threshold}`,
    });
  }

  if (block.consensus.approvals !== agreement) {
    errors.push({
      index: block.index,
      code: 'QUORUM_NOT_MET',
      detail: `block advertises ${block.consensus.approvals} but its votes show ${agreement}`,
    });
  }

  if (options.skipSignatures) return errors;

  const proposerKey = registry.get(block.proposer);
  if (!proposerKey || !verifyProposerSignature(block, proposerKey)) {
    errors.push({
      index: block.index,
      code: 'BAD_PROPOSER_SIGNATURE',
      detail: `proposer ${block.proposer} signature invalid`,
    });
  }

  for (const tx of block.transactions) {
    for (const vote of tx.votes) {
      const key = registry.get(vote.validatorId);
      if (!key || !verifyVoteSignature(vote, key)) {
        errors.push({
          index: block.index,
          code: 'BAD_VOTE_SIGNATURE',
          detail: `vote from ${vote.validatorId} on tx ${tx.txId} is not authentic`,
        });
      }
    }
  }

  return errors;
}
