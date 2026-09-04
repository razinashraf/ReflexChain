'use client';

/**
 * Client state.
 *
 * Everything in here is derived from real messages: validator telemetry over
 * five independent sockets, and blocks fetched from a validator's own ledger.
 * Nothing is simulated to make the interface look busier than the network is.
 */
import { create } from 'zustand';
import {
  validateChain,
  type Block,
  type ChainValidationResult,
  type TallyResult,
  type ValidatorStatus,
  type Vote,
} from '@reflexchain/protocol';

export type LinkState = 'IDLE' | 'CONNECTING' | 'OPEN' | 'CLOSED';
export type NetworkMode = 'CONNECTING' | 'LIVE' | 'NOT_CONNECTED';
export type ChainSource = 'LIVE' | 'SNAPSHOT' | 'NONE';

export interface ArrivalRecord {
  validatorId: string;
  eventId: string;
  matchId: string;
  turnIndex: number;
  receivedAt: number;
}

export interface BlockLifecycleRecord {
  id: string;
  validatorId: string;
  stage: 'PROPOSED' | 'VERIFIED' | 'APPENDED' | 'REJECTED';
  blockIndex: number;
  blockHash: string;
  detail?: string;
  at: number;
}

export interface MatchPlayer {
  address: string;
  pubKey: string;
  label: string;
}

export interface MatchSnapshot {
  matchId: string;
  code: string;
  phase: string;
  players: MatchPlayer[];
  activeTurn: number;
  goSeq: number;
  turnReports: ({ turnIndex: number; reactionMs: number | null; falseStart: boolean } | null)[];
  hotseat: boolean;
  goIssuedAt: number | null;
}

const turnKey = (matchId: string, turnIndex: number) => `${matchId}#${turnIndex}`;

interface ReflexState {
  // --- network ---
  links: Record<string, LinkState>;
  statuses: Record<string, ValidatorStatus>;
  networkMode: NetworkMode;
  coordinatorLinked: boolean;

  // --- live consensus telemetry ---
  arrivals: ArrivalRecord[];
  votesByEvent: Record<string, Vote[]>;
  talliesByTurn: Record<string, TallyResult>;
  blockLifecycle: BlockLifecycleRecord[];
  /** The turn currently being decided, so panels can focus on it. */
  focusedTurn: string | null;

  // --- ledger ---
  chain: Block[];
  chainValidation: ChainValidationResult | null;
  chainSource: ChainSource;
  chainValidatorId: string | null;

  // --- match ---
  match: MatchSnapshot | null;
  seat: number | null;
  statusLine: string;

  // --- actions ---
  setLink: (validatorId: string, state: LinkState) => void;
  setStatus: (status: ValidatorStatus) => void;
  setCoordinatorLinked: (linked: boolean) => void;
  recordArrival: (arrival: ArrivalRecord) => void;
  recordVote: (vote: Vote) => void;
  recordTally: (matchId: string, turnIndex: number, tally: TallyResult) => void;
  recordBlockEvent: (record: Omit<BlockLifecycleRecord, 'id' | 'at'>) => void;
  setFocusedTurn: (matchId: string, turnIndex: number) => void;
  setChain: (chain: Block[], source: ChainSource, validatorId: string | null) => void;
  setMatch: (match: MatchSnapshot | null) => void;
  setSeat: (seat: number | null) => void;
  setStatusLine: (line: string) => void;
  resetTelemetry: () => void;
}

const MAX_ARRIVALS = 40;
const MAX_BLOCK_EVENTS = 60;

