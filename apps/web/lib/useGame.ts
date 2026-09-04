'use client';

/**
 * The game hook: wallet, coordinator link, validator links, keyboard, timing.
 *
 * TIMING MODEL (this is the part worth being precise about)
 * ---------------------------------------------------------
 * The baseline is captured with a double requestAnimationFrame after the GREEN
 * state renders, i.e. as close as this platform gets to "the frame the player
 * could actually see", falling back to the state-commit time if rAF does not
 * run (a hidden tab pauses it). The reaction is `performance.now()` at keydown
 * minus that baseline - one monotonic clock, one device, and at no point are
 * wall clocks compared between machines.
 *
 * That number is a CLAIM. It is signed and broadcast to all five validators,
 * each of which independently decides whether the claim is admissible against
 * its own observation. We never assert it is physically exact, and we never
 * compare wall clocks between devices.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PressEvent } from '@reflexchain/protocol';
import { coordinatorSocket, emitWithAck } from './coordinator';
import { fetchChain, fetchSnapshot, validatorNetwork } from './network';
import { useReflex, type MatchSnapshot } from './store';
import { buildPressEvent, loadWallet, mintWallet, saveWallet, type Wallet } from './wallet';

export type LocalPhase =
  | 'IDLE'
  | 'LOBBY'
  | 'GET_READY'
  | 'RED'
  | 'GREEN'
  | 'PRESSED'
  | 'FALSE_START'
  | 'WAITING'
  | 'COMPLETE';

export interface TurnOutcomeLocal {
  turnIndex: number;
  label: string;
  reactionMs: number | null;
  falseStart: boolean;
  sentTo: string[];
  failed: string[];
}

export function useGame() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [secondWallet, setSecondWallet] = useState<Wallet | null>(null);
  const [phase, setPhase] = useState<LocalPhase>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [localTurns, setLocalTurns] = useState<TurnOutcomeLocal[]>([]);
  const [lastEvent, setLastEvent] = useState<PressEvent | null>(null);

  const match = useReflex((s) => s.match);
  const seat = useReflex((s) => s.seat);
  const setMatch = useReflex((s) => s.setMatch);
  const setSeat = useReflex((s) => s.setSeat);
  const setStatusLine = useReflex((s) => s.setStatusLine);
  const setCoordinatorLinked = useReflex((s) => s.setCoordinatorLinked);
  const resetTelemetry = useReflex((s) => s.resetTelemetry);
  const setChain = useReflex((s) => s.setChain);

  /** performance.now() at the frame the GREEN light was painted. */
  const goPaintedAt = useRef<number | null>(null);
  const activeTurn = useRef<number>(0);
  const pressedThisTurn = useRef<boolean>(false);
  const matchRef = useRef<MatchSnapshot | null>(null);
  const phaseRef = useRef<LocalPhase>('IDLE');
  const seatRef = useRef<number | null>(null);
  const walletRef = useRef<Wallet | null>(null);

  matchRef.current = match;
  phaseRef.current = phase;
  seatRef.current = seat;
  walletRef.current = wallet;

  // --- boot ---------------------------------------------------------------

  useEffect(() => {
    const w = loadWallet();
    setWallet(w);
    saveWallet(w);
    validatorNetwork.start();
    return () => validatorNetwork.stop();
  }, []);

  // --- coordinator wiring -------------------------------------------------

  useEffect(() => {
    const socket = coordinatorSocket();

    const onConnect = () => {
      setCoordinatorLinked(true);
      setStatusLine('COORDINATOR LINKED');

      // A reconnect arrives with a new socket id, so the seat and room
      // membership from before the drop are gone. Claim the seat back using the
      // signing identity, or the player silently stops receiving the lights.
      const current = matchRef.current;
      const signer = walletRef.current;
      if (current && signer) {
        void emitWithAck<{ ok: boolean; seat?: number; match?: MatchSnapshot }>('resume_match', {
          matchId: current.matchId,
          identity: { pubKey: signer.publicKey, label: signer.label },
        })
          .then((res) => {
            if (res.ok && res.match) {
              setMatch(res.match);
              if (typeof res.seat === 'number') setSeat(res.seat);
              setStatusLine('RECONNECTED - SEAT RESUMED');
            }
          })
          .catch(() => {
            /* the match is gone; the lobby controls are still available */
          });
      }
    };
    const onDisconnect = () => {
      setCoordinatorLinked(false);
      setStatusLine('COORDINATOR UNREACHABLE');
    };

    const onLobby = (payload: { match: MatchSnapshot }) => {
      setMatch(payload.match);
      setPhase('LOBBY');
    };

    const onPhase = (payload: {
      phase: string;
      turnIndex?: number;
      match: MatchSnapshot;
    }) => {
      setMatch(payload.match);

      switch (payload.phase) {
        case 'GET_READY':
          activeTurn.current = payload.turnIndex ?? 0;
          pressedThisTurn.current = false;
          goPaintedAt.current = null;
          setPhase('GET_READY');
          break;
        case 'RED_LIGHT':
          setPhase('RED');
          break;
        case 'GO':
          setPhase('GREEN');
          break;
        case 'COLLECTING':
          setPhase('WAITING');
          break;
        case 'BLOCK_PROPOSAL':
          setPhase('COMPLETE');
          break;
        default:
          break;
      }
    };

    const onComplete = (payload: { match: MatchSnapshot }) => {
      setMatch(payload.match);
      setPhase('COMPLETE');
      setStatusLine('TURNS COMPLETE - AWAITING BLOCK');
      // Give the network a moment to seal the block, then pull the new chain.
      setTimeout(() => void refreshChain(), 2_500);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('lobby', onLobby);
    socket.on('phase', onPhase);
    socket.on('match_complete', onComplete);

    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('lobby', onLobby);
      socket.off('phase', onPhase);
      socket.off('match_complete', onComplete);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- capture the GREEN paint timestamp ----------------------------------

  useEffect(() => {
    if (phase !== 'GREEN') return;

    // Fallback baseline, set synchronously on the state commit. Without this a
    // press is silently dropped whenever rAF does not run - a backgrounded or
    // hidden tab pauses it entirely - and the player gets no reaction at all.
    goPaintedAt.current = performance.now();

    // Preferred baseline: two frames on, i.e. after the browser has actually
    // painted GREEN. This is the number we want whenever it is available, and
    // it is never more than a frame or two later than the fallback.
    let cancelled = false;
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) goPaintedAt.current = performance.now();
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
    };
  }, [phase]);

  // --- chain refresh ------------------------------------------------------

  const refreshChain = useCallback(async () => {
    const result = await fetchChain();
    if (result) {
      setChain(result.blocks as never, 'LIVE', result.validatorId);
      return;
    }

    // No validator answered. Rather than show an empty explorer, fall back to
    // the archived ledger - clearly labelled, so nobody mistakes it for live.
    const snapshot = await fetchSnapshot();
    if (snapshot) setChain(snapshot.blocks as never, 'SNAPSHOT', null);
  }, [setChain]);

  useEffect(() => {
    void refreshChain();
    const timer = setInterval(() => void refreshChain(), 4_000);
    return () => clearInterval(timer);
  }, [refreshChain]);

  // --- the press ----------------------------------------------------------

  const submitPress = useCallback(
    (kind: 'PRESS' | 'FALSE_START', reactionMs: number) => {
      const current = matchRef.current;
      if (!current) return;

      const turnIndex = activeTurn.current;
      // In hotseat the second seat signs with its own key, so the two turns are
      // genuinely two different identities on the chain.
      const signer = current.hotseat && turnIndex === 1 ? secondWallet : wallet;
      if (!signer) return;

      const event = buildPressEvent({
        wallet: signer,
        matchId: current.matchId,
        turnIndex,
        goSeq: current.goSeq,
        reactionMs: kind === 'FALSE_START' ? 0 : reactionMs,
        kind,
      });

      // Straight to all five validators. Never via the coordinator.
      const { sentTo, failed } = validatorNetwork.broadcastPress(event);

      setLastEvent(event);
      setLocalTurns((prev) => [
        ...prev.filter((t) => t.turnIndex !== turnIndex),
        {
          turnIndex,
          label: signer.label,
          reactionMs: kind === 'FALSE_START' ? null : Math.round(reactionMs),
          falseStart: kind === 'FALSE_START',
          sentTo,
          failed,
        },
      ]);

      // Tell the coordinator so it can advance the turn. Pacing only.
      coordinatorSocket().emit('turn_pressed', {
        turnIndex,
        reactionMs: kind === 'FALSE_START' ? null : Math.round(reactionMs),
        falseStart: kind === 'FALSE_START',
      });

      setStatusLine(
        kind === 'FALSE_START'
          ? `FALSE START BROADCAST TO ${sentTo.length} VALIDATORS`
          : `${Math.round(reactionMs)} MS CLAIM BROADCAST TO ${sentTo.length} VALIDATORS`,
      );
    },
    [wallet, secondWallet, setStatusLine],
  );

  const handlePress = useCallback(() => {
    if (pressedThisTurn.current) return;

    // Not your turn: do nothing at all. On two devices both players are staring
    // at the same lights, and a spectator press must not disturb the turn or
    // emit an event the validators would only reject as WRONG_ROUND anyway.
    const current = matchRef.current;
    if (current && !current.hotseat && seatRef.current !== null) {
      if (seatRef.current !== activeTurn.current) return;
    }

    const currentPhase = phaseRef.current;

    if (currentPhase === 'RED' || currentPhase === 'GET_READY') {
      pressedThisTurn.current = true;
      setPhase('FALSE_START');
      submitPress('FALSE_START', 0);
      return;
    }

    if (currentPhase === 'GREEN') {
      const baseline = goPaintedAt.current;
      if (baseline === null) return; // GREEN has not painted yet
      pressedThisTurn.current = true;
      const reactionMs = performance.now() - baseline;
      setPhase('PRESSED');
      submitPress('PRESS', reactionMs);
    }
  }, [submitPress]);

  // --- keyboard -----------------------------------------------------------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      e.preventDefault();
      if (e.repeat) return;
      handlePress();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePress]);

  // --- lobby actions ------------------------------------------------------

  const createMatch = useCallback(
    async (hotseat: boolean) => {
      if (!wallet) return;
      setError(null);
      resetTelemetry();
      setLocalTurns([]);

      try {
        const res = await emitWithAck<{
          ok: boolean;
          error?: string;
          seat?: number;
          match?: MatchSnapshot;
        }>('create_match', { hotseat, identity: { pubKey: wallet.publicKey, label: wallet.label } });

        if (!res.ok || !res.match) {
          setError(res.error ?? 'could not create match');
          return;
        }

        setSeat(res.seat ?? 0);
        setMatch(res.match);
        setPhase('LOBBY');

        if (hotseat) {
          const second = mintWallet('PLAYER 02');
          setSecondWallet(second);
          await emitWithAck('seat_second_player', {
            identity: { pubKey: second.publicKey, label: second.label },
          });
        }
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [wallet, resetTelemetry, setMatch, setSeat],
  );

  const joinMatch = useCallback(
    async (code: string) => {
      if (!wallet) return;
      setError(null);
      resetTelemetry();
      setLocalTurns([]);

      try {
        const res = await emitWithAck<{
          ok: boolean;
          error?: string;
          seat?: number;
          match?: MatchSnapshot;
        }>('join_match', { code, identity: { pubKey: wallet.publicKey, label: wallet.label } });

        if (!res.ok || !res.match) {
          setError(res.error ?? 'could not join match');
          return;
        }

        setSeat(res.seat ?? 1);
        setMatch(res.match);
        setPhase('LOBBY');
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [wallet, resetTelemetry, setMatch, setSeat],
  );

  const startMatch = useCallback(async () => {
    setError(null);
    try {
      const res = await emitWithAck<{ ok: boolean; error?: string }>('start_match', {});
      if (!res.ok) setError(res.error ?? 'could not start match');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const leaveMatch = useCallback(() => {
    setMatch(null);
    setSeat(null);
    setSecondWallet(null);
    setPhase('IDLE');
    setLocalTurns([]);
    resetTelemetry();
  }, [resetTelemetry, setMatch, setSeat]);

  return {
    wallet,
    secondWallet,
    phase,
    error,
    localTurns,
    lastEvent,
    match,
    seat,
    createMatch,
    joinMatch,
    startMatch,
    leaveMatch,
    handlePress,
    refreshChain,
  };
}
