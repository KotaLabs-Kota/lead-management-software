import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { safeEqual } from '../../utils/tokens';

const issuer = 'kotalabs-owner';
const audience = 'kotalabs-owner-panel';
const ttlSeconds = 15 * 60;

function signingKey(): Buffer {
  // The owner key is also the recovery credential; domain separation prevents
  // password sessions from being valid as ordinary CRM access tokens.
  return createHmac('sha256', env.OWNER_CONTROL_KEY!).update('owner-session-signing-v1').digest();
}
function passwordVersion(hash: string): string {
  return createHmac('sha256', signingKey()).update('owner-password-version-v1:').update(hash).digest('hex');
}
export function issueOwnerSession(hash: string): string {
  return jwt.sign({ kind: 'owner-password', version: passwordVersion(hash) }, signingKey(), {
    algorithm: 'HS256', issuer, audience, expiresIn: ttlSeconds,
  });
}
export function validOwnerSession(token: string, hash: string): boolean {
  try {
    const value = jwt.verify(token, signingKey(), { algorithms: ['HS256'], issuer, audience });
    return typeof value !== 'string' && value.kind === 'owner-password' &&
      typeof value.version === 'string' && safeEqual(value.version, passwordVersion(hash));
  } catch { return false; }
}
