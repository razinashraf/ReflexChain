/**
 * The coordinator's link to the validator network.
 *
 * Two things only travel this way: MATCH_OPEN (who is registered to play) and
 * GO_ANNOUNCE (the signal fired, here is the sequence number). Both are signed
 * with the coordinator key so a validator will not accept a round opened by a
 * stranger.
 *
 * Press events do NOT travel this way. They go straight from the browser to
 * every validator. If they were relayed through here, all five nodes would see
 * one identical copy of one server's observation and their "independent" votes
 * would be a rubber stamp.
 */
import { WebSocket } from 'ws';
import {
  coordinatorKeyPair,
  signObject,
  validatorSet,
  VALIDATOR_COUNT,
  type PlayerIdentity,
  type UnsignedGoAnnounce,
} from '@reflexchain/protocol';

const keyPair = coordinatorKeyPair();

export class ValidatorLink {
  private readonly sockets = new Map<string, WebSocket>();
  private readonly targets = validatorSet(VALIDATOR_COUNT);
  private readonly dialling = new Set<string>();

  start(): void {
    this.dial();
    const timer = setInterval(() => this.dial(), 2_500);
    timer.unref();
  }

  private dial(): void {
    for (const target of this.targets) {
      if (this.sockets.has(target.validatorId) || this.dialling.has(target.validatorId)) {
        continue;
      }

      this.dialling.add(target.validatorId);
      const socket = new WebSocket(target.wsUrl);

      socket.on('open', () => {
        this.dialling.delete(target.validatorId);
        this.sockets.set(target.validatorId, socket);
        console.log(`[coordinator] linked to ${target.validatorId}`);
      });
      socket.on('error', () => this.dialling.delete(target.validatorId));
      socket.on('close', () => {
        this.dialling.delete(target.validatorId);
        this.sockets.delete(target.validatorId);
      });
    }
  }

  get connectedCount(): number {
    return this.sockets.size;
  }

  get connectedIds(): string[] {
    return [...this.sockets.keys()].sort();
  }

  /**
   * Send to every validator in one pass. Each node stamps its own arrival time,
   * so their GO records differ by real transit jitter rather than by fiat.
   */
  private broadcast(payload: unknown): void {
    const raw = JSON.stringify(payload);
    for (const socket of this.sockets.values()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(raw);
    }
  }

  openMatch(matchId: string, players: PlayerIdentity[]): void {
    const payload = { matchId, players, issuedAt: Date.now() };
    this.broadcast({
      type: 'MATCH_OPEN',
      ...payload,
      sig: signObject(payload, keyPair.privateKey),
    });
  }

  announceGo(
    matchId: string,
    turnIndex: number,
    goSeq: number,
    player: string,
    players: PlayerIdentity[],
  ): void {
    const payload: UnsignedGoAnnounce = {
      matchId,
      turnIndex,
      goSeq,
      player,
      players,
      issuedAt: Date.now(),
    };
    this.broadcast({
      type: 'GO_ANNOUNCE',
      announce: { ...payload, sig: signObject(payload, keyPair.privateKey) },
    });
  }

  closeMatch(matchId: string): void {
    this.broadcast({
      type: 'MATCH_CLOSE',
      matchId,
      sig: signObject({ matchId }, keyPair.privateKey),
    });
  }
}
