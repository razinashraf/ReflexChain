/** REFLEXCHAIN wire + ledger types. */

// ---------------------------------------------------------------------------
// Player events
// ---------------------------------------------------------------------------

export type PressKind = 'PRESS' | 'FALSE_START';

/**
 * Created and signed in the player's browser, then broadcast to ALL validators
 * simultaneously over independent sockets. Validators never receive this
 * relayed through the coordinator - that is what makes their votes independent.
 */
export interface PressEvent {
  eventId: string;
  matchId: string;
  turnIndex: number;
  /** 0x-prefixed address derived from pubKey. */
  player: string;
  /** hex ed25519 public key. */
  pubKey: string;
  /** random hex, makes eventId unguessable and unique. */
  nonce: string;
  /** The coordinator GO sequence number this client believes it is answering. */
  goSeq: number;
  /**
   * Client-attested reaction time, measured on the client's own monotonic
   * clock (performance.now() at GO paint -> at keydown). This is the number we
   * display. Validators do not reproduce it; they bound it.
   */
  claimedReactionMs: number;
  kind: PressKind;
  /** ed25519 signature over canonicalJSON of every field above except sig. */
  sig: string;
}

/** The unsigned view of a PressEvent, i.e. exactly what sig covers. */
export type UnsignedPressEvent = Omit<PressEvent, 'sig'>;

// ---------------------------------------------------------------------------
// Validator votes
// ---------------------------------------------------------------------------

export type Verdict = 'ACCEPT' | 'REJECT';

export type ReasonCode =
  | 'SIG_OK'
  | 'ROUND_OK'
  | 'NOT_DUPLICATE'
  | 'WITHIN_HUMAN_RANGE'
  | 'WITHIN_LATENCY_ENVELOPE'
  | 'BAD_SIGNATURE'
  | 'MALFORMED'
  | 'UNKNOWN_PLAYER'
  | 'WRONG_ROUND'
  | 'DUPLICATE'
  | 'FALSE_START'
  | 'BELOW_HUMAN_FLOOR'
  | 'ABOVE_MAX_REACTION'
  | 'LATENCY_ENVELOPE_FAIL'
  | 'NO_GO_RECORD'
  | 'BYZANTINE_INVERTED';

export interface Vote {
  validatorId: string;
  eventId: string;
  matchId: string;
  turnIndex: number;
  player: string;
  verdict: Verdict;
  reasons: ReasonCode[];
  /**
   * A_i - G_i : how long after THIS node learned GO fired did the press arrive
   * at THIS node. Every validator's value differs. Null when the node had no
   * GO record at all (a false start).
   */
  observedArrivalDeltaMs: number | null;
  /** The reaction time this node considers canonical, if it accepted. */
  canonicalReactionMs: number | null;
  votedAt: number;
  sig: string;
}

export type UnsignedVote = Omit<Vote, 'sig'>;

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export type TurnOutcome = 'VALID' | 'FALSE_START' | 'REJECTED' | 'INCONCLUSIVE';

export interface TurnTransaction {
  txId: string;
  matchId: string;
  turnIndex: number;
  player: string;
  outcome: TurnOutcome;
  /** null unless outcome === VALID. */
  reactionMs: number | null;
  eventId: string;
  /** The actual signed votes, embedded so any observer can re-verify quorum. */
  votes: Vote[];
  approvals: number;
  total: number;
}

export interface ConsensusMeta {
  approvals: number;
  total: number;
  threshold: number;
}

export interface Block {
  index: number;
  timestamp: number;
  matchId: string;
  /** Exactly the two turns of a match (empty for genesis). */
  transactions: TurnTransaction[];
  /** Winning player address, or null for a draw / mutual false start. */
  winner: string | null;
  winningReactionMs: number | null;
  previousHash: string;
  merkleRoot: string;
  /** Uniqueness nonce. NOT mined - Proof of Reflex has no proof of work. */
  nonce: string;
  /** validatorId that assembled this block. */
  proposer: string;
  consensus: ConsensusMeta;
  /** Proposer ed25519 signature over hash. Excluded from the hash preimage. */
  proposerSig: string;
  /** sha256 over canonicalJSON of every field above except proposerSig and hash. */
  hash: string;
}

