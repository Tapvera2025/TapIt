import { describe, expect, it } from 'vitest';
import { generateRawToken, hashToken, redactToken, resolveExpiry } from './token.js';

describe('generateRawToken', () => {
  it('produces a base64url string of ~43 characters (32 bytes)', () => {
    const token = generateRawToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(42);
    expect(token.length).toBeLessThanOrEqual(44);
  });

  it('produces different tokens on successive calls', () => {
    const a = generateRawToken();
    const b = generateRawToken();
    expect(a).not.toBe(b);
  });
});

describe('hashToken', () => {
  it('returns a 64-char hex digest', () => {
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const token = generateRawToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('differs for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('resolveExpiry', () => {
  const NOW = new Date('2026-10-10T00:00:00Z');
  const DAY = 24 * 60 * 60 * 1000;

  it('caps at 30 days when validity_at is null', () => {
    const expiry = resolveExpiry(null, NOW);
    expect(expiry.getTime() - NOW.getTime()).toBe(30 * DAY);
  });

  it('respects a shorter validity_at', () => {
    const validity = new Date(NOW.getTime() + 7 * DAY);
    const expiry = resolveExpiry(validity, NOW);
    expect(expiry.getTime()).toBe(validity.getTime());
  });

  it('caps at 30 days when validity_at is further than 30d away', () => {
    const validity = new Date(NOW.getTime() + 60 * DAY);
    const expiry = resolveExpiry(validity, NOW);
    expect(expiry.getTime() - NOW.getTime()).toBe(30 * DAY);
  });
});

describe('redactToken', () => {
  it('never returns the raw token in the redacted form', () => {
    const raw = generateRawToken();
    const redacted = redactToken(raw);
    expect(redacted.includes(raw)).toBe(false);
    expect(redacted).toMatch(/^tok:sha256:[0-9a-f]{12}$/);
  });

  it('handles the empty case', () => {
    expect(redactToken('')).toBe('<empty>');
  });
});
