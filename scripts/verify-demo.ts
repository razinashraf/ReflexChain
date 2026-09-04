/**
 * End-to-end verification of every claim the demo makes.
 *
 * Runs against a live network and checks the real behaviour behind each UI
 * assertion: consensus, node failure, quorum loss, resynchronisation, a
 * Byzantine validator, and ledger tampering. Exits non-zero if any claim fails.
 *
 *   npx tsx scripts/verify-demo.ts
 */
import { quorumFor, validatorSet, VALIDATOR_COUNT, type Block } from '@reflexchain/protocol';

const HOST = '127.0.0.1';
const THRESHOLD = quorumFor(VALIDATOR_COUNT);
const nodes = validatorSet(VALIDATOR_COUNT, HOST);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}\n${'-'.repeat(title.length)}`);
}

const url = (ordinal: number, path: string) => `http://${HOST}:${7000 + ordinal}${path}`;

async function status(ordinal: number) {
  const res = await fetch(url(ordinal, '/status'));
  return res.json() as Promise<{
    validatorId: string;
    online: boolean;
    height: number;
    headHash: string;
    chainValid: boolean;
    byzantine: boolean;
    peersConnected: number;
  }>;
}

async function chain(ordinal: number) {
  const res = await fetch(url(ordinal, '/chain'));
  return res.json() as Promise<{ height: number; headHash: string; blocks: Block[] }>;
}

async function validation(ordinal: number) {
  const res = await fetch(url(ordinal, '/chain/validate'));
  return res.json() as Promise<{
    valid: boolean;
    firstInvalidIndex: number | null;
    errors: { index: number; code: string; detail: string }[];
  }>;
}

