'use client';

import { useMemo } from 'react';
import { deriveLeaderboard, shortHash } from '@reflexchain/protocol';
import { useReflex } from '../lib/store';
import { Panel } from './primitives';

/**
 * Standings are recomputed from the chain on every render - there is no
 * leaderboard table anywhere. A side effect worth pointing at during the demo:
 * tamper with a block and the standings change with it, because the ledger is
 * the only record of what happened.
 */
export function Leaderboard() {
  const chain = useReflex((s) => s.chain);
  const match = useReflex((s) => s.match);

  const rows = useMemo(() => {
    const labels = new Map<string, string>();
    for (const p of match?.players ?? []) labels.set(p.address, p.label);
    return deriveLeaderboard(chain, labels).slice(0, 8);
  }, [chain, match]);

  return (
    <Panel
      title="Leaderboard"
      right={<span className="text-2xs text-muted">projected from chain</span>}
    >
      {rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-2xs text-muted/50">
          no confirmed reactions on chain yet
        </p>
      ) : (
        <table className="w-full text-2xs">
          <thead>
            <tr className="text-muted">
              <th className="px-3 py-1.5 text-left font-normal uppercase tracking-[0.12em]">#</th>
              <th className="px-2 py-1.5 text-left font-normal uppercase tracking-[0.12em]">
                player
              </th>
              <th className="px-2 py-1.5 text-right font-normal uppercase tracking-[0.12em]">
                best
              </th>
              <th className="px-2 py-1.5 text-right font-normal uppercase tracking-[0.12em]">
                avg
              </th>
              <th className="px-2 py-1.5 text-right font-normal uppercase tracking-[0.12em]">
                won
              </th>
              <th className="px-3 py-1.5 text-right font-normal uppercase tracking-[0.12em]">
                fs
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700">
            {rows.map((row) => (
              <tr key={row.player}>
                <td className="px-3 py-1.5 text-muted">{row.rank}</td>
                <td className="px-2 py-1.5">
                  <span className="text-slate-200">{row.label}</span>
                  <span className="ml-1.5 hash">{shortHash(row.player, 4, 3)}</span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-signal-cyan">
                  {row.bestReactionMs != null ? `${row.bestReactionMs}` : '—'}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-muted-bright">
                  {row.averageReactionMs != null ? `${row.averageReactionMs}` : '—'}
                </td>
                <td className="px-2 py-1.5 text-right text-slate-300">{row.roundsWon}</td>
                <td className="px-3 py-1.5 text-right text-fail-red/80">
                  {row.falseStarts || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
