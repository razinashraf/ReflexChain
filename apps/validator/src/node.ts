/**
 * ValidatorNode - all consensus behaviour for one node, with no transport code.
 *
 * Transport is injected (`onGossip` / `onTelemetry`) so the same class can be
 * driven over real WebSockets in production and booted five-at-a-time inside an
 * integration test. Everything here operates on this node's OWN observations:
 * its own GO timestamps, its own arrival timestamps, its own chain.
 */
import {
  DEFAULT_LATENCY_EPSILON_MS,
  VALIDATOR_COUNT,
  VOTE_TIMEOUT_MS,
  buildTurnTransaction,
  createBlock,
  leaderFor,
  quorumFor,
  blockAgreement,
  settleMatch,
  signObject,
  tallyVotes,
  validateChain,
  validateEvent,
  validatorKeyPair,
  validatorKeyRegistry,
  validatorSet,
  verifyBlockAgainstTip,
  verifyObject,
  verifyVoteSignature,
  COORDINATOR_PUBLIC_KEY,
  type Block,
  type GoAnnounce,
  type GoRecord,
  type KeyPair,
  type OutboundMessage,
  type PlayerIdentity,
  type PressEvent,
  type TurnTransaction,
  type UnsignedVote,
  type ValidatorStatus,
  type Vote,
} from '@reflexchain/protocol';
import { ChainStore } from './store.js';

const turnKey = (matchId: string, turnIndex: number) => `${matchId}#${turnIndex}`;

interface TurnContext {
  matchId: string;
  turnIndex: number;
  player: string;
  eventId: string;
  votes: Map<string, Vote>;
  timer: NodeJS.Timeout | null;
  /** Short hold after the result is decided, to collect late votes. */
  grace: NodeJS.Timeout | null;
  settled: boolean;
}

interface MatchRecord {
  matchId: string;
  players: PlayerIdentity[];
  turns: Map<number, TurnTransaction>;
  proposalTimer: NodeJS.Timeout | null;
  blockSealed: boolean;
}

export interface ValidatorNodeOptions {
  validatorId: string;
  ordinal: number;
  port: number;
  dataDir: string;
  registeredValidators?: number;
  epsilonMs?: number;
  /** Suppress console noise in tests. */
  quiet?: boolean;
}

export class ValidatorNode {
  readonly id: string;
  readonly ordinal: number;
  readonly port: number;
  readonly keyPair: KeyPair;
  readonly store: ChainStore;
  readonly registered: number;
  readonly threshold: number;

  /** Per-node tolerance; differing values are what make disagreement honest. */
  epsilonMs: number;

  /** Admin-toggled demo states. */
  byzantine = false;
  offline = false;
  tampered = false;
  /** Set by /admin/restore to permit one repair of a deliberately tampered chain. */
  repairRequested = false;

  private readonly startedAt = Date.now();
  private readonly quiet: boolean;
  private readonly keyRegistry: Map<string, string>;

  private readonly goRecords = new Map<string, GoRecord>();
  private readonly seenEventIds = new Set<string>();
  private readonly turns = new Map<string, TurnContext>();
  private readonly matches = new Map<string, MatchRecord>();

  /** Injected transport. Replaced by index.ts once the mesh is up. */
  onGossip: (msg: OutboundMessage) => void = () => {};
  onTelemetry: (msg: OutboundMessage) => void = () => {};
  peerCount: () => number = () => 0;

  constructor(options: ValidatorNodeOptions) {
    this.id = options.validatorId;
    this.ordinal = options.ordinal;
    this.port = options.port;
    this.registered = options.registeredValidators ?? VALIDATOR_COUNT;
    this.threshold = quorumFor(this.registered);
    this.epsilonMs = options.epsilonMs ?? DEFAULT_LATENCY_EPSILON_MS;
    this.quiet = options.quiet ?? false;
    this.keyPair = validatorKeyPair(this.id);
    this.keyRegistry = validatorKeyRegistry(this.registered);
    this.store = new ChainStore(this.id, options.dataDir);
  }

  private log(...args: unknown[]): void {
    if (!this.quiet) console.log(`[${this.id}]`, ...args);
  }

  // -------------------------------------------------------------------------
  // Coordinator messages
  // -------------------------------------------------------------------------

