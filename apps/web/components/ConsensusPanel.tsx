'use client';

import { quorumFor } from '@reflexchain/protocol';
import { REGISTERED_VALIDATORS } from '../lib/config';
import { useReflex } from '../lib/store';
import { Dot, Panel, QuorumBar, Tag } from './primitives';

/**
 * The live consensus view.
 *
 * Every row is a real signed vote from a real node, showing that node's OWN
 * observed arrival delta. Those numbers differ between nodes because each one
 * received the event over its own socket - which is precisely why the votes
 * are independent rather than five copies of one server's opinion.
 */
export function ConsensusPanel() {
  const focusedTurn = useReflex((s) => s.focusedTurn);
  const talliesByTurn = useReflex((s) => s.talliesByTurn);
  const votesByEvent = useReflex((s) => s.votesByEvent);
  const arrivals = useReflex((s) => s.arrivals);

  const threshold = quorumFor(REGISTERED_VALIDATORS);

  const focusedArrival = focusedTurn
    ? arrivals.find((a) => `${a.matchId}#${a.turnIndex}` === focusedTurn)
    : undefined;
  const eventId = focusedArrival?.eventId;
  const votes = eventId ? (votesByEvent[eventId] ?? []) : [];
  const tally = focusedTurn ? talliesByTurn[focusedTurn] : undefined;

  const approvals = votes.filter((v) => v.verdict === 'ACCEPT').length;
  const rejections = votes.filter((v) => v.verdict === 'REJECT').length;

  const statusTone =
    tally?.status === 'CONFIRMED'
      ? 'green'
      : tally?.status === 'REJECTED'
        ? 'red'
        : tally?.status === 'INCONCLUSIVE'
          ? 'amber'
          : 'muted';

  return (
    <Panel
      title="Proof of Reflex · live consensus"
      right={
        tally ? (
          <Tag tone={statusTone as never}>{tally.status}</Tag>
        ) : (
          <Tag tone="muted">IDLE</Tag>
        )
      }
    >
      <div className="flex h-full flex-col">
        {/* ---- arrival fan-out ---- */}
        <div className="border-b border-ink-600 px-3 py-2">
          <div className="stat-label mb-1.5">event arrival · independent sockets</div>
          {focusedArrival ? (
            <div className="flex flex-wrap gap-1">
              {(() => {
                const forThisEvent = arrivals.filter((a) => a.eventId === eventId);
                const earliest = Math.min(...forThisEvent.map((a) => a.receivedAt));
                return forThisEvent
                  .slice()
                  .sort((a, b) => a.receivedAt - b.receivedAt)
                  .map((a) => (
                    <span
                      key={a.validatorId}
                      className="animate-slide-in border border-signal-cyan/30 bg-signal-cyan/5 px-1.5 py-0.5 text-2xs text-signal-cyan"
                      title={`received at ${a.receivedAt}`}
                    >
                      {a.validatorId} +{a.receivedAt - earliest}ms
                    </span>
                  ));
              })()}
            </div>
          ) : (
            <p className="text-2xs text-muted/60">no event in flight</p>
          )}
        </div>

        {/* ---- votes ---- */}
        <div className="flex-1 overflow-y-auto">
          {votes.length === 0 ? (
            <p className="px-3 py-6 text-center text-2xs text-muted/50">
              validators have not voted yet
            </p>
          ) : (
            <table className="w-full text-2xs">
              <thead className="sticky top-0 bg-ink-800">
                <tr className="text-muted">
                  <th className="px-3 py-1.5 text-left font-normal uppercase tracking-[0.12em]">
                    node
                  </th>
                  <th className="px-2 py-1.5 text-left font-normal uppercase tracking-[0.12em]">
                    verdict
                  </th>
                  <th
                    className="px-2 py-1.5 text-right font-normal uppercase tracking-[0.12em]"
                    title="This node's own measurement: press arrival minus its own GO timestamp."
                  >
                    observed Δ
                  </th>
                  <th className="px-3 py-1.5 text-left font-normal uppercase tracking-[0.12em]">
                    reason
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700">
                {votes.map((vote) => (
                  <tr key={vote.validatorId} className="animate-slide-in">
                    <td className="px-3 py-1.5 font-mono text-slate-300">{vote.validatorId}</td>
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-1.5">
                        <Dot tone={vote.verdict === 'ACCEPT' ? 'green' : 'red'} />
                        <span
                          className={
                            vote.verdict === 'ACCEPT' ? 'text-live-green' : 'text-fail-red'
                          }
                        >
                          {vote.verdict}
                        </span>
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-bright">
                      {vote.observedArrivalDeltaMs != null
                        ? `${vote.observedArrivalDeltaMs}ms`
                        : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-muted">
                      {vote.reasons.includes('BYZANTINE_INVERTED') ? (
                        <span className="text-fail-red">BYZANTINE_INVERTED</span>
                      ) : (
                        vote.reasons.slice(0, 2).join(' · ')
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ---- quorum ---- */}
        <div className="border-t border-ink-600 px-3 py-2.5">
          <QuorumBar
            approvals={approvals}
            rejections={rejections}
            registered={REGISTERED_VALIDATORS}
            threshold={threshold}
          />
          {tally?.dissenters.length ? (
            <p className="mt-1.5 text-2xs text-consensus-amber">
              dissenting: {tally.dissenters.join(', ')}
            </p>
          ) : null}
          {tally?.canonicalReactionMs != null ? (
            <p className="mt-1.5 text-2xs text-muted">
              canonical reaction{' '}
              <span className="text-slate-200">{tally.canonicalReactionMs} ms</span> (median of
              accepting nodes)
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
