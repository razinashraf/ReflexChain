'use client';

import { useMemo, useState } from 'react';
import { shortHash, type ChainError } from '@reflexchain/protocol';
import { validatorEndpoints } from '../lib/config';
import { fetchChain, postAdmin } from '../lib/network';
import { useReflex } from '../lib/store';
import { BlockCard } from './BlockCard';
import { Panel, Tag } from './primitives';

/**
 * The chain explorer, plus the tamper demonstration.
 *
 * The validation shown here is recomputed IN THE BROWSER over the blocks the
 * node actually served - the same validateChain() the nodes run. When it says
 * a block is invalid, a sha256 genuinely failed to match.
 */
export function ChainExplorer({ full = false }: { full?: boolean }) {
  const chain = useReflex((s) => s.chain);
  const validation = useReflex((s) => s.chainValidation);
  const chainValidatorId = useReflex((s) => s.chainValidatorId);
  const chainSource = useReflex((s) => s.chainSource);
  const setChain = useReflex((s) => s.setChain);
  const match = useReflex((s) => s.match);

  const [busy, setBusy] = useState(false);
  const [tamperTarget, setTamperTarget] = useState('');

  const errorsByIndex = useMemo(() => {
    const map = new Map<number, ChainError[]>();
    for (const e of validation?.errors ?? []) {
      const list = map.get(e.index) ?? [];
      list.push(e);
      map.set(e.index, list);
    }
    return map;
  }, [validation]);

  const labelFor = useMemo(() => {
    const labels = new Map<string, string>();
    for (const p of match?.players ?? []) labels.set(p.address, p.label);
    return (address: string) => labels.get(address) ?? shortHash(address, 5, 3);
  }, [match]);

  const firstInvalid = validation?.firstInvalidIndex ?? null;
  const blocks = full ? [...chain].reverse() : [...chain].slice(-6).reverse();

  async function loadFrom(validatorId: string) {
    setBusy(true);
    const result = await fetchChain(validatorId);
    if (result) setChain(result.blocks as never, 'LIVE', result.validatorId);
    setBusy(false);
  }

  async function tamper() {
    const index = Number(tamperTarget);
    if (!Number.isInteger(index) || index < 1) return;

    setBusy(true);
    // Rewrite the winner on node-01 only, re-linking the whole suffix so the
    // ledger is structurally perfect again. Everything that then fails, fails
    // for a real cryptographic reason.
    await postAdmin('node-01', '/admin/tamper', {
      blockIndex: index,
      field: 'winner',
      value: '0x0000000000000000000000000000000000000bad',
      mode: 'cascade',
    });
    await loadFrom('node-01');
    setBusy(false);
  }

  async function restore() {
    setBusy(true);
    await postAdmin('node-01', '/admin/restore');
    setTimeout(() => void loadFrom('node-01'), 900);
    setBusy(false);
  }

  const compromised = validation ? !validation.valid : false;

  return (
    <Panel
      title="Blockchain explorer"
      right={
        <span className="flex items-center gap-2">
          {chainSource === 'SNAPSHOT' ? <Tag tone="amber">ARCHIVED SNAPSHOT</Tag> : null}
          {chainValidatorId ? (
            <span className="text-2xs text-muted">via {chainValidatorId}</span>
          ) : null}
          <Tag tone={compromised ? 'red' : 'green'}>
            {compromised ? 'CHAIN COMPROMISED' : 'CHAIN VALID'}
          </Tag>
        </span>
      }
    >
      <div className="flex h-full flex-col">
        {compromised && validation ? (
          <div className="border-b border-fail-red/40 bg-fail-red/10 px-3 py-2">
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-fail-red">
              chain compromised · first invalid block #{firstInvalid}
            </p>
            <p className="mt-0.5 text-2xs text-fail-red/80">
              {validation.errors.length} integrity failure
              {validation.errors.length === 1 ? '' : 's'} · every block from #{firstInvalid} onward
              is untrustworthy
            </p>
          </div>
        ) : null}

        <div className="flex-1 space-y-0 overflow-y-auto px-3 py-3">
          {blocks.length === 0 ? (
            <p className="py-8 text-center text-2xs text-muted/50">no chain loaded</p>
          ) : (
            blocks.map((block, i) => (
              <div key={`${block.index}-${block.hash}`}>
                <BlockCard
                  block={block}
                  errors={errorsByIndex.get(block.index) ?? []}
                  orphaned={firstInvalid !== null && block.index > firstInvalid}
                  compact={!full}
                  labelFor={labelFor}
                />
                {i < blocks.length - 1 ? (
                  <div className="flex items-center justify-center py-1">
                    <span
                      className={`text-2xs ${
                        firstInvalid !== null && block.index > firstInvalid
                          ? 'text-fail-red'
                          : 'text-ink-400'
                      }`}
                      title="each block commits to the hash of the one below it"
                    >
                      ▲ previousHash
                    </span>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        {/* ---- tamper controls ---- */}
        <div className="space-y-2 border-t border-ink-500 px-3 py-2.5">
          <div className="stat-label">tamper demonstration · node-01 only</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="text"
              value={tamperTarget}
              placeholder="BLOCK #"
              onChange={(e) => setTamperTarget(e.target.value.replace(/\D/g, ''))}
              className="w-24"
            />
            <button
              type="button"
              className="btn-danger"
              disabled={busy || !tamperTarget}
              onClick={() => void tamper()}
            >
              rewrite winner
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => void restore()}
            >
              resync from peers
            </button>
          </div>

          <div className="flex flex-wrap gap-1">
            <span className="text-2xs text-muted">load chain from:</span>
            {validatorEndpoints().map((e) => (
              <button
                key={e.validatorId}
                type="button"
                disabled={busy}
                onClick={() => void loadFrom(e.validatorId)}
                className={`border px-1.5 py-0.5 text-2xs transition-colors ${
                  chainValidatorId === e.validatorId
                    ? 'border-signal-cyan/50 text-signal-cyan'
                    : 'border-ink-400 text-muted hover:text-slate-300'
                }`}
              >
                {e.validatorId}
              </button>
            ))}
          </div>

          <p className="text-2xs leading-relaxed text-muted/70">
            Rewriting a block re-links every descendant so the ledger is structurally perfect
            again. The hashes can be recomputed; the validator signatures over them cannot be
            forged. Compare node-01 against any other node to see the fork.
          </p>
        </div>
      </div>
    </Panel>
  );
}
