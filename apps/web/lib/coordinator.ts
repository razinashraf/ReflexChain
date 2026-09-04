'use client';

/**
 * Socket.IO link to the coordinator.
 *
 * The coordinator sequences the game - lobby, turn order, when the light turns
 * green. It is not consulted about who won, and nothing it says is treated as
 * evidence. Results come from the chain.
 */
import { io, type Socket } from 'socket.io-client';
import { COORDINATOR_URL } from './config';

let socket: Socket | null = null;

export function coordinatorSocket(): Socket {
  if (socket) return socket;

  socket = io(COORDINATOR_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 4_000,
    timeout: 6_000,
    autoConnect: true,
  });

  return socket;
}

export function disconnectCoordinator(): void {
  socket?.disconnect();
  socket = null;
}

/** Promise wrapper over Socket.IO acknowledgement callbacks. */
export function emitWithAck<T = unknown>(
  event: string,
  payload: unknown,
  timeoutMs = 6_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const s = coordinatorSocket();
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    s.emit(event, payload, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}
