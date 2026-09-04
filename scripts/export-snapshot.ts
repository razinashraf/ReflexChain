/**
 * Export a real chain from a running network into the web app's public folder.
 *
 * The hosted build has no validator network behind it, so instead of rendering
 * a dead dashboard it loads this archived ledger and labels it as such. The
 * blocks are genuine - they verify with the same validateChain() the nodes run,
 * signatures included - they are simply not live.
 *
 *   npx tsx scripts/export-snapshot.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveLeaderboard,
  validateChain,
  validatorSet,
  VALIDATOR_COUNT,
  type Block,
} from '@reflexchain/protocol';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'apps', 'web', 'public', 'snapshot.json');

async function main(): Promise<void> {
  const nodes = validatorSet(VALIDATOR_COUNT, '127.0.0.1');

  let blocks: Block[] | null = null;
  let sourceId = '';

  for (const node of nodes) {
    try {
      const res = await fetch(`${node.httpUrl}/chain`, { signal: AbortSignal.timeout(3_000) });
      if (!res.ok) continue;
      const body = (await res.json()) as { blocks: Block[] };
      blocks = body.blocks;
      sourceId = node.validatorId;
      break;
    } catch {
      continue;
    }
  }

  if (!blocks) {
    console.error('no validator reachable - start the network first (npm run dev:network)');
    process.exit(1);
  }

  // Never publish a broken ledger as the reference archive.
  const validation = validateChain(blocks);
  if (!validation.valid) {
    console.error(
      `refusing to export: ${sourceId} chain is invalid at block #${validation.firstInvalidIndex}`,
    );
    for (const e of validation.errors.slice(0, 5)) console.error(`  ${e.code}: ${e.detail}`);
    process.exit(1);
  }

  const snapshot = {
    exportedAt: new Date().toISOString(),
    sourceValidator: sourceId,
    registeredValidators: VALIDATOR_COUNT,
    height: blocks.length - 1,
    headHash: blocks[blocks.length - 1]!.hash,
    transactions: blocks.reduce((n, b) => n + b.transactions.length, 0),
    leaderboard: deriveLeaderboard(blocks),
    blocks,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(snapshot, null, 2));

  console.log(`exported ${snapshot.height} blocks from ${sourceId}`);
  console.log(`  transactions : ${snapshot.transactions}`);
  console.log(`  head         : ${snapshot.headHash.slice(0, 24)}`);
  console.log(`  written to   : ${OUT}`);
}

main().catch((error) => {
  console.error('export failed:', error);
  process.exit(1);
});
