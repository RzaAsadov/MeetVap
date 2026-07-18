type SecurityEvent = 'backgroundLocationDisabled' | 'erasePinCleared';
type SecurityEventHandler = () => void;

const handlersByEvent = new Map<SecurityEvent, Set<SecurityEventHandler>>();

export function addSecurityEventListener(event: SecurityEvent, handler: SecurityEventHandler) {
  const handlers = handlersByEvent.get(event) ?? new Set<SecurityEventHandler>();
  handlers.add(handler);
  handlersByEvent.set(event, handlers);

  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) {
      handlersByEvent.delete(event);
    }
  };
}

export function emitSecurityEvent(event: SecurityEvent) {
  handlersByEvent.get(event)?.forEach((handler) => {
    handler();
  });
}
