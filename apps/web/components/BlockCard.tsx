'use client';

import { shortHash, type Block, type ChainError } from '@reflexchain/protocol';
import { Tag } from './primitives';

export function BlockCard({
  block,
  errors = [],
  orphaned = false,
  compact = false,
  labelFor,
}: {
  block: Block;
  errors?: ChainError[];
  /** True when an earlier block broke, so this one cannot be trusted either. */
  orphaned?: boolean;
  compact?: boolean;
  labelFor?: (address: string) => string;
}) {
  const broken = errors.length > 0;
  const isGenesis = block.index === 0;

  const border = broken
    ? 'border-fail-red/70'
    : orphaned
      ? 'border-consensus-amber/50'
      : 'border-ink-500';

  return (
    <div className={`border ${border} bg-ink-800/80`}>
      <header
        className={`flex items-center justify-between border-b px-3 py-1.5 ${
          broken ? 'border-fail-red/40 bg-fail-red/10' : 'border-ink-600'
        }`}
      >
        <span className="font-mono text-xs text-slate-200">
          BLOCK #{String(block.index).padStart(3, '0')}
        </span>
        <span className="flex items-center gap-1">
          {isGenesis ? <Tag>GENESIS</Tag> : null}
          {broken ? (
            <Tag tone="red">INVALID</Tag>
          ) : orphaned ? (
            <Tag tone="amber">ORPHANED</Tag>
          ) : !isGenesis ? (
            <Tag tone="green">
              {block.consensus.approvals}/{block.consensus.total}
            </Tag>
          ) : null}
        </span>
      </header>

      <div className="space-y-2 px-3 py-2">
        {!isGenesis ? (
          <div className="flex items-baseline justify-between">
            <span className="stat-label">winner</span>
            <span className="font-mono text-sm text-slate-100">
              {block.winner
                ? `${labelFor?.(block.winner) ?? shortHash(block.winner, 6, 4)} · ${block.winningReactionMs}ms`
                : 'NO VALID REACTION'}
            </span>
          </div>
        ) : (
          <p className="text-2xs text-muted">
            derived identically by every node; never transmitted
          </p>
        )}

        {!compact && !isGenesis ? (
          <div className="space-y-1 border-t border-ink-600 pt-2">
            {block.transactions.map((tx) => (
              <div key={tx.txId} className="flex items-center justify-between text-2xs">
                <span className="text-muted">
                  T{tx.turnIndex} {labelFor?.(tx.player) ?? shortHash(tx.player, 5, 3)}
                </span>
                <span
                  className={
                    tx.outcome === 'VALID'
                      ? 'text-live-green'
                      : tx.outcome === 'FALSE_START'
                        ? 'text-fail-red'
                        : 'text-consensus-amber'
                  }
                >
                  {tx.outcome === 'VALID' ? `${tx.reactionMs}ms` : tx.outcome}
                  <span className="ml-1.5 text-muted">
                    {tx.approvals}/{tx.total}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="space-y-0.5 border-t border-ink-600 pt-2">
          <div className="flex justify-between gap-2">
            <span className="stat-label">prev</span>
            <span className="hash truncate" title={block.previousHash}>
              {shortHash(block.previousHash, 8, 6)}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="stat-label">hash</span>
            <span
              className={`hash truncate ${broken ? 'text-fail-red' : 'text-signal-cyan'}`}
              title={block.hash}
            >
              {shortHash(block.hash, 8, 6)}
            </span>
          </div>
          {!isGenesis ? (
            <div className="flex justify-between gap-2">
              <span className="stat-label">proposer</span>
              <span className="hash">{block.proposer}</span>
            </div>
          ) : null}
        </div>

        {broken ? (
          <ul className="space-y-0.5 border-t border-fail-red/30 pt-2">
            {errors.map((e, i) => (
              <li key={i} className="text-2xs text-fail-red">
                <span className="font-semibold">{e.code}</span>
                <span className="block text-fail-red/70">{e.detail}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
