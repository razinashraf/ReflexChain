'use client';

/**
 * The client's link to the validator network.
 *
 * FIVE independent WebSocket connections, one per validator. A press event is
 * written to all five sockets in a single synchronous pass, so each node
 * receives it over its own path and timestamps its own arrival.
 *
 * This is the architectural centre of the whole project. If the browser posted
 * the event to one server which then fanned it out, every validator would be
 * judging one identical relayed copy and their votes would agree by
 * construction - 5/5 every time, consensus in name only.
 */
import type { PressEvent } from '@reflexchain/protocol';
import { SNAPSHOT_URL, validatorEndpoints, type ValidatorEndpoint } from './config';
import { useReflex } from './store';

interface Link {
  endpoint: ValidatorEndpoint;
  socket: WebSocket | null;
  retry: ReturnType<typeof setTimeout> | null;
  closedByUs: boolean;
}

export class ValidatorNetwork {
  private links: Link[] = [];
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;

    this.links = validatorEndpoints().map((endpoint) => ({
      endpoint,
      socket: null,
      retry: null,
      closedByUs: false,
    }));

    for (const link of this.links) this.connect(link);
  }

  stop(): void {
    this.started = false;
    for (const link of this.links) {
      link.closedByUs = true;
      if (link.retry) clearTimeout(link.retry);
      link.socket?.close();
    }
    this.links = [];
  }

  private connect(link: Link): void {
    const store = useReflex.getState();
    store.setLink(link.endpoint.validatorId, 'CONNECTING');

    let socket: WebSocket;
    try {
      socket = new WebSocket(link.endpoint.wsUrl);
    } catch {
      this.scheduleRetry(link);
      return;
    }

    link.socket = socket;

    socket.onopen = () => {
      useReflex.getState().setLink(link.endpoint.validatorId, 'OPEN');
      socket.send(JSON.stringify({ type: 'SUBSCRIBE', role: 'PLAYER' }));
    };

    socket.onmessage = (event) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      this.dispatch(msg);
    };

    socket.onclose = () => {
      useReflex.getState().setLink(link.endpoint.validatorId, 'CLOSED');
      link.socket = null;
      if (!link.closedByUs) this.scheduleRetry(link);
    };

    socket.onerror = () => {
      // onclose always follows, and that is where the retry is scheduled.
    };
  }

  private scheduleRetry(link: Link): void {
    if (link.retry) clearTimeout(link.retry);
    link.retry = setTimeout(() => {
      if (this.started) this.connect(link);
    }, 2_000);
  }

  private dispatch(msg: Record<string, unknown>): void {
    const store = useReflex.getState();

    switch (msg.type) {
      case 'TELEMETRY_STATUS':
        store.setStatus(msg.status as never);
        break;

      case 'TELEMETRY_EVENT_RECEIVED':
        store.recordArrival({
          validatorId: String(msg.validatorId),
          eventId: String(msg.eventId),
          matchId: String(msg.matchId),
          turnIndex: Number(msg.turnIndex),
          receivedAt: Number(msg.receivedAt),
        });
        break;

      case 'TELEMETRY_VOTE':
        store.recordVote(msg.vote as never);
        break;

      case 'TELEMETRY_TALLY':
        store.recordTally(String(msg.matchId), Number(msg.turnIndex), msg.tally as never);
        break;

      case 'TELEMETRY_BLOCK': {
        const block = msg.block as { index: number; hash: string };
        store.recordBlockEvent({
          validatorId: String(msg.validatorId),
          stage: msg.stage as never,
          blockIndex: block.index,
          blockHash: block.hash,
          detail: msg.detail ? String(msg.detail) : undefined,
        });
        break;
      }

      default:
        break;
    }
  }

  get openCount(): number {
    return this.links.filter((l) => l.socket?.readyState === WebSocket.OPEN).length;
  }

  /**
   * Write the signed event to every validator in one pass.
   *
   * Deliberately synchronous and un-awaited: any per-socket await would
   * serialise delivery and manufacture an ordering the network did not have.
   */
  broadcastPress(event: PressEvent): { sentTo: string[]; failed: string[] } {
    const raw = JSON.stringify({ type: 'SUBMIT_EVENT', event });
    const sentTo: string[] = [];
    const failed: string[] = [];

    for (const link of this.links) {
      if (link.socket && link.socket.readyState === WebSocket.OPEN) {
        try {
          link.socket.send(raw);
          sentTo.push(link.endpoint.validatorId);
        } catch {
          failed.push(link.endpoint.validatorId);
        }
      } else {
        failed.push(link.endpoint.validatorId);
      }
    }

    return { sentTo, failed };
  }
}

export const validatorNetwork = new ValidatorNetwork();

// --- REST helpers -----------------------------------------------------------

/**
 * Pull a chain to display. Asks each validator in turn and takes the first that
 * answers, remembering which node it came from - important during the tamper
 * demo, when different nodes genuinely hold different ledgers.
 */
export async function fetchChain(
  preferValidatorId?: string,
): Promise<{ blocks: unknown[]; validatorId: string; live: boolean } | null> {
  const endpoints = validatorEndpoints();
  const ordered = preferValidatorId
    ? [
        ...endpoints.filter((e) => e.validatorId === preferValidatorId),
        ...endpoints.filter((e) => e.validatorId !== preferValidatorId),
      ]
    : endpoints;

  for (const endpoint of ordered) {
    try {
      const res = await fetch(`${endpoint.httpUrl}/chain`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(2_500),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { blocks: unknown[] };
      return { blocks: body.blocks, validatorId: endpoint.validatorId, live: true };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * The archived ledger shipped with the hosted build.
 *
 * A dashboard with no network behind it would otherwise render empty. These
 * blocks are real - exported from a live session and verifying under the same
 * validateChain() the nodes run - they are simply not live, and the UI says so.
 */
export async function fetchSnapshot(): Promise<{
  blocks: unknown[];
  exportedAt: string;
} | null> {
  try {
    const res = await fetch(SNAPSHOT_URL, { cache: 'force-cache' });
    if (!res.ok) return null;
    const body = (await res.json()) as { blocks: unknown[]; exportedAt: string };
    return Array.isArray(body.blocks) && body.blocks.length > 0 ? body : null;
  } catch {
    return null;
  }
}

export async function postAdmin(
  validatorId: string,
  path: string,
  body: unknown = {},
): Promise<{ ok: boolean; error?: string; [key: string]: unknown }> {
  const endpoint = validatorEndpoints().find((e) => e.validatorId === validatorId);
  if (!endpoint) return { ok: false, error: `unknown validator ${validatorId}` };

  try {
    const res = await fetch(`${endpoint.httpUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    return (await res.json()) as { ok: boolean };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
