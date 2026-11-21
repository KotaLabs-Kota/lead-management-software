import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque tokens (refresh tokens, Android device tokens) are random 256-bit
 * values. Only their SHA-256 hash is stored, so a database leak does not hand
 * an attacker working credentials.
 */
export function generateOpaqueToken(prefix = '', bytes = 32): string {
  return `${prefix}${randomBytes(bytes).toString('base64url')}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export const REFRESH_TOKEN_PREFIX = 'rtk_';
export const DEVICE_TOKEN_PREFIX = 'dvc_';
