/**
 * Per-validator chain persistence.
 *
 * Each node owns its own append-only JSONL file. They are separate files on
 * purpose: when we tamper with node 01's chain, the other four are physically
 * untouched, which is what makes the resulting fork real rather than staged.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  computeBlockHash,
  computeMerkleRoot,
  createGenesisBlock,
  validateChain,
  type Block,
  type ChainValidationResult,
} from '@reflexchain/protocol';

export class ChainStore {
  readonly filePath: string;
  private blocks: Block[] = [];

  constructor(validatorId: string, dataDir: string) {
    this.filePath = join(dataDir, validatorId, 'chain.jsonl');
    mkdirSync(dirname(this.filePath), { recursive: true });
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.blocks = [createGenesisBlock()];
      this.rewrite();
      return;
    }

    const lines = readFileSync(this.filePath, 'utf8').split('\n').filter(Boolean);
    const parsed: Block[] = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line) as Block);
      } catch {
        // A truncated final line means the process died mid-write. Everything
        // before it is still valid, so keep it and drop the fragment.
        break;
      }
    }

    this.blocks = parsed.length > 0 ? parsed : [createGenesisBlock()];
    if (parsed.length === 0) this.rewrite();
  }

  private rewrite(): void {
    writeFileSync(this.filePath, this.blocks.map((b) => JSON.stringify(b)).join('\n') + '\n');
  }

  get chain(): Block[] {
    return this.blocks;
  }

  get height(): number {
    return this.blocks.length - 1;
  }

  get head(): Block {
    return this.blocks[this.blocks.length - 1]!;
  }

  get transactionCount(): number {
    return this.blocks.reduce((n, b) => n + b.transactions.length, 0);
  }

  hasBlock(hash: string): boolean {
    return this.blocks.some((b) => b.hash === hash);
  }

  blocksAfter(height: number): Block[] {
    return this.blocks.slice(Math.max(0, height + 1));
  }

  append(block: Block): void {
    this.blocks.push(block);
    appendFileSync(this.filePath, JSON.stringify(block) + '\n');
  }

  /**
   * Swap the current head for a competing block at the same index. Used when
   * two validators proposed simultaneously and this node lost the tie-break.
   */
  replaceHead(block: Block): void {
    this.blocks[this.blocks.length - 1] = block;
    this.rewrite();
  }

  /** Adopt a peer's chain wholesale (used when resyncing after downtime). */
  replace(chain: Block[]): void {
    this.blocks = chain;
    this.rewrite();
  }

  validate(): ChainValidationResult {
    return validateChain(this.blocks);
  }

  /**
   * Overwrite a block in place WITHOUT fixing anything downstream. This is the
   * tamper demo, and it is deliberately the only method here that can put the
   * store into an invalid state.
   *
   * mode 'naive'   - edit the field, leave the stored hash alone.
   *                  -> HASH_MISMATCH on this block.
   * mode 'rehash'  - edit the field and recompute this block's own hash.
   *                  -> block is self-consistent, but its proposer signature was
   *                     over the OLD hash, and block N+1 is now orphaned.
   * mode 'cascade' - edit the field and re-link every descendant so the chain is
   *                  structurally perfect again.
   *                  -> the head hash genuinely diverges from the honest network
   *                     (a real fork), and every rewritten block fails its
   *                     proposer signature, because hashes can be recomputed but
   *                     validator signatures cannot be forged.
   */
  tamper(
    index: number,
    patch: Partial<Block>,
    mode: 'naive' | 'rehash' | 'cascade' = 'naive',
  ): Block {
    const target = this.blocks[index];
    if (!target) throw new Error(`no block at index ${index}`);

    let mutated: Block = { ...target, ...patch };

    if (mode === 'naive') {
      this.blocks[index] = mutated;
      this.rewrite();
      return mutated;
    }

    mutated = { ...mutated, merkleRoot: computeMerkleRoot(mutated.transactions) };
    mutated = { ...mutated, hash: computeBlockHash(mutated) };
    this.blocks[index] = mutated;

    if (mode === 'cascade') {
      for (let i = index + 1; i < this.blocks.length; i++) {
        const relinked: Block = { ...this.blocks[i]!, previousHash: this.blocks[i - 1]!.hash };
        this.blocks[i] = { ...relinked, hash: computeBlockHash(relinked) };
      }
    }

    this.rewrite();
    return mutated;
  }
}
