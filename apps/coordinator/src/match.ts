/**
 * The match state machine.
 *
 * This module sequences the GAME - lobby, turn order, red light, the randomized
 * delay, the GO signal. It deliberately owns no consensus logic and never
 * decides a result: it does not know who won, and it never writes to the chain.
 * Whether a reaction counted is settled by the validator network, and the
 * winner is settled by the block. All this does is decide when to turn the light
 * green and whose turn is next.
 */
import {
  RED_LIGHT_MAX_MS,
  RED_LIGHT_MIN_MS,
  randomHex,
  type MatchPhase,
  type PlayerIdentity,
  type TurnSummary,
} from '@reflexchain/protocol';

/** How long a player has to react before the turn is abandoned. */
const TURN_TIMEOUT_MS = 10_000;
const GET_READY_MS = 1_200;

export interface ClientTurnReport {
  turnIndex: number;
  reactionMs: number | null;
  falseStart: boolean;
}

export interface MatchSnapshot {
  matchId: string;
  code: string;
  phase: MatchPhase;
  players: PlayerIdentity[];
  activeTurn: number;
  goSeq: number;
  turnReports: (ClientTurnReport | null)[];
  turnResults: (TurnSummary | null)[];
  hotseat: boolean;
  createdAt: number;
  /** Populated at GO so the client can compute its own reaction baseline. */
  goIssuedAt: number | null;
}

export interface MatchCallbacks {
  onPhase: (match: Match, phase: MatchPhase, extra?: Record<string, unknown>) => void;
  onGo: (match: Match, turnIndex: number, goSeq: number) => void;
  onOpen: (match: Match) => void;
  onComplete: (match: Match) => void;
}

let goSeqCounter = 0;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

export function generateMatchCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export class Match {
  readonly matchId: string;
  readonly code: string;
  readonly hotseat: boolean;
  readonly createdAt = Date.now();

  players: PlayerIdentity[] = [];
  phase: MatchPhase = 'LOBBY';
  activeTurn = 0;
  goSeq = 0;
  goIssuedAt: number | null = null;
  turnReports: (ClientTurnReport | null)[] = [null, null];
  turnResults: (TurnSummary | null)[] = [null, null];

  private timers: NodeJS.Timeout[] = [];
  private readonly callbacks: MatchCallbacks;

  constructor(options: { hotseat: boolean; callbacks: MatchCallbacks; code?: string }) {
    this.matchId = `match-${randomHex(6)}`;
    this.code = options.code ?? generateMatchCode();
    this.hotseat = options.hotseat;
    this.callbacks = options.callbacks;
  }

  private schedule(fn: () => void, delay: number): void {
    const timer = setTimeout(fn, delay);
    timer.unref?.();
    this.timers.push(timer);
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  private setPhase(phase: MatchPhase, extra?: Record<string, unknown>): void {
    this.phase = phase;
    this.callbacks.onPhase(this, phase, extra);
  }

  addPlayer(identity: PlayerIdentity): boolean {
    if (this.players.length >= 2) return false;
    if (this.players.some((p) => p.address === identity.address)) return false;
    this.players.push(identity);
    if (this.players.length === 2) this.setPhase('MATCH_READY');
    return true;
  }

  get isFull(): boolean {
    return this.players.length === 2;
  }

  /** Register the match with the validators, then run turn 0. */
  start(): void {
    if (!this.isFull || this.phase === 'GET_READY') return;
    this.callbacks.onOpen(this);
    // Give MATCH_OPEN a beat to reach every node before the first GO.
    this.schedule(() => this.beginTurn(0), 400);
  }

  private beginTurn(turnIndex: number): void {
    this.activeTurn = turnIndex;
    this.turnReports[turnIndex] = null;
    this.goIssuedAt = null;

    this.setPhase('GET_READY', { turnIndex, player: this.players[turnIndex]?.address });

    this.schedule(() => {
      this.setPhase('RED_LIGHT', { turnIndex });

      // The delay is randomized so the press cannot be pre-planned; this is the
      // only reason the reaction number means anything at all.
      const delay =
        RED_LIGHT_MIN_MS + Math.floor(Math.random() * (RED_LIGHT_MAX_MS - RED_LIGHT_MIN_MS));

      this.schedule(() => this.fireGo(turnIndex), delay);
    }, GET_READY_MS);
  }

  private fireGo(turnIndex: number): void {
    // A player who already false-started skipped this turn's GO entirely.
    if (this.turnReports[turnIndex]) return;

    this.goSeq = ++goSeqCounter;
    this.goIssuedAt = Date.now();

    this.callbacks.onGo(this, turnIndex, this.goSeq);
    this.setPhase('GO', { turnIndex, goSeq: this.goSeq, goIssuedAt: this.goIssuedAt });

    this.schedule(() => {
      if (!this.turnReports[turnIndex]) {
        this.reportTurn(turnIndex, { turnIndex, reactionMs: null, falseStart: false });
      }
    }, TURN_TIMEOUT_MS);
  }

  /**
   * The client reporting that it pressed. This advances the GAME only. It is
   * not evidence and it is not trusted: the authoritative record of what
   * happened is the signed event the browser sent straight to the validators.
   */
  reportTurn(turnIndex: number, report: ClientTurnReport): void {
    if (turnIndex !== this.activeTurn) return;
    if (this.turnReports[turnIndex]) return;

    this.turnReports[turnIndex] = report;
    this.setPhase('COLLECTING', { turnIndex, report });

    this.schedule(() => {
      if (turnIndex + 1 < this.players.length) {
        this.beginTurn(turnIndex + 1);
      } else {
        this.setPhase('BLOCK_PROPOSAL');
        this.callbacks.onComplete(this);
      }
    }, 1_400);
  }

  /** Record the network's verdict for a turn, once the chain reports it. */
  recordResult(summary: TurnSummary): void {
    this.turnResults[summary.turnIndex] = summary;
  }

  finalize(): void {
    this.setPhase('FINALIZED');
  }

  abandon(): void {
    this.clearTimers();
    this.setPhase('ABANDONED');
  }

  snapshot(): MatchSnapshot {
    return {
      matchId: this.matchId,
      code: this.code,
      phase: this.phase,
      players: this.players,
      activeTurn: this.activeTurn,
      goSeq: this.goSeq,
      turnReports: this.turnReports,
      turnResults: this.turnResults,
      hotseat: this.hotseat,
      createdAt: this.createdAt,
      goIssuedAt: this.goIssuedAt,
    };
  }
}