/** The exact preimage shape hashed to produce Block.hash. */
export type BlockHashInput = Omit<Block, 'proposerSig' | 'hash'>;

// ---------------------------------------------------------------------------
// Chain validation results
// ---------------------------------------------------------------------------

export type ChainErrorCode =
  | 'EMPTY_CHAIN'
  | 'BAD_GENESIS'
  | 'HASH_MISMATCH'
  | 'PREVIOUS_HASH_BROKEN'
  | 'INDEX_OUT_OF_ORDER'
  | 'MERKLE_MISMATCH'
  | 'QUORUM_NOT_MET'
  | 'BAD_PROPOSER_SIGNATURE'
  | 'BAD_VOTE_SIGNATURE'
  | 'WINNER_MISMATCH'
  | 'NON_MONOTONIC_TIMESTAMP';

export interface ChainError {
  index: number;
  code: ChainErrorCode;
  detail: string;
}

export interface ChainValidationResult {
  valid: boolean;
  /** Index of the first bad block; every block after it is untrustworthy. */
  firstInvalidIndex: number | null;
  errors: ChainError[];
  height: number;
  headHash: string;
}

// ---------------------------------------------------------------------------
// Consensus tally
// ---------------------------------------------------------------------------

export type TallyStatus = 'CONFIRMED' | 'REJECTED' | 'PENDING' | 'INCONCLUSIVE';

export interface TallyResult {
  status: TallyStatus;
  approvals: number;
  rejections: number;
  total: number;
  threshold: number;
  registered: number;
  /** Median of accepting validators canonicalReactionMs. */
  canonicalReactionMs: number | null;
  outcome: TurnOutcome;
  /** validatorIds whose verdict differed from the majority. */
  dissenters: string[];
}

// ---------------------------------------------------------------------------
// Match / round state machine
// ---------------------------------------------------------------------------

export type MatchPhase =
  | 'LOBBY'
  | 'MATCH_READY'
  | 'GET_READY'
  | 'RED_LIGHT'
  | 'GO'
  | 'COLLECTING'
  | 'CONSENSUS'
  | 'TURN_CONFIRMED'
  | 'BLOCK_PROPOSAL'
  | 'BLOCK_VERIFY'
  | 'FINALIZED'
  | 'ABANDONED';

export interface PlayerIdentity {
  address: string;
  pubKey: string;
  label: string;
}

export interface TurnSummary {
  turnIndex: number;
  player: string;
  outcome: TurnOutcome;
  reactionMs: number | null;
  approvals: number;
  total: number;
}

export interface MatchState {
  matchId: string;
  code: string;
  phase: MatchPhase;
  players: PlayerIdentity[];
  /** Index into players whose turn it currently is. */
  activeTurn: number;
  goSeq: number;
  turnResults: (TurnSummary | null)[];
  hotseat: boolean;
  createdAt: number;
}

/** Signed by the coordinator and raced to every validator the instant GO fires. */
export interface GoAnnounce {
  matchId: string;
  turnIndex: number;
  goSeq: number;
  player: string;
  players: PlayerIdentity[];
  issuedAt: number;
  sig: string;
}

export type UnsignedGoAnnounce = Omit<GoAnnounce, 'sig'>;

// ---------------------------------------------------------------------------
// Validator status (for the network panel)
// ---------------------------------------------------------------------------

export interface ValidatorStatus {
  validatorId: string;
  pubKey: string;
  port: number;
  online: boolean;
  byzantine: boolean;
  tampered: boolean;
  height: number;
  headHash: string;
  peersConnected: number;
  peersTotal: number;
  transactions: number;
  chainValid: boolean;
  epsilonMs: number;
  uptimeMs: number;
}
