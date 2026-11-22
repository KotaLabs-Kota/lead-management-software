import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import { issueOwnerSession, validOwnerSession } from '../src/modules/owner/owner-password';

describe('owner password session lifetime', () => {
  afterEach(() => { vi.useRealTimers(); env.OWNER_CONTROL_KEY = undefined; });
  it('expires after 15 minutes and is bound to the current password hash and owner key', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    env.OWNER_CONTROL_KEY = 'a'.repeat(64);
    const token = issueOwnerSession('salted-password-hash');
    expect(validOwnerSession(token, 'salted-password-hash')).toBe(true);
    expect(validOwnerSession(token, 'different-hash')).toBe(false);
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(validOwnerSession(token, 'salted-password-hash')).toBe(false);
  });
});
