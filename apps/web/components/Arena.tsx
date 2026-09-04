'use client';

import { useMemo, useState } from 'react';
import { shortHash } from '@reflexchain/protocol';
import { selectTurnKey, useReflex } from '../lib/store';
import type { LocalPhase, TurnOutcomeLocal } from '../lib/useGame';
import type { Wallet } from '../lib/wallet';
import { Tag } from './primitives';

interface ArenaProps {
  phase: LocalPhase;
  wallet: Wallet | null;
  secondWallet: Wallet | null;
  localTurns: TurnOutcomeLocal[];
  error: string | null;
  onCreate: (hotseat: boolean) => void;
  onJoin: (code: string) => void;
  onStart: () => void;
  onLeave: () => void;
  onPress: () => void;
}

const LIGHT = {
  IDLE: { bg: 'bg-ink-700', ring: 'border-ink-500', label: 'STANDBY' },
  LOBBY: { bg: 'bg-ink-700', ring: 'border-ink-500', label: 'LOBBY' },
  GET_READY: { bg: 'bg-consensus-amber/20', ring: 'border-consensus-amber/50', label: 'GET READY' },
  RED: { bg: 'bg-fail-red/25', ring: 'border-fail-red/60', label: 'WAIT' },
  GREEN: { bg: 'bg-live-green/30', ring: 'border-live-green', label: 'GO' },
  PRESSED: { bg: 'bg-signal-cyan/15', ring: 'border-signal-cyan/50', label: 'BROADCAST' },
  FALSE_START: { bg: 'bg-fail-red/30', ring: 'border-fail-red', label: 'FALSE START' },
  WAITING: { bg: 'bg-ink-700', ring: 'border-ink-500', label: 'VALIDATING' },
  COMPLETE: { bg: 'bg-ink-700', ring: 'border-ink-500', label: 'SEALED' },
} as const;

