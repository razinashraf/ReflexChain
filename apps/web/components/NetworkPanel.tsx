'use client';

import { useMemo, useState } from 'react';
import { quorumFor, shortHash } from '@reflexchain/protocol';
import { REGISTERED_VALIDATORS, validatorEndpoints } from '../lib/config';
import { postAdmin } from '../lib/network';
import { forkedNodesFrom, useReflex } from '../lib/store';
import { Dot, Panel, Tag } from './primitives';

export function NetworkPanel() {
  const statuses = useReflex((s) => s.statuses);
  const links = useReflex((s) => s.links);
  // Derived here rather than in a store selector: a selector returning a
  // fresh array never satisfies reference equality, which turns every store
  // update into a re-render loop.
  const forked = useMemo(() => forkedNodesFrom(statuses), [statuses]);
  const [busy, setBusy] = useState<string | null>(null);

  const endpoints = useMemo(() => validatorEndpoints(), []);
  const threshold = quorumFor(REGISTERED_VALIDATORS);
  const onlineCount = Object.values(statuses).filter((s) => s.online).length;
  const quorumHeld = onlineCount >= threshold;

  async function act(validatorId: string, path: string, body?: unknown) {
    setBusy(`${validatorId}${path}`);
    await postAdmin(validatorId, path, body);
    setBusy(null);
  }

  return (
    <Panel
      title="Validator network"
      right={
        <span className="flex items-center gap-2">
          <Tag tone={quorumHeld ? 'green' : 'red'}>
            {quorumHeld ? `QUORUM ${onlineCount}/${REGISTERED_VALIDATORS}` : 'CONSENSUS HALTED'}
          </Tag>
        </span>
      }
    >
      <div className="divide-y divide-ink-600">
        {endpoints.map((endpoint) => {
          const status = statuses[endpoint.validatorId];
          const link = links[endpoint.validatorId] ?? 'IDLE';
          const online = status?.online ?? false;
          const reachable = link === 'OPEN';
          const isForked = forked.includes(endpoint.validatorId);
          const chainBroken = status ? !status.chainValid : false;

          const tone = !reachable
            ? 'grey'
            : status?.byzantine
              ? 'red'
              : chainBroken || isForked
                ? 'red'
                : online
                  ? 'green'
                  : 'amber';

          return (
            <div key={endpoint.validatorId} className="px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Dot tone={tone} pulse={link === 'CONNECTING'} />
                  <span className="font-mono text-xs uppercase text-slate-200">
                    {endpoint.validatorId}
                  </span>
                  <span className="text-2xs text-muted">:{endpoint.httpUrl.split(':').pop()}</span>
                </span>

                <span className="flex items-center gap-1">
                  {status?.byzantine ? <Tag tone="red">BYZANTINE</Tag> : null}
                  {chainBroken ? <Tag tone="red">CHAIN INVALID</Tag> : null}
                  {isForked && !chainBroken ? <Tag tone="red">FORKED</Tag> : null}
                  {!reachable ? (
                    <Tag tone="muted">{link === 'CONNECTING' ? 'DIALLING' : 'OFFLINE'}</Tag>
                  ) : null}
                </span>
              </div>

              <div className="mt-1.5 grid grid-cols-4 gap-2 text-2xs">
                <span className="text-muted">
                  H <span className="text-slate-300">{status?.height ?? '-'}</span>
                </span>
                <span className="text-muted">
                  TX <span className="text-slate-300">{status?.transactions ?? '-'}</span>
                </span>
                <span className="text-muted">
                  PEERS{' '}
                  <span
                    className={
                      status && status.peersConnected < status.peersTotal
                        ? 'text-consensus-amber'
                        : 'text-slate-300'
                    }
                  >
                    {status ? `${status.peersConnected}/${status.peersTotal}` : '-'}
                  </span>
                </span>
                <span className="text-muted">
                  ε <span className="text-slate-300">{status?.epsilonMs ?? '-'}</span>
                </span>
              </div>

              <div className="mt-1 flex items-center justify-between">
                <span className="hash" title={status?.headHash}>
                  HEAD {status ? shortHash(status.headHash, 8, 6) : '--------'}
                </span>

                <span className="flex gap-1">
                  <button
                    type="button"
                    className="border border-ink-400 px-1.5 py-0.5 text-2xs uppercase text-muted transition-colors hover:border-fail-red/50 hover:text-fail-red disabled:opacity-30"
                    disabled={busy !== null}
                    onClick={() =>
                      act(endpoint.validatorId, online ? '/admin/kill' : '/admin/revive')
                    }
                  >
                    {online ? 'kill' : 'revive'}
                  </button>
                  <button
                    type="button"
                    className="border border-ink-400 px-1.5 py-0.5 text-2xs uppercase text-muted transition-colors hover:border-consensus-amber/50 hover:text-consensus-amber disabled:opacity-30"
                    disabled={busy !== null}
                    onClick={() =>
                      act(endpoint.validatorId, '/admin/byzantine', {
                        on: !status?.byzantine,
                      })
                    }
                  >
                    {status?.byzantine ? 'honest' : 'corrupt'}
                  </button>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-ink-500 px-3 py-2">
        <p className="text-2xs leading-relaxed text-muted">
          Quorum is <span className="text-consensus-amber">{threshold} of {REGISTERED_VALIDATORS}</span>,
          computed over the registered set rather than whoever is currently reachable. One node
          down still commits blocks; two down halts the network.
        </p>
      </div>
    </Panel>
  );
}
