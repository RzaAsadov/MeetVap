import { Socket } from 'socket.io-client';

import { MASK_SOCKET_ARGS_KEY, MASK_SOCKET_VERSION_KEY, MASK_VERSION, maskPayload } from './payloadMask';

const RESERVED_EVENTS = new Set([
  'connect',
  'connect_error',
  'disconnect',
  'disconnecting',
  'error',
  'newListener',
  'removeListener',
  'reconnect',
  'reconnect_attempt',
  'reconnect_error',
  'reconnect_failed',
]);

export function maskSocketOutgoing(socket: Socket) {
  const originalEmit = socket.emit.bind(socket);

  socket.emit = ((event: string, ...args: unknown[]) => {
    if (RESERVED_EVENTS.has(event)) {
      return originalEmit(event, ...args);
    }

    const ack = typeof args.at(-1) === 'function' ? args.pop() : undefined;
    const maskedArgs = {
      [MASK_SOCKET_ARGS_KEY]: maskPayload(args),
      [MASK_SOCKET_VERSION_KEY]: MASK_VERSION,
    };

    return ack ? originalEmit(event, maskedArgs, ack) : originalEmit(event, maskedArgs);
  }) as Socket['emit'];
}