async function admin(ordinal: number, path: string, body: unknown = {}) {
  const res = await fetch(url(ordinal, path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function allStatuses() {
  return Promise.all(nodes.map((n) => status(n.ordinal).catch(() => null)));
}

async function seed(matches: number): Promise<void> {
  const { spawn } = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'scripts/seed-chain.ts', '--matches', String(matches)], {
      shell: process.platform === 'win32',
      stdio: 'ignore',
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed exit ${code}`))));
  });
}

/** Wait until every online node reports the same head, or give up. */
async function waitForConvergence(timeoutMs = 25_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const all = (await allStatuses()).filter((s): s is NonNullable<typeof s> => s !== null);
    const online = all.filter((s) => s.online);
    if (online.length > 0 && new Set(online.map((s) => s.headHash)).size === 1) return true;
    await sleep(1_000);
  }
  return false;
}

async function main(): Promise<void> {
  console.log('REFLEXCHAIN demo verification');
  console.log(`quorum ${THRESHOLD} of ${VALIDATOR_COUNT}`);

  // -------------------------------------------------------------------------
  section('1. Network is genuinely five separate processes in a full mesh');

  const initial = await allStatuses();
  check('all validators reachable', initial.every((s) => s !== null));
  check(
    'every node meshed with all peers',
    initial.every((s) => s?.peersConnected === VALIDATOR_COUNT - 1),
    initial.map((s) => s?.peersConnected).join(','),
  );
  check(
    'all nodes share one genesis',
    new Set((await Promise.all(nodes.map((n) => chain(n.ordinal)))).map((c) => c.blocks[0]!.hash))
      .size === 1,
  );

  // -------------------------------------------------------------------------
  section('2. Matches reach consensus and commit identical blocks');

  const before = (await status(1)).height;
  await seed(4);
  check('converged after 4 matches', await waitForConvergence());

  const after = await Promise.all(nodes.map((n) => chain(n.ordinal)));
  check('chain grew by 4 blocks', after[0]!.height === before + 4, `${before} -> ${after[0]!.height}`);
  check('all five heads identical', new Set(after.map((c) => c.headHash)).size === 1);

  const recent = after[0]!.blocks.slice(-4);
  check(
    'every block carries two turn transactions',
    recent.every((b) => b.transactions.length === 2),
  );
  check(
    'every block met quorum',
    recent.every((b) => b.consensus.approvals >= THRESHOLD),
    recent.map((b) => `${b.consensus.approvals}/5`).join(' '),
  );
  check(
    'votes inside blocks come from distinct nodes',
    recent.every((b) =>
      b.transactions.every(
        (tx) => new Set(tx.votes.map((v) => v.validatorId)).size === tx.votes.length,
      ),
    ),
  );
  check(
    'nodes observed arrival on their own clocks (deltas differ)',
    recent.some((b) =>
      b.transactions.some(
        (tx) => new Set(tx.votes.map((v) => v.observedArrivalDeltaMs)).size > 1,
      ),
    ),
  );
  check(
    'block proposal rotates across validators',
    new Set(after[0]!.blocks.slice(1).map((b) => b.proposer)).size > 1,
    [...new Set(after[0]!.blocks.slice(1).map((b) => b.proposer))].join(','),
  );

  // -------------------------------------------------------------------------
  section('3. One node down: network continues (quorum 4 of 5)');

  await admin(3, '/admin/kill');
  await sleep(2_500);
  check('node-03 reports offline', (await status(3)).online === false);
  check('node-03 has no peers', (await status(3)).peersConnected === 0);

  const heightBeforeDegraded = (await status(1)).height;
  await seed(2);
  await sleep(3_000);
  const degraded = (await status(1)).height;
  check(
    'blocks still commit with 4 nodes',
    degraded === heightBeforeDegraded + 2,
    `${heightBeforeDegraded} -> ${degraded}`,
  );

  // -------------------------------------------------------------------------
  section('4. Two nodes down: consensus halts');

  await admin(4, '/admin/kill');
  await sleep(2_500);
  const heightBeforeHalt = (await status(1)).height;
  await seed(2);
  await sleep(4_000);
  const halted = (await status(1)).height;
  check(
    'no blocks commit below quorum',
    halted === heightBeforeHalt,
    `height stayed at ${halted}`,
  );

  // -------------------------------------------------------------------------
  section('5. Revived nodes resynchronise');

  await admin(3, '/admin/revive');
  await admin(4, '/admin/revive');
  await sleep(9_000);

  const revived = await allStatuses();
  check('node-03 back online', revived[2]?.online === true);
  check('node-04 back online', revived[3]?.online === true);
  check('network re-converged after revival', await waitForConvergence(20_000));
  check(
    'revived nodes caught up to the tip',
    new Set(revived.map((s) => s?.height)).size === 1 ||
      (await allStatuses()).every((s) => s?.height === revived[0]?.height),
  );

  // -------------------------------------------------------------------------
  section('6. A Byzantine validator cannot corrupt the result');

  await admin(5, '/admin/byzantine', { on: true });
  await sleep(1_000);
  check('node-05 flagged byzantine', (await status(5)).byzantine === true);

  const heightBeforeByz = (await status(1)).height;
  await seed(3);
  await sleep(4_000);

  const byzChain = await chain(1);
  check(
    'honest majority still commits blocks',
    byzChain.height > heightBeforeByz,
    `${heightBeforeByz} -> ${byzChain.height}`,
  );

  const byzBlocks = byzChain.blocks.slice(heightBeforeByz + 1);
  check(
    'committed blocks still meet quorum without the liar',
    byzBlocks.every((b) => b.consensus.approvals >= THRESHOLD),
    byzBlocks.map((b) => `${b.consensus.approvals}/5`).join(' '),
  );
  check(
    'no block was proposed by the byzantine node',
    byzBlocks.every((b) => b.proposer !== 'node-05'),
  );
  check('honest chain remains valid', (await validation(1)).valid);

  await admin(5, '/admin/byzantine', { on: false });
  await sleep(1_000);

  // -------------------------------------------------------------------------
  section('7. Tampering is detected and forks the tamperer');

  const honestHead = (await status(2)).headHash;
  const target = Math.max(1, (await status(1)).height - 2);

  await admin(1, '/admin/tamper', {
    blockIndex: target,
    field: 'winner',
    value: '0x0000000000000000000000000000000000000bad',
    mode: 'cascade',
  });
  await sleep(1_500);

  const tamperedValidation = await validation(1);
  check('node-01 reports its chain invalid', tamperedValidation.valid === false);
  check(
    'first invalid block identified',
    tamperedValidation.firstInvalidIndex === target,
    `#${tamperedValidation.firstInvalidIndex}`,
  );
  check(
    'rewritten blocks fail their proposer signature',
    tamperedValidation.errors.some((e) => e.code === 'BAD_PROPOSER_SIGNATURE'),
    'hashes can be recomputed, signatures cannot be forged',
  );
  check(
    'tampered node forked away from the honest network',
    (await status(1)).headHash !== honestHead,
  );
  check('honest nodes remain valid', (await validation(2)).valid === true);

  // repair
  await admin(1, '/admin/restore');
  await sleep(4_000);
  check('node-01 repaired from peers', (await validation(1)).valid === true);
  check('node-01 rejoined the honest chain', (await status(1)).headHash === (await status(2)).headHash);

  // -------------------------------------------------------------------------
  console.log(`\n${'='.repeat(52)}`);
  console.log(`${passed} passed, ${failed} failed`);
  console.log('='.repeat(52));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('verification crashed:', error);
  process.exit(1);
});