  /** Register a match. Signed by the coordinator so a stranger cannot open one. */
  handleMatchOpen(msg: {
    matchId: string;
    players: PlayerIdentity[];
    issuedAt: number;
    sig: string;
  }): boolean {
    const payload = { matchId: msg.matchId, players: msg.players, issuedAt: msg.issuedAt };
    if (!verifyObject(payload, msg.sig, COORDINATOR_PUBLIC_KEY)) {
      this.log('rejected MATCH_OPEN with bad coordinator signature');
      return false;
    }

    this.matches.set(msg.matchId, {
      matchId: msg.matchId,
      players: msg.players,
      turns: new Map(),
      proposalTimer: null,
      blockSealed: false,
    });
    this.log(`match ${msg.matchId} opened with ${msg.players.length} players`);
    return true;
  }

  /**
   * Record G_i - this node's own local reading of when GO fired. Every node
   * stamps its own clock here; nobody inherits the coordinator's timestamp.
   */
  handleGoAnnounce(announce: GoAnnounce): boolean {
    if (this.offline) return false;

    const { sig, ...payload } = announce;
    if (!verifyObject(payload, sig, COORDINATOR_PUBLIC_KEY)) {
      this.log('rejected GO_ANNOUNCE with bad coordinator signature');
      return false;
    }

    const localGoAt = Date.now();
    this.goRecords.set(turnKey(announce.matchId, announce.turnIndex), {
      matchId: announce.matchId,
      turnIndex: announce.turnIndex,
      goSeq: announce.goSeq,
      player: announce.player,
      localGoAt,
      players: announce.players.map((p) => p.address),
    });

    if (!this.matches.has(announce.matchId)) {
      this.matches.set(announce.matchId, {
        matchId: announce.matchId,
        players: announce.players,
        turns: new Map(),
        proposalTimer: null,
        blockSealed: false,
      });
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Player events
  // -------------------------------------------------------------------------

  /**
   * A press event arrived DIRECTLY from the player's browser on this node's own
   * socket. The arrival timestamp taken here is private to this node and is the
   * reason its vote can legitimately differ from its peers'.
   */
  handlePressEvent(event: PressEvent): { accepted: boolean; detail: string } {
    if (this.offline) return { accepted: false, detail: 'node offline' };

    const arrivedAt = Date.now();
    const key = turnKey(event.matchId, event.turnIndex);

    this.onTelemetry({
      type: 'TELEMETRY_EVENT_RECEIVED',
      validatorId: this.id,
      eventId: event.eventId,
      matchId: event.matchId,
      turnIndex: event.turnIndex,
      receivedAt: arrivedAt,
    });

    const outcome = validateEvent(event, {
      validatorId: this.id,
      arrivedAt,
      goRecord: this.goRecords.get(key) ?? null,
      seenEventIds: this.seenEventIds,
      epsilonMs: this.epsilonMs,
    });

    this.seenEventIds.add(event.eventId);

    let verdict = outcome.verdict;
    let reasons = outcome.reasons;
    let canonicalReactionMs = outcome.canonicalReactionMs;

    // A Byzantine node runs the same validation and then lies about the result.
    if (this.byzantine) {
      verdict = verdict === 'ACCEPT' ? 'REJECT' : 'ACCEPT';
      reasons = ['BYZANTINE_INVERTED'];
      canonicalReactionMs = verdict === 'ACCEPT' ? 1 : null;
    }

    const vote = this.signVote({
      validatorId: this.id,
      eventId: event.eventId,
      matchId: event.matchId,
      turnIndex: event.turnIndex,
      player: event.player,
      verdict,
      reasons,
      observedArrivalDeltaMs: outcome.observedArrivalDeltaMs,
      canonicalReactionMs,
      votedAt: arrivedAt,
    });

    this.recordVote(vote, event.eventId);
    this.onGossip({ type: 'VOTE', vote });
    this.onTelemetry({ type: 'TELEMETRY_VOTE', validatorId: this.id, vote });

    return { accepted: verdict === 'ACCEPT', detail: reasons.join(',') };
  }

  private signVote(unsigned: UnsignedVote): Vote {
    return { ...unsigned, sig: signObject(unsigned, this.keyPair.privateKey) };
  }

  // -------------------------------------------------------------------------
  // Peer votes
  // -------------------------------------------------------------------------

  handlePeerVote(vote: Vote): boolean {
    if (this.offline) return false;

    const publicKey = this.keyRegistry.get(vote.validatorId);
    if (!publicKey || !verifyVoteSignature(vote, publicKey)) {
      this.log(`discarded unauthenticated vote claiming to be ${vote.validatorId}`);
      return false;
    }

    this.recordVote(vote, vote.eventId);
    this.onTelemetry({ type: 'TELEMETRY_VOTE', validatorId: vote.validatorId, vote });
    return true;
  }

  private recordVote(vote: Vote, eventId: string): void {
    const key = turnKey(vote.matchId, vote.turnIndex);
    let ctx = this.turns.get(key);

    if (!ctx) {
      ctx = {
        matchId: vote.matchId,
        turnIndex: vote.turnIndex,
        player: vote.player,
        eventId,
        votes: new Map(),
        timer: null,
        grace: null,
        settled: false,
      };
      this.turns.set(key, ctx);

      // Close the collection window even if peers go quiet, so a turn can never
      // hang the match forever.
      ctx.timer = setTimeout(() => this.evaluateTurn(key, true), VOTE_TIMEOUT_MS);
      if (typeof ctx.timer.unref === 'function') ctx.timer.unref();
    }

    if (!ctx.votes.has(vote.validatorId)) ctx.votes.set(vote.validatorId, vote);
    this.evaluateTurn(key, false);
  }

  /** Tally what this node has and settle the turn once the result is decided. */
  private evaluateTurn(key: string, windowClosed: boolean): void {
    const ctx = this.turns.get(key);
    if (!ctx || ctx.settled) return;

    const tally = tallyVotes([...ctx.votes.values()], {
      registeredValidators: this.registered,
      windowClosed,
    });

    this.onTelemetry({
      type: 'TELEMETRY_TALLY',
      validatorId: this.id,
      matchId: ctx.matchId,
      turnIndex: ctx.turnIndex,
      eventId: ctx.eventId,
      tally,
    });

    if (tally.status === 'PENDING') return;

    // The result is decided, but stragglers may still be in flight. Settling
    // the instant the threshold is crossed would drop the fifth node's vote
    // from the permanent record and make every block read 4/5 forever, which
    // understates what the network actually agreed. Hold briefly for the rest.
    const everyoneVoted = ctx.votes.size >= this.registered;
    if (!windowClosed && !everyoneVoted && !ctx.grace) {
      ctx.grace = setTimeout(() => this.evaluateTurn(key, true), 250);
      ctx.grace.unref?.();
      return;
    }

    ctx.settled = true;
    if (ctx.timer) clearTimeout(ctx.timer);
    if (ctx.grace) clearTimeout(ctx.grace);

    const tx = buildTurnTransaction({
      matchId: ctx.matchId,
      turnIndex: ctx.turnIndex,
      player: ctx.player,
      eventId: ctx.eventId,
      votes: [...ctx.votes.values()],
      tally,
    });

    this.log(
      `turn ${ctx.turnIndex} of ${ctx.matchId}: ${tally.status} ` +
        `${tally.approvals}/${this.registered} -> ${tx.outcome} ${tx.reactionMs ?? '-'}ms`,
    );

    const match = this.matches.get(ctx.matchId);
    if (!match) return;
    match.turns.set(ctx.turnIndex, tx);

    if (match.turns.size >= match.players.length) this.scheduleProposal(match);
  }

  // -------------------------------------------------------------------------
  // Block production
  // -------------------------------------------------------------------------

  /**
   * Every node schedules a proposal, staggered by its distance from the
   * designated leader. The leader fires first; if it is offline or Byzantine
   * and no block arrives, the next node in the rotation takes over. Real leader
   * failover, and the reason killing the leader does not stall the network.
   */
  private scheduleProposal(match: MatchRecord): void {
    if (match.blockSealed || match.proposalTimer) return;

    const leader = leaderFor(match.matchId, this.registered);
    const order = validatorSet(this.registered).map((v) => v.validatorId);
    const leaderIndex = order.indexOf(leader);
    const rotated = [...order.slice(leaderIndex), ...order.slice(0, leaderIndex)];
    const myPosition = rotated.indexOf(this.id);
    const delay = myPosition * 1_800;

    match.proposalTimer = setTimeout(() => {
      match.proposalTimer = null;
      this.proposeBlock(match);
    }, delay);
    if (typeof match.proposalTimer.unref === 'function') match.proposalTimer.unref();
  }

  private proposeBlock(match: MatchRecord): void {
    if (match.blockSealed || this.offline) return;

    const transactions = [...match.turns.values()].sort((a, b) => a.turnIndex - b.turnIndex);
    const settlement = settleMatch(transactions);

    let winner = settlement.winner;
    let winningReactionMs = settlement.winningReactionMs;

    // A Byzantine proposer publishes a block naming the wrong winner. Its peers
    // re-derive the settlement from the transactions and refuse it.
    if (this.byzantine) {
      const loser = transactions.find((tx) => tx.player !== settlement.winner);
      if (loser) {
        winner = loser.player;
        winningReactionMs = loser.reactionMs;
      }
    }

    // How many nodes agreed with the weakest turn's recorded outcome. For a
    // clean turn that is the accept count; for a false start it is the reject
    // count, because a false start is something the network agrees ABOUT rather
    // than something it approves.
    const approvals = blockAgreement(transactions);

    const block = createBlock({
      index: this.store.height + 1,
      previousHash: this.store.head.hash,
      matchId: match.matchId,
      transactions,
      winner,
      winningReactionMs,
      proposer: this.id,
      consensus: { approvals, total: this.registered, threshold: this.threshold },
      privateKey: this.keyPair.privateKey,
    });

    this.log(`proposing block #${block.index} winner=${winner ?? 'none'}`);
    this.onTelemetry({
      type: 'TELEMETRY_BLOCK',
      validatorId: this.id,
      stage: 'PROPOSED',
      block,
    });

    // The proposer runs the same acceptance path as everyone else rather than
    // trusting its own block, so a Byzantine node rejects its own forgery too.
    this.handleBlockProposal(block);
    this.onGossip({ type: 'BLOCK_PROPOSAL', block });
  }

  /**
   * Deterministic winner between two blocks competing for the same index.
   *
   * Every node applies this identical rule to the identical pair, so they all
   * converge on the same choice without another round of messaging. The
   * designated leader's block wins; failing that, the lower hash does.
   */
  private preferredSibling(mine: Block, theirs: Block): Block {
    if (mine.matchId === theirs.matchId) {
      const leader = leaderFor(mine.matchId, this.registered);
      const mineIsLeader = mine.proposer === leader;
      const theirsIsLeader = theirs.proposer === leader;
      if (mineIsLeader !== theirsIsLeader) return mineIsLeader ? mine : theirs;
    }
    return mine.hash < theirs.hash ? mine : theirs;
  }

  /**
   * A competing block arrived for the index this node has already filled.
   * Both may be perfectly valid - two validators simply proposed at once.
   */
  private resolveSibling(block: Block): boolean {
    const mine = this.store.head;
    if (mine.previousHash !== block.previousHash) return false; // not a sibling

    const parent = this.store.chain[this.store.height - 1];
    if (!parent) return false;

    const errors = verifyBlockAgainstTip(block, parent, {
      registeredValidators: this.registered,
      keyRegistry: this.keyRegistry,
    });
    if (errors.length > 0) return false;

    if (this.preferredSibling(mine, block).hash === mine.hash) {
      this.log(`kept own block #${mine.index}, discarded sibling from ${block.proposer}`);
      return false;
    }

    this.log(
      `REORG #${block.index}: replacing own block with ${block.proposer}'s ` +
        `(${mine.hash.slice(0, 10)} -> ${block.hash.slice(0, 10)})`,
    );
    this.store.replaceHead(block);
    this.requeueOrphanedMatches();
    this.onTelemetry({
      type: 'TELEMETRY_BLOCK',
      validatorId: this.id,
      stage: 'APPENDED',
      block,
      detail: 'reorg: adopted competing block',
    });
    this.onTelemetry({ type: 'TELEMETRY_STATUS', status: this.status() });
    return true;
  }

  /** Independently verify a proposed block before appending it. */
  handleBlockProposal(block: Block): boolean {
    if (this.offline) return false;
    if (this.store.hasBlock(block.hash)) return true; // already have it

    // Same index as our tip: a simultaneous proposal, not an invalid block.
    if (block.index === this.store.height) return this.resolveSibling(block);

    const errors = verifyBlockAgainstTip(block, this.store.head, {
      registeredValidators: this.registered,
      keyRegistry: this.keyRegistry,
    });

    if (errors.length > 0) {
      const detail = errors.map((e) => `${e.code}: ${e.detail}`).join(' | ');
      this.log(`REJECTED block #${block.index} -> ${detail}`);
      this.onTelemetry({
        type: 'TELEMETRY_BLOCK',
        validatorId: this.id,
        stage: 'REJECTED',
        block,
        detail,
      });
      return false;
    }

    this.store.append(block);

    const match = this.matches.get(block.matchId);
    if (match) {
      match.blockSealed = true;
      if (match.proposalTimer) {
        clearTimeout(match.proposalTimer);
        match.proposalTimer = null;
      }
    }

    this.log(`APPENDED block #${block.index} (height ${this.store.height})`);
    this.onTelemetry({
      type: 'TELEMETRY_BLOCK',
      validatorId: this.id,
      stage: 'APPENDED',
      block,
    });
    this.onTelemetry({ type: 'TELEMETRY_STATUS', status: this.status() });
    return true;
  }

  // -------------------------------------------------------------------------
  // Synchronisation
  // -------------------------------------------------------------------------

  /**
   * Adopt a peer's chain if it is strictly longer AND fully valid. Length alone
   * is never enough - a tampered node offering a long broken chain is refused.
   */
  adoptChain(candidate: Block[], force = false): boolean {
    // A node whose ledger was deliberately rewritten holds that state until a
    // repair is explicitly requested. Ordinary divergence still self-heals via
    // this same path - but auto-repairing a tampered chain within one sync tick
    // would make the compromised state impossible to actually look at.
    if (this.tampered && !force) return false;

    const localValid = this.store.validate().valid;

    // Longest-valid-chain, with two additions:
    //  - a node whose own chain has been corrupted defers to a valid chain of
    //    EQUAL length, because tampering rewrites history in place rather than
    //    lengthening it, and without this a tampered node could never repair;
    //  - two healthy nodes that ended up on equal-length forks settle it with
    //    the same deterministic tie-break used for competing proposals.
    if (candidate.length < this.store.chain.length) return false;

    if (candidate.length === this.store.chain.length) {
      const theirHead = candidate[candidate.length - 1];
      const myHead = this.store.head;
      if (!theirHead || theirHead.hash === myHead.hash) return false;

      if (localValid) {
        const keepMine =
          theirHead.previousHash !== myHead.previousHash ||
          this.preferredSibling(myHead, theirHead).hash === myHead.hash;
        if (keepMine) return false;
      }
    }

    const result = validateChain(candidate, {
      registeredValidators: this.registered,
      keyRegistry: this.keyRegistry,
    });

    if (!result.valid) {
      this.log(`refused peer chain: invalid at block #${result.firstInvalidIndex}`);
      return false;
    }

    this.store.replace(candidate);
    this.tampered = false;
    this.requeueOrphanedMatches();
    this.log(`synchronised to height ${this.store.height}`);
    this.onTelemetry({ type: 'TELEMETRY_STATUS', status: this.status() });
    return true;
  }

  /**
   * Re-propose any settled match whose block lost a fork.
   *
   * When a competing block wins the slot, the losing block's match is not
   * merely reordered - it is gone, and with it a result the network already
   * agreed on. Anything fully settled but absent from the chain goes back in
   * the queue to be proposed again at the new tip.
   */
  private requeueOrphanedMatches(): void {
    const onChain = new Set(this.store.chain.map((b) => b.matchId));

    for (const match of this.matches.values()) {
      if (onChain.has(match.matchId)) continue;
      if (match.turns.size < match.players.length) continue; // still in play

      if (match.blockSealed) {
        this.log(`match ${match.matchId} orphaned by reorg - requeueing`);
        match.blockSealed = false;
      }
      if (match.proposalTimer) {
        clearTimeout(match.proposalTimer);
        match.proposalTimer = null;
      }
      this.scheduleProposal(match);
    }
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  status(): ValidatorStatus {
    const validation = this.store.validate();
    return {
      validatorId: this.id,
      pubKey: this.keyPair.publicKey,
      port: this.port,
      online: !this.offline,
      byzantine: this.byzantine,
      tampered: this.tampered,
      height: this.store.height,
      headHash: this.store.head.hash,
      peersConnected: this.peerCount(),
      peersTotal: this.registered - 1,
      transactions: this.store.transactionCount,
      chainValid: validation.valid,
      epsilonMs: this.epsilonMs,
      uptimeMs: Date.now() - this.startedAt,
    };
  }
}
