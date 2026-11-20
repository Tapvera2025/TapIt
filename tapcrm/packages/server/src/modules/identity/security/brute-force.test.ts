import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../config.js', () => ({
  loadConfig: () => ({ SECURITY_COUNTER_STORE: 'memory', REDIS_URL: 'redis://unused:6379' }),
}));

// A fresh module (and so a fresh in-memory counter) for every test.
async function load() {
  vi.resetModules();
  return import('./brute-force.js');
}

/** assertLoginAllowed delays a retry after failures; fake timers let the tests skip the wait. */
async function allowed(mod: Awaited<ReturnType<typeof load>>, email: string, ip: string | null): Promise<boolean> {
  const attempt = mod.assertLoginAllowed(email, ip).then(() => true, (error: unknown) => {
    if ((error as { code?: string }).code === 'IDENTITY_ACCOUNT_LOCKED') return false;
    throw error;
  });
  await vi.runAllTimersAsync();
  return attempt;
}

describe('sign-in lockout limits', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('locks one account after 5 failures, wherever they came from', async () => {
    const mod = await load();
    for (let i = 0; i < mod.MAX_ACCOUNT_FAILURES; i += 1) await mod.recordLoginFailure('victim@example.com', `203.0.113.${i + 1}`);
    expect(await allowed(mod, 'victim@example.com', '198.51.100.9')).toBe(false);
    // ...but a different person from an address that has barely failed is not affected.
    expect(await allowed(mod, 'someone.else@example.com', '198.51.100.9')).toBe(true);
  });

  it('reports the account as locked on the 5th failure, not before', async () => {
    const mod = await load();
    let result = { locked: false, accountLocked: false };
    for (let i = 1; i <= 5; i += 1) {
      result = await mod.recordLoginFailure('a@example.com', `203.0.113.${i}`);
      expect(result.accountLocked).toBe(i === 5);
    }
  });

  it('does NOT lock a shared address because 5 different people mistyped', async () => {
    const mod = await load();
    for (let i = 0; i < 20; i += 1) await mod.recordLoginFailure(`person${i}@example.com`, '203.0.113.50');
    // 20 failures from one address, spread over 20 accounts: still allowed in.
    expect(await allowed(mod, 'fresh.person@example.com', '203.0.113.50')).toBe(true);
  });

  it('does lock an address that keeps failing across many accounts (a guessing script)', async () => {
    const mod = await load();
    for (let i = 0; i < mod.MAX_SOURCE_FAILURES; i += 1) await mod.recordLoginFailure(`target${i}@example.com`, '203.0.113.60');
    expect(await allowed(mod, 'anyone@example.com', '203.0.113.60')).toBe(false);
    expect(await allowed(mod, 'anyone@example.com', '203.0.113.61')).toBe(true);
  });

  it('a successful sign-in clears the counters', async () => {
    const mod = await load();
    for (let i = 0; i < 4; i += 1) await mod.recordLoginFailure('careful@example.com', '203.0.113.70');
    await mod.clearLoginFailures('careful@example.com', '203.0.113.70');
    for (let i = 0; i < 4; i += 1) await mod.recordLoginFailure('careful@example.com', '203.0.113.70');
    expect(await allowed(mod, 'careful@example.com', '203.0.113.70')).toBe(true);
  });
});
