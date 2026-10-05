import { describe, expect, it } from 'vitest';

import { issueToken, verifyToken } from '../src/tokens.js';

const SECRET = 'a-test-secret-that-is-at-least-32-chars';
const NOW = new Date('2026-10-05T12:00:00Z');

describe('session tokens', () => {
  it('round-trips the user id until expiry', () => {
    const { token, expiresAt } = issueToken('user-1', SECRET, NOW, 60_000);

    expect(expiresAt).toEqual(new Date(NOW.getTime() + 60_000));
    expect(verifyToken(token, SECRET, NOW)).toBe('user-1');
    expect(verifyToken(token, SECRET, new Date(NOW.getTime() + 59_999))).toBe('user-1');
    expect(verifyToken(token, SECRET, new Date(NOW.getTime() + 60_000))).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    const { token } = issueToken('user-1', SECRET, NOW);
    expect(verifyToken(token, 'another-secret-that-is-also-32-chars-long', NOW)).toBeNull();
  });

  it('rejects a payload edited to name someone else', () => {
    const { token } = issueToken('user-1', SECRET, NOW);
    const [, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', exp: NOW.getTime() + 60_000 })).toString('base64url');

    expect(verifyToken(`${forged}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    for (const token of ['', 'abc', 'a.b.c', '.', 'e30.x']) {
      expect(verifyToken(token, SECRET, NOW)).toBeNull();
    }
  });

  it('refuses a short secret outright', () => {
    expect(() => issueToken('user-1', 'short', NOW)).toThrow(/at least 32/);
  });
});
