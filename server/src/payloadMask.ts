const MASK_KEY = 'meetvap:first-api-mask:v1:2026-05';

export const MASK_HEADER = 'x-meetvap-mask';
export const MASK_VERSION = 'v1';
export const MASK_SOCKET_AUTH_KEY = 'payload';
export const MASK_SOCKET_ARGS_KEY = 'args';
export const MASK_SOCKET_VERSION_KEY = 'mask';

export function maskPayload(value: unknown) {
  const plain = Buffer.from(JSON.stringify(value ?? null), 'utf8');
  const key = Buffer.from(MASK_KEY, 'utf8');
  const masked = Buffer.alloc(plain.length);

  for (let index = 0; index < plain.length; index += 1) {
    masked[index] = plain[index] ^ key[index % key.length];
  }

  return masked.toString('base64');
}

export function unmaskPayload<T>(payload: string): T {
  const masked = Buffer.from(payload, 'base64');
  const key = Buffer.from(MASK_KEY, 'utf8');
  const plain = Buffer.alloc(masked.length);

  for (let index = 0; index < masked.length; index += 1) {
    plain[index] = masked[index] ^ key[index % key.length];
  }

  return JSON.parse(plain.toString('utf8')) as T;
}
