import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config.js', () => ({
  loadConfig: () => ({ SECURITY_COUNTER_STORE: 'memory', REDIS_URL: 'redis://localhost:6379' }),
}));

import { __resetRateLimits, consumeRateLimit } from './rate-limit.js';

describe('shared rate limit counter', () => {
  beforeEach(() => __resetRateLimits());

  it('allows the configured number of requests and rejects the next one', async () => {
    expect((await consumeRateLimit('audit-export:test', 2, 3600)).allowed).toBe(true);
    expect((await consumeRateLimit('audit-export:test', 2, 3600)).allowed).toBe(true);
    const blocked = await consumeRateLimit('audit-export:test', 2, 3600);
    expect(blocked.allowed).toBe(false);
    expect(blocked.count).toBe(3);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});
