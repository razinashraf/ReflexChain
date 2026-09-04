/**
 * Wire protocol.
 *
 * Three link types, all carrying these envelopes as JSON over WebSocket:
 *   browser     -> validator   (SUBMIT_EVENT, plus SUBSCRIBE for telemetry)
 *   coordinator -> validator   (GO_ANNOUNCE, MATCH_OPEN, MATCH_CLOSE)
 *   validator  <-> validator   (VOTE, BLOCK_PROPOSAL, CHAIN_REQUEST/RESPONSE, HELLO)
 */
import type {
  Block,
  GoAnnounce,
  PlayerIdentity,
  PressEvent,
  TallyResult,
  ValidatorStatus,
  Vote,
} from './types.js';

export type ClientRole = 'PLAYER' | 'SPECTATOR';

// --- browser -> validator --------------------------------------------------

export interface SubmitEventMsg {
  type: 'SUBMIT_EVENT';
  event: PressEvent;
}

export interface SubscribeMsg {
  type: 'SUBSCRIBE';
  role: ClientRole;
}

// --- coordinator -> validator ---------------------------------------------

export interface MatchOpenMsg {
  type: 'MATCH_OPEN';
  matchId: string;
  players: PlayerIdentity[];
  issuedAt: number;
  sig: string;
}

export interface GoAnnounceMsg {
  type: 'GO_ANNOUNCE';
  announce: GoAnnounce;
}

export interface MatchCloseMsg {
  type: 'MATCH_CLOSE';
  matchId: string;
  sig: string;
}

// --- validator <-> validator ----------------------------------------------

export interface HelloMsg {
  type: 'HELLO';
  validatorId: string;
  publicKey: string;
  height: number;
  headHash: string;
}

export interface VoteMsg {
  type: 'VOTE';
  vote: Vote;
}

export interface BlockProposalMsg {
  type: 'BLOCK_PROPOSAL';
  block: Block;
}

export interface ChainRequestMsg {
  type: 'CHAIN_REQUEST';
  /** Requesting node's current height; peer replies with everything after it. */
  fromHeight: number;
  requestedBy: string;
}

export interface ChainResponseMsg {
  type: 'CHAIN_RESPONSE';
  validatorId: string;
  blocks: Block[];
  height: number;
  headHash: string;
}

// --- validator -> subscribed observers (telemetry for the UI) -------------

export interface TelemetryEventReceivedMsg {
  type: 'TELEMETRY_EVENT_RECEIVED';
  validatorId: string;
  eventId: string;
  matchId: string;
  turnIndex: number;
  receivedAt: number;
}

export interface TelemetryVoteMsg {
  type: 'TELEMETRY_VOTE';
  validatorId: string;
  vote: Vote;
}

export interface TelemetryTallyMsg {
  type: 'TELEMETRY_TALLY';
  validatorId: string;
  matchId: string;
  turnIndex: number;
  eventId: string;
  tally: TallyResult;
}

export interface TelemetryBlockMsg {
  type: 'TELEMETRY_BLOCK';
  validatorId: string;
  stage: 'PROPOSED' | 'VERIFIED' | 'APPENDED' | 'REJECTED';
  block: Block;
  detail?: string;
}

export interface TelemetryStatusMsg {
  type: 'TELEMETRY_STATUS';
  status: ValidatorStatus;
}

export interface AckMsg {
  type: 'ACK';
  ok: boolean;
  eventId?: string;
  detail?: string;
}

export type InboundMessage =
  | SubmitEventMsg
  | SubscribeMsg
  | MatchOpenMsg
  | GoAnnounceMsg
  | MatchCloseMsg
  | HelloMsg
  | VoteMsg
  | BlockProposalMsg
  | ChainRequestMsg
  | ChainResponseMsg;

export type OutboundMessage =
  | AckMsg
  | HelloMsg
  | VoteMsg
  | BlockProposalMsg
  | ChainRequestMsg
  | ChainResponseMsg
  | TelemetryEventReceivedMsg
  | TelemetryVoteMsg
  | TelemetryTallyMsg
  | TelemetryBlockMsg
  | TelemetryStatusMsg;

export type AnyMessage = InboundMessage | OutboundMessage;

export function parseMessage(raw: string): AnyMessage | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof (parsed as { type?: unknown }).type !== 'string') return null;
    return parsed as AnyMessage;
  } catch {
    return null;
  }
}
