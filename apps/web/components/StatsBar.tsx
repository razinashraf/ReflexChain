'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { quorumFor, shortHash } from '@reflexchain/protocol';
import { REGISTERED_VALIDATORS } from '../lib/config';
import {
  selectChainHeight,
  selectTransactionCount,
  useReflex,
} from '../lib/store';
import { Dot } from './primitives';

/**
 * The header.
 *
 * Real infrastructure metrics and completely absurd ones are rendered in
 * exactly the same typeface, at the same weight, with no wink. Chain height is
 * true. Network value is also true.
 */
export function StatsBar() {
  const height = useReflex(selectChainHeight);
  const transactions = useReflex(selectTransactionCount);
  const statuses = useReflex((s) => s.statuses);
  const validation = useReflex((s) => s.chainValidation);
  const networkMode = useReflex((s) => s.networkMode);
  const statusLine = useReflex((s) => s.statusLine);
  const chain = useReflex((s) => s.chain);

  // Re-render on a slow tick so the throughput figure stays current.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 2000);
    return () => clearInterval(timer);
  }, []);

  const online = Object.values(statuses).filter((s) => s.online).length;
  const threshold = quorumFor(REGISTERED_VALIDATORS);
  const head = chain.length > 0 ? chain[chain.length - 1]!.hash : '';
  const intact = validation ? validation.valid : true;

  // Throughput over the chain's ACTUAL operating window - first real block to
  // the head - rather than over how long this tab has been open. Dividing by
  // page uptime made a long-running chain read like a busy network, which was
  // both wrong and much less funny.
  const firstBlock = chain.length > 1 ? chain[1]! : null;
  const headBlock = chain.length > 1 ? chain[chain.length - 1]! : null;
  const spanSeconds =
    firstBlock && headBlock
      ? Math.max(1, (Math.max(headBlock.timestamp, Date.now()) - firstBlock.timestamp) / 1000)
      : 0;
  const tps = spanSeconds > 0 ? (transactions / spanSeconds).toFixed(4) : '0.0000';

  const items: { label: string; value: string; tone?: string; title?: string }[] = [
    { label: 'chain height', value: String(height) },
    { label: 'transactions', value: String(transactions) },
    {
      label: 'throughput',
      value: `${tps} TPS`,
      title: "transactions per second across the chain's whole operating window",
    },
    {
      label: 'consensus',
      value: online >= threshold ? `${online}/${REGISTERED_VALIDATORS} QUORUM` : 'HALTED',
      tone: online >= threshold ? 'text-live-green' : 'text-fail-red',
    },
    {
      label: 'chain integrity',
      value: intact ? 'VERIFIED' : 'COMPROMISED',
      tone: intact ? 'text-live-green' : 'text-fail-red',
    },
    { label: 'head', value: head ? shortHash(head, 6, 4) : '—' },
    { label: 'network value', value: '₹0.00', title: 'accurate' },
    { label: 'economic utility', value: 'NONE' },
    { label: 'problem solved', value: 'WHO PRESSED FIRST' },
  ];

  return (
    <header className="border-b border-ink-500 bg-ink-800/80">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <h1 className="font-mono text-base tracking-[0.28em] text-slate-100">REFLEXCHAIN</h1>
          <span className="text-2xs uppercase tracking-[0.18em] text-consensus-amber">
            Proof of Reflex™
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-2xs uppercase tracking-[0.14em]">
            <Dot
              tone={
                networkMode === 'LIVE' ? 'green' : networkMode === 'CONNECTING' ? 'amber' : 'red'
              }
              pulse={networkMode === 'CONNECTING'}
            />
            <span
              className={
                networkMode === 'LIVE'
                  ? 'text-live-green'
                  : networkMode === 'CONNECTING'
                    ? 'text-consensus-amber'
                    : 'text-fail-red'
              }
            >
              {networkMode === 'LIVE'
                ? 'LIVE NETWORK'
                : networkMode === 'CONNECTING'
                  ? 'CONNECTING'
                  : 'NOT CONNECTED'}
            </span>
          </span>
          <Link
            href="/explorer"
            className="border border-ink-400 px-2 py-1 text-2xs uppercase tracking-[0.14em] text-muted transition-colors hover:border-signal-cyan/50 hover:text-signal-cyan"
          >
            explorer
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-ink-600 px-4 py-2">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col" title={item.title}>
            <span className="stat-label">{item.label}</span>
            <span className={`font-mono text-xs ${item.tone ?? 'text-slate-200'}`}>
              {item.value}
            </span>
          </div>
        ))}
      </div>

      <div className="border-t border-ink-600 px-4 py-1">
        <span className="text-2xs text-muted">
          <span className="text-signal-cyan">›</span> {statusLine}
        </span>
      </div>
    </header>
  );
}
