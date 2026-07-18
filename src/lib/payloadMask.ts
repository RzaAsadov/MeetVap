const MASK_KEY = 'meetvap:first-api-mask:v1:2026-05';

export const MASK_HEADER = 'x-meetvap-mask';
export const MASK_VERSION = 'v1';
export const MASK_SOCKET_AUTH_KEY = 'payload';
export const MASK_SOCKET_ARGS_KEY = 'args';
export const MASK_SOCKET_VERSION_KEY = 'mask';

export function maskPayload(value: unknown) {
  const plainText = JSON.stringify(value ?? null);
  const plainBytes = utf8ToBytes(plainText);
  const keyBytes = utf8ToBytes(MASK_KEY);
  const masked = plainBytes.map((byte, index) => byte ^ keyBytes[index % keyBytes.length]);

  return bytesToBase64(masked);
}

export function unmaskPayload<T>(payload: string): T {
  const masked = base64ToBytes(payload);
  const keyBytes = utf8ToBytes(MASK_KEY);
  const plainBytes = masked.map((byte, index) => byte ^ keyBytes[index % keyBytes.length]);

  return JSON.parse(bytesToUtf8(plainBytes)) as T;
}

function utf8ToBytes(value: string) {
  const binary = unescape(encodeURIComponent(value));

  return Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToUtf8(bytes: number[]) {
  const binary = String.fromCharCode(...bytes);

  return decodeURIComponent(escape(binary));
}

function bytesToBase64(bytes: number[]) {
  const binary = String.fromCharCode(...bytes);

  if (typeof btoa === 'function') {
    return btoa(binary);
  }

  return base64Encode(binary);
}

function base64ToBytes(value: string) {
  const binary = typeof atob === 'function' ? atob(value) : base64Decode(value);

  return Array.from(binary, (char) => char.charCodeAt(0));
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function base64Encode(input: string) {
  let output = '';
  let index = 0;

  while (index < input.length) {
    const first = input.charCodeAt(index++);
    const second = input.charCodeAt(index++);
    const third = input.charCodeAt(index++);
    const enc1 = first >> 2;
    const enc2 = ((first & 3) << 4) | (second >> 4);
    const enc3 = Number.isNaN(second) ? 64 : (((second & 15) << 2) | (third >> 6));
    const enc4 = Number.isNaN(third) ? 64 : (third & 63);

    output += BASE64_ALPHABET.charAt(enc1) + BASE64_ALPHABET.charAt(enc2) + BASE64_ALPHABET.charAt(enc3) + BASE64_ALPHABET.charAt(enc4);
  }

  return output;
}

function base64Decode(input: string) {
  let output = '';
  let index = 0;
  const normalized = input.replace(/[^A-Za-z0-9+/=]/g, '');

  while (index < normalized.length) {
    const enc1 = BASE64_ALPHABET.indexOf(normalized.charAt(index++));
    const enc2 = BASE64_ALPHABET.indexOf(normalized.charAt(index++));
    const enc3 = BASE64_ALPHABET.indexOf(normalized.charAt(index++));
    const enc4 = BASE64_ALPHABET.indexOf(normalized.charAt(index++));
    const first = (enc1 << 2) | (enc2 >> 4);
    const second = ((enc2 & 15) << 4) | (enc3 >> 2);
    const third = ((enc3 & 3) << 6) | enc4;

    output += String.fromCharCode(first);

    if (enc3 !== 64) {
      output += String.fromCharCode(second);
    }

    if (enc4 !== 64) {
      output += String.fromCharCode(third);
    }
  }

  return output;
}
