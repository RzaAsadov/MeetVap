export type ServerConnectionEvent = {
  at: number;
  serverUrl: string;
  source: 'api' | 'socket';
  status: 'failure' | 'success';
};

const listeners = new Set<(event: ServerConnectionEvent) => void>();

export function reportServerConnectionFailure(serverUrl: string, source: ServerConnectionEvent['source']) {
  emit({ at: Date.now(), serverUrl: normalizeServerUrl(serverUrl), source, status: 'failure' });
}

export function reportServerConnectionSuccess(serverUrl: string, source: ServerConnectionEvent['source']) {
  emit({ at: Date.now(), serverUrl: normalizeServerUrl(serverUrl), source, status: 'success' });
}

export function subscribeToServerConnectionEvents(listener: (event: ServerConnectionEvent) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: ServerConnectionEvent) {
  listeners.forEach((listener) => listener(event));
}

function normalizeServerUrl(value: string) {
  return value.trim().toLowerCase().replace(/\/+$/, '');
}
