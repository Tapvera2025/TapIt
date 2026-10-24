import { describe, expect, it } from 'vitest';
import { publishFailure } from './jobs.js';
import { ProviderError } from './providers/types.js';
import { validateMediaBytes } from './media.js';

describe('publishing reliability', () => {
  const now = new Date('2026-10-14T00:00:00Z');
  it('honors retry-after, bounded exponential backoff and a maximum of five attempts', () => {
    const error = new ProviderError('RATE_LIMIT', 'Wait', {
      transient: true,
      retryAfter: 90,
    });
    expect(publishFailure(error, 1, now, true).nextAttemptAt?.getTime()).toBe(
      now.getTime() + 90_000,
    );
    expect(publishFailure(error, 4, now, true).nextAttemptAt?.getTime()).toBe(
      now.getTime() + 240_000,
    );
    expect(publishFailure(error, 5, now, true).status).toBe('failed');
  });
  it('does not retry ambiguous outcomes, including unknown exceptions after publishing began', () => {
    expect(
      publishFailure(
        new ProviderError('UNKNOWN', 'Check platform', {
          ambiguous: true,
          transient: true,
        }),
        1,
        now,
        true,
      ).status,
    ).toBe('outcome_unknown');
    expect(publishFailure(new Error('a secret raw response'), 1, now, true).status).toBe(
      'outcome_unknown',
    );
    expect(
      publishFailure(new Error('a secret raw response'), 1, now, true).error,
    ).not.toContain('secret');
    expect(publishFailure(new Error('storage unavailable'), 1, now, false).status).toBe(
      'scheduled',
    );
  });
  it('does not retry rejected or revoked credentials as transient creates', () => {
    expect(
      publishFailure(
        new ProviderError('REVOKED', 'Reconnect', { reconnectRequired: true }),
        1,
        now,
        true,
      ).status,
    ).toBe('failed');
    expect(
      publishFailure(new ProviderError('INVALID', 'Fix content'), 1, now, true).status,
    ).toBe('failed');
  });
});
describe('upload byte validation', () => {
  it('rejects spoofed extensions and MIME types, empty files, malformed MP4 headers and oversize images', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
      expect(() => validateMediaBytes(Buffer.from('<script>'), mime)).toThrow(
        /File content/,
      );
    expect(() => validateMediaBytes(Buffer.alloc(0), 'image/jpeg')).toThrow(/between/);
    expect(() =>
      validateMediaBytes(Buffer.alloc(8 * 1024 * 1024 + 1), 'image/jpeg'),
    ).toThrow(/between/);
  });
});
