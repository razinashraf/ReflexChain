'use client';

import { quorumFor } from '@reflexchain/protocol';
import { REGISTERED_VALIDATORS } from '../lib/config';
import { useReflex } from '../lib/store';
import { Panel } from './primitives';
import type { LocalPhase } from '../lib/useGame';

type StageState = 'idle' | 'active' | 'done' | 'failed';

/**
 * The event's journey through the network, driven entirely by real state:
 * a stage only lights up because the corresponding message actually arrived.
 */
export function PipelinePanel({ phase }: { phase: LocalPhase }) {
  const arrivals = useReflex((s) => s.arrivals);
  const focusedTurn = useReflex((s) => s.focusedTurn);
  const votesByEvent = useReflex((s) => s.votesByEvent);
  const talliesByTurn = useReflex((s) => s.talliesByTurn);
  const blockLifecycle = useReflex((s) => s.blockLifecycle);

  const threshold = quorumFor(REGISTERED_VALIDATORS);
  const focusedArrival = focusedTurn
    ? arrivals.find((a) => `${a.matchId}#${a.turnIndex}` === focusedTurn)
    : undefined;
  const eventId = focusedArrival?.eventId;

  const arrivalCount = eventId ? arrivals.filter((a) => a.eventId === eventId).length : 0;
  const votes = eventId ? (votesByEvent[eventId] ?? []) : [];
  const tally = focusedTurn ? talliesByTurn[focusedTurn] : undefined;
  const appended = blockLifecycle.filter((b) => b.stage === 'APPENDED');
  const rejected = blockLifecycle.filter((b) => b.stage === 'REJECTED');
  const proposed = blockLifecycle.filter((b) => b.stage === 'PROPOSED');

  const latestAppendedIndex = appended[0]?.blockIndex ?? null;
  const appendCount = latestAppendedIndex
    ? new Set(
        appended.filter((b) => b.blockIndex === latestAppendedIndex).map((b) => b.validatorId),
      ).size
    : 0;

  const stages: { label: string; detail: string; state: StageState }[] = [
    {
      label: 'PRESS',
      detail: phase === 'FALSE_START' ? 'false start signed' : 'signed on device',
      state:
        phase === 'PRESSED' || phase === 'FALSE_START'
          ? 'active'
          : arrivalCount > 0
            ? 'done'
            : 'idle',
    },
    {
      label: 'BROADCAST',
      detail: `${arrivalCount}/${REGISTERED_VALIDATORS} nodes received`,
      state: arrivalCount === 0 ? 'idle' : arrivalCount >= REGISTERED_VALIDATORS ? 'done' : 'active',
    },
    {
      label: 'VALIDATE',
      detail: `${votes.length}/${REGISTERED_VALIDATORS} independent verdicts`,
      state: votes.length === 0 ? 'idle' : votes.length >= REGISTERED_VALIDATORS ? 'done' : 'active',
    },
    {
      label: 'CONSENSUS',
      detail: tally
        ? `${tally.approvals}/${tally.registered} · need ${threshold}`
        : `quorum ${threshold} of ${REGISTERED_VALIDATORS}`,
      state:
        tally?.status === 'CONFIRMED'
          ? 'done'
          : tally?.status === 'REJECTED'
            ? 'failed'
            : tally
              ? 'active'
              : 'idle',
    },
    {
      label: 'BLOCK',
      detail: proposed.length ? `proposed by ${proposed[0]!.validatorId}` : 'awaiting both turns',
      state: proposed.length ? 'done' : 'idle',
    },
    {
      label: 'COMMIT',
      detail: rejected.length
        ? `${rejected.length} node(s) refused`
        : `${appendCount}/${REGISTERED_VALIDATORS} nodes appended`,
      state: rejected.length ? 'failed' : appendCount >= REGISTERED_VALIDATORS ? 'done' : appendCount ? 'active' : 'idle',
    },
  ];

  const colour = {
    idle: 'border-ink-500 text-muted/50',
    active: 'border-signal-cyan/60 text-signal-cyan',
    done: 'border-live-green/50 text-live-green',
    failed: 'border-fail-red/60 text-fail-red',
  };

  return (
    <Panel title="Event pipeline">
      <div className="space-y-1.5 px-3 py-3">
        {stages.map((stage, i) => (
          <div key={stage.label}>
            <div
              className={`flex items-center justify-between border-l-2 bg-ink-700/40 px-2.5 py-1.5 transition-colors ${colour[stage.state]}`}
            >
              <span className="text-2xs uppercase tracking-[0.18em]">{stage.label}</span>
              <span className="text-2xs text-muted">{stage.detail}</span>
            </div>
            {i < stages.length - 1 ? (
              <div className="py-0.5 pl-3 text-2xs text-ink-400">↓</div>
            ) : null}
          </div>
        ))}
      </div>
    </Panel>
  );
}
