import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing with scrypt from the Node standard library.
 *
 * Why scrypt and not bcrypt/argon2: it is part of Node itself, so there is no
 * native build step on the VPS and no extra dependency to keep patched.
 *
 * Stored format is self-describing, which keeps future parameter upgrades
 * possible without a flag day:
 *   scrypt$N$r$p$<salt-base64>$<hash-base64>
 */
const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAXMEM });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), derived.toString('base64')].join(
    '$',
  );
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const N = Number.parseInt(nRaw ?? '', 10);
  const r = Number.parseInt(rRaw ?? '', 10);
  const p = Number.parseInt(pRaw ?? '', 10);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = Buffer.from(saltB64 ?? '', 'base64');
  const expected = Buffer.from(hashB64 ?? '', 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scrypt(password, salt, expected.length, { N, r, p, maxmem: MAXMEM });
  } catch {
    return false;
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Quick check used by tests and seed scripts to detect legacy/plain values. */
export function isScryptHash(value: string): boolean {
  return /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/.test(value);
}
