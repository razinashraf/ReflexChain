'use client';

import type { ReactNode } from 'react';

export function Panel({
  title,
  right,
  children,
  className = '',
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel flex flex-col ${className}`}>
      <header className="panel-title">
        <span>{title}</span>
        {right ? <span className="normal-case tracking-normal">{right}</span> : null}
      </header>
      <div className="flex-1 overflow-hidden">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  tone = 'default',
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: 'default' | 'cyan' | 'amber' | 'green' | 'red' | 'muted';
  hint?: string;
}) {
  const toneClass = {
    default: 'text-slate-200',
    cyan: 'text-signal-cyan',
    amber: 'text-consensus-amber',
    green: 'text-live-green',
    red: 'text-fail-red',
    muted: 'text-muted',
  }[tone];

  return (
    <div className="flex flex-col gap-0.5" title={hint}>
      <span className="stat-label">{label}</span>
      <span className={`font-mono text-sm ${toneClass}`}>{value}</span>
    </div>
  );
}

export function Dot({
  tone,
  pulse = false,
}: {
  tone: 'green' | 'red' | 'amber' | 'cyan' | 'grey';
  pulse?: boolean;
}) {
  const colour = {
    green: 'bg-live-green',
    red: 'bg-fail-red',
    amber: 'bg-consensus-amber',
    cyan: 'bg-signal-cyan',
    grey: 'bg-ink-400',
  }[tone];

  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${colour} ${
        pulse ? 'animate-pulse-fast' : ''
      }`}
    />
  );
}

export function Tag({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'cyan' | 'amber' | 'green' | 'red';
}) {
  const toneClass = {
    muted: 'border-ink-400 text-muted',
    cyan: 'border-signal-cyan/40 text-signal-cyan',
    amber: 'border-consensus-amber/40 text-consensus-amber',
    green: 'border-live-green/40 text-live-green',
    red: 'border-fail-red/40 text-fail-red',
  }[tone];

  return (
    <span className={`border px-1.5 py-0.5 text-2xs uppercase tracking-[0.12em] ${toneClass}`}>
      {children}
    </span>
  );
}

/** Quorum progress. Deliberately shows the threshold line, not just a fill. */
export function QuorumBar({
  approvals,
  rejections,
  registered,
  threshold,
}: {
  approvals: number;
  rejections: number;
  registered: number;
  threshold: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="relative flex h-2 w-full gap-px overflow-hidden bg-ink-700">
        {Array.from({ length: registered }, (_, i) => {
          const filled = i < approvals;
          const rejected = i >= registered - rejections;
          return (
            <div
              key={i}
              className={`h-full flex-1 ${
                filled ? 'bg-live-green' : rejected ? 'bg-fail-red/70' : 'bg-ink-500'
              }`}
            />
          );
        })}
        <div
          className="absolute top-0 h-full w-px bg-consensus-amber"
          style={{ left: `${(threshold / registered) * 100}%` }}
          title={`quorum threshold: ${threshold}`}
        />
      </div>
      <div className="flex justify-between text-2xs text-muted">
        <span>
          {approvals}/{registered} APPROVE
        </span>
        <span className="text-consensus-amber">QUORUM {threshold}</span>
      </div>
    </div>
  );
}