export function Arena(props: ArenaProps) {
  const { phase, wallet, localTurns, error } = props;
  const match = useReflex((s) => s.match);
  const seat = useReflex((s) => s.seat);
  const coordinatorLinked = useReflex((s) => s.coordinatorLinked);
  const networkMode = useReflex((s) => s.networkMode);
  const chainSource = useReflex((s) => s.chainSource);
  const talliesByTurn = useReflex((s) => s.talliesByTurn);
  const [joinCode, setJoinCode] = useState('');

  /**
   * Both turns, as the NETWORK sees them.
   *
   * `localTurns` only ever contains the press this device made, so on two
   * devices each player could see their own time and never the opponent's -
   * making it impossible to tell who won. The validator tallies are the fix and
   * the honest source: every client subscribes to all five validators, so both
   * devices receive TELEMETRY_TALLY for BOTH turns.
   *
   * The local claim is still used before consensus settles, so the player who
   * just pressed gets immediate feedback - but it is marked unconfirmed until
   * the network agrees, and the confirmed value always wins.
   */
  const turnResults = useMemo(() => {
    return [0, 1].map((turnIndex) => {
      const local = localTurns.find((t) => t.turnIndex === turnIndex);
      const tally = match ? talliesByTurn[selectTurnKey(match.matchId, turnIndex)] : undefined;
      const settled = tally && tally.status !== 'PENDING';

      if (settled) {
        return {
          turnIndex,
          reactionMs: tally.canonicalReactionMs,
          falseStart: tally.outcome === 'FALSE_START',
          rejected: tally.outcome === 'REJECTED' || tally.outcome === 'INCONCLUSIVE',
          confirmed: true,
          approvals: tally.approvals,
          registered: tally.registered,
          local,
        };
      }

      return {
        turnIndex,
        reactionMs: local?.reactionMs ?? null,
        falseStart: local?.falseStart ?? false,
        rejected: false,
        confirmed: false,
        approvals: 0,
        registered: 0,
        local,
      };
    });
  }, [localTurns, talliesByTurn, match]);

  /**
   * Which turn won, once both are confirmed. Only turns the network confirmed
   * VALID are eligible, so a false start forfeits outright. Deliberately does
   * not guess from unconfirmed local claims - the winner is not shown until the
   * validators have actually settled both turns.
   */
  const winningTurn = useMemo(() => {
    const eligible = turnResults.filter(
      (t) => t.confirmed && !t.falseStart && !t.rejected && typeof t.reactionMs === 'number',
    );
    const bothSettled = turnResults.every((t) => t.confirmed);
    if (!bothSettled || eligible.length === 0) return null;

    const sorted = [...eligible].sort((a, b) => a.reactionMs! - b.reactionMs!);
    // A tie has no winner rather than an arbitrary one.
    if (sorted.length > 1 && sorted[0]!.reactionMs === sorted[1]!.reactionMs) return null;
    return sorted[0]!.turnIndex;
  }, [turnResults]);

  // No validator answered, so there is nothing to play against. Rather than
  // offering controls that can only fail, explain what this page is.
  //
  // Keyed off chainSource rather than networkMode: the sockets retry forever, so
  // networkMode oscillates between CONNECTING and NOT_CONNECTED and is almost
  // never observed in the latter. Falling back to the archived chain, by
  // contrast, happens only after every validator failed to answer - which is
  // exactly the condition worth explaining.
  const networkDown = chainSource === 'SNAPSHOT' || (networkMode === 'NOT_CONNECTED' && !coordinatorLinked);

  const light = LIGHT[phase];
  const inMatch = match !== null;
  const activeTurn = match?.activeTurn ?? 0;
  const isMyTurn = match?.hotseat || seat === activeTurn;
  const activePlayer = match?.players[activeTurn];

  return (
    <section className="panel flex flex-col">
      <header className="panel-title">
        <span>GAME ARENA</span>
        <span className="normal-case tracking-normal">
          {match ? (
            <span className="flex items-center gap-2">
              <Tag tone="cyan">{match.code}</Tag>
              {match.hotseat ? <Tag>HOTSEAT</Tag> : null}
            </span>
          ) : (
            <Tag tone={coordinatorLinked ? 'green' : 'red'}>
              {coordinatorLinked ? 'COORDINATOR LINKED' : 'NO COORDINATOR'}
            </Tag>
          )}
        </span>
      </header>

      <div className="flex flex-1 flex-col">
        {/* ---------------- the light ---------------- */}
        <button
          type="button"
          onClick={props.onPress}
          disabled={!inMatch}
          className={`relative flex min-h-[240px] flex-1 flex-col items-center justify-center border-b-2 transition-colors duration-100 ${light.bg} ${light.ring} ${
            inMatch ? 'cursor-pointer' : 'cursor-default'
          }`}
        >
          <span
            className={`font-mono text-6xl font-light tracking-[0.2em] ${
              phase === 'GREEN'
                ? 'text-live-green'
                : phase === 'RED'
                  ? 'text-fail-red'
                  : phase === 'FALSE_START'
                    ? 'text-fail-red'
                    : 'text-slate-400'
            }`}
          >
            {light.label}
          </span>

          {phase === 'GREEN' ? (
            <span className="mt-3 text-2xs uppercase tracking-[0.3em] text-live-green/70">
              press space
            </span>
          ) : null}

          {phase === 'RED' ? (
            <span className="mt-3 text-2xs uppercase tracking-[0.3em] text-fail-red/60">
              pressing now forfeits the turn
            </span>
          ) : null}

          {inMatch && activePlayer && phase !== 'LOBBY' ? (
            <span className="mt-6 text-2xs uppercase tracking-[0.2em] text-muted">
              turn {activeTurn + 1} of 2 &nbsp;·&nbsp; {activePlayer.label}
              {!isMyTurn ? ' · opponent' : ''}
            </span>
          ) : null}

          {/* Precision note. It matters that we never overclaim this number. */}
          {phase === 'GREEN' || phase === 'PRESSED' ? (
            <span className="absolute bottom-3 text-2xs text-muted/60">
              measured on this device&apos;s monotonic clock, from the painted GREEN frame
            </span>
          ) : null}
        </button>

        {/* ---------------- lobby / controls ---------------- */}
        <div className="border-b border-ink-500 px-4 py-3">
          {networkDown && !inMatch ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-2xs uppercase tracking-[0.16em] text-consensus-amber">
                  validator network unreachable
                </span>
                {chainSource === 'SNAPSHOT' ? <Tag tone="amber">ARCHIVED SNAPSHOT</Tag> : null}
              </div>
              <p className="max-w-2xl text-2xs leading-relaxed text-muted">
                The chain below is real and still verifies in your browser, but no validators are
                answering right now, so there is nothing to play against. The network is five
                separate processes plus a coordinator; bring them up with:
              </p>
              <code className="inline-block border border-ink-400 bg-ink-900 px-2.5 py-1.5 text-2xs text-signal-cyan">
                npm run demo
              </code>
              <p className="text-2xs text-muted/70">
                Then reload. The dashboard reconnects on its own.
              </p>
            </div>
          ) : !inMatch ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-primary"
                onClick={() => props.onCreate(false)}
                disabled={!coordinatorLinked}
              >
                create match
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => props.onCreate(true)}
                disabled={!coordinatorLinked}
              >
                hotseat (one keyboard)
              </button>
              <span className="mx-1 text-ink-400">|</span>
              <input
                type="text"
                value={joinCode}
                maxLength={6}
                placeholder="CODE"
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                className="w-28"
              />
              <button
                type="button"
                className="btn-ghost"
                onClick={() => props.onJoin(joinCode)}
                disabled={!coordinatorLinked || joinCode.length !== 6}
              >
                join
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {match.players.length < 2 ? (
                <span className="text-2xs uppercase tracking-[0.16em] text-consensus-amber">
                  waiting for opponent · share code {match.code}
                </span>
              ) : phase === 'LOBBY' ? (
                <button type="button" className="btn-primary" onClick={props.onStart}>
                  start match
                </button>
              ) : (
                <span className="text-2xs uppercase tracking-[0.16em] text-muted">
                  {phase === 'COMPLETE' ? 'match sealed' : 'match in progress'}
                </span>
              )}
              <button type="button" className="btn-ghost" onClick={props.onLeave}>
                leave
              </button>
            </div>
          )}

          {error ? (
            <p className="mt-2 text-2xs uppercase tracking-[0.14em] text-fail-red">{error}</p>
          ) : null}
        </div>

        {/* ---------------- per-turn claims ---------------- */}
        <div className="grid grid-cols-2 divide-x divide-ink-500">
          {turnResults.map((result) => {
            const turnIndex = result.turnIndex;
            const player = match?.players[turnIndex];
            const local = result.local;
            const isActive = inMatch && activeTurn === turnIndex && phase !== 'COMPLETE';
            const won = winningTurn === turnIndex;
            const lost = winningTurn !== null && !won;

            return (
              <div
                key={turnIndex}
                className={`px-4 py-3 transition-colors ${
                  won ? 'bg-live-green/10' : isActive ? 'bg-ink-700/60' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`stat-label ${won ? 'text-live-green' : ''}`}>
                    {player?.label ?? `PLAYER 0${turnIndex + 1}`}
                  </span>
                  {won ? (
                    <Tag tone="green">WINNER</Tag>
                  ) : isActive ? (
                    <Tag tone="cyan">ACTIVE</Tag>
                  ) : null}
                </div>

                <div className="mt-1 font-mono text-2xl">
                  {result.falseStart ? (
                    <span className="text-fail-red">FALSE START</span>
                  ) : result.rejected ? (
                    <span className="text-consensus-amber">NO RESULT</span>
                  ) : result.reactionMs != null ? (
                    <span
                      className={
                        won
                          ? 'text-live-green'
                          : lost
                            ? 'text-muted'
                            : result.confirmed
                              ? 'text-slate-100'
                              : 'text-slate-400'
                      }
                    >
                      {result.reactionMs}
                      <span className="ml-1 text-xs text-muted">MS</span>
                    </span>
                  ) : (
                    <span className="text-ink-400">---</span>
                  )}
                </div>

                <div className="mt-1 flex flex-col gap-0.5">
                  <span className="hash">
                    {player ? shortHash(player.address, 8, 4) : '0x-------'}
                  </span>
                  {result.confirmed ? (
                    <span className={`text-2xs ${won ? 'text-live-green/80' : 'text-muted'}`}>
                      confirmed by {result.approvals}/{result.registered} validators
                    </span>
                  ) : local ? (
                    <span className="text-2xs text-consensus-amber">
                      awaiting consensus · broadcast to {local.sentTo.length}/
                      {local.sentTo.length + local.failed.length}
                    </span>
                  ) : (
                    <span className="text-2xs text-muted/50">claim not yet submitted</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ---------------- identity ---------------- */}
        <div className="flex items-center justify-between border-t border-ink-500 px-4 py-2">
          <span className="stat-label">your signing key</span>
          <span className="hash">
            {wallet ? shortHash(wallet.address, 10, 6) : 'generating...'}
          </span>
        </div>
      </div>
    </section>
  );
}
