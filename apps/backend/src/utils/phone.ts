import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { env } from '../config/env';

/**
 * Normalise any user-entered phone number to E.164 (e.g. +919876543210).
 *
 * Handles the formats employees and lead forms actually produce:
 *   "9876543210"        -> +919876543210   (default country IN)
 *   "09876543210"       -> +919876543210
 *   "+91 98765 43210"   -> +919876543210
 *   "0091 9876543210"   -> +919876543210
 *   "(+91) 98765-43210" -> +919876543210
 *
 * Returns null when the value is not a valid phone number so the API can reject
 * it with a validation error instead of storing garbage.
 */
export function normalizePhone(
  input: string | null | undefined,
  defaultCountry: string = env.DEFAULT_COUNTRY_CODE,
): string | null {
  if (input === null || input === undefined) return null;

  const trimmed = String(input).trim();
  if (!trimmed) return null;

  // "00" is the international prefix in most of the world, "+" is the canonical one.
  let candidate = trimmed.replace(/[^\d+]/g, '');
  if (candidate.startsWith('00')) candidate = `+${candidate.slice(2)}`;
  if (!candidate.startsWith('+') && candidate.startsWith('0')) {
    candidate = `${defaultCountry === 'IN' ? '+91' : ''}${candidate.slice(1)}`;
  }

  const parsed = parsePhoneNumberFromString(candidate, defaultCountry as never);
  if (!parsed || !parsed.isValid()) return null;

  return parsed.number; // E.164
}

/**
 * Best-effort display form for exports and notifications: +91 98765 43210.
 * Falls back to the stored E.164 value.
 */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}

/** True when the string is already a normalised, valid E.164 number. */
export function isValidE164(value: string): boolean {
  const parsed = parsePhoneNumberFromString(value);
  return Boolean(parsed?.isValid());
}
