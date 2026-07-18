import type { Socket } from 'socket.io-client';

let realtimeSocket: Socket | null = null;

export function setRealtimeSocket(socket: Socket | null) {
  realtimeSocket = socket;
}

export function getRealtimeSocket() {
  return realtimeSocket;
}
