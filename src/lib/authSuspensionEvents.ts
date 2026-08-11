export type AuthSuspension = {
  code: 'ACCOUNT_BLOCKED' | 'DEVICE_BLOCKED' | 'SESSION_REVOKED';
  message?: string;
};

const listeners = new Set<(event: AuthSuspension) => void>();
let lastEventAt = 0;

export function notifyAuthSuspension(event: AuthSuspension) {
  const now = Date.now();

  if (now - lastEventAt < 1000) {
    return;
  }

  lastEventAt = now;
  listeners.forEach((listener) => listener(event));
}

export function subscribeToAuthSuspension(listener: (event: AuthSuspension) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