export const useReflex = create<ReflexState>((set, get) => ({
  links: {},
  statuses: {},
  networkMode: 'CONNECTING',
  coordinatorLinked: false,

  arrivals: [],
  votesByEvent: {},
  talliesByTurn: {},
  blockLifecycle: [],
  focusedTurn: null,

  chain: [],
  chainValidation: null,
  chainSource: 'NONE',
  chainValidatorId: null,

  match: null,
  seat: null,
  statusLine: 'INITIALISING',

  setLink: (validatorId, state) =>
    set((prev) => {
      const links = { ...prev.links, [validatorId]: state };
      const anyOpen = Object.values(links).some((l) => l === 'OPEN');
      const anyConnecting = Object.values(links).some((l) => l === 'CONNECTING');
      return {
        links,
        networkMode: anyOpen ? 'LIVE' : anyConnecting ? 'CONNECTING' : 'NOT_CONNECTED',
      };
    }),

  setStatus: (status) =>
    set((prev) => ({ statuses: { ...prev.statuses, [status.validatorId]: status } })),

  setCoordinatorLinked: (coordinatorLinked) => set({ coordinatorLinked }),

  recordArrival: (arrival) =>
    set((prev) => ({
      arrivals: [arrival, ...prev.arrivals].slice(0, MAX_ARRIVALS),
      focusedTurn: turnKey(arrival.matchId, arrival.turnIndex),
    })),

  recordVote: (vote) =>
    set((prev) => {
      const existing = prev.votesByEvent[vote.eventId] ?? [];
      // Telemetry arrives from five sockets, so the same vote is seen more than
      // once. Keyed by validatorId, a duplicate never inflates the count.
      if (existing.some((v) => v.validatorId === vote.validatorId)) return prev;
      return {
        votesByEvent: {
          ...prev.votesByEvent,
          [vote.eventId]: [...existing, vote].sort((a, b) =>
            a.validatorId.localeCompare(b.validatorId),
          ),
        },
      };
    }),

  recordTally: (matchId, turnIndex, tally) =>
    set((prev) => ({
      talliesByTurn: { ...prev.talliesByTurn, [turnKey(matchId, turnIndex)]: tally },
    })),

  recordBlockEvent: (record) =>
    set((prev) => {
      const id = `${record.validatorId}:${record.stage}:${record.blockHash}`;
      if (prev.blockLifecycle.some((r) => r.id === id)) return prev;
      return {
        blockLifecycle: [{ ...record, id, at: Date.now() }, ...prev.blockLifecycle].slice(
          0,
          MAX_BLOCK_EVENTS,
        ),
      };
    }),

  setFocusedTurn: (matchId, turnIndex) => set({ focusedTurn: turnKey(matchId, turnIndex) }),

  setChain: (chain, source, validatorId) =>
    set({
      chain,
      chainSource: source,
      chainValidatorId: validatorId,
      // Validated in the browser, independently of whatever the node reported.
      chainValidation: chain.length > 0 ? validateChain(chain) : null,
    }),

  setMatch: (match) => set({ match }),
  setSeat: (seat) => set({ seat }),
  setStatusLine: (statusLine) => set({ statusLine }),

  resetTelemetry: () =>
    set({ arrivals: [], votesByEvent: {}, talliesByTurn: {}, blockLifecycle: [] }),
}));

// --- selectors --------------------------------------------------------------

export const selectOnlineCount = (s: ReflexState): number =>
  Object.values(s.statuses).filter((v) => v.online).length;

export const selectChainHeight = (s: ReflexState): number =>
  s.chain.length > 0 ? s.chain.length - 1 : 0;

export const selectTransactionCount = (s: ReflexState): number =>
  s.chain.reduce((n, b) => n + b.transactions.length, 0);

export const selectLatestBlock = (s: ReflexState): Block | null =>
  s.chain.length > 1 ? s.chain[s.chain.length - 1]! : null;

/**
 * Which nodes disagree with the majority about the head of the chain?
 *
 * Takes a plain map rather than the store so callers can memoise on `statuses`.
 * A selector returning a fresh array would never satisfy reference equality and
 * would re-render forever.
 */
export const forkedNodesFrom = (
  statuses: Record<string, ValidatorStatus>,
): string[] => {
  const online = Object.values(statuses).filter((v) => v.online);
  if (online.length < 2) return [];

  const tally = new Map<string, number>();
  for (const status of online) {
    tally.set(status.headHash, (tally.get(status.headHash) ?? 0) + 1);
  }

  let majorityHash = '';
  let best = 0;
  for (const [hash, count] of tally) {
    if (count > best) {
      best = count;
      majorityHash = hash;
    }
  }

  return online.filter((s) => s.headHash !== majorityHash).map((s) => s.validatorId);
};

export const selectTurnKey = turnKey;
