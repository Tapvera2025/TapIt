import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What a failed sign-in reveals. Storage, sessions and the brute-force
 * counters are stubbed; the transaction that would create the session is a
 * sentinel, so reaching it means the credentials were accepted.
 */

const REACHED = new Error('reached session creation');
const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  passwordOk: false,
  calls: [] as string[],
  createSession: false,
  notify: vi.fn(),
}));

vi.mock('../repository.js', () => ({ findUserByEmail: vi.fn(async () => state.user) }));
vi.mock('../password/service.js', () => ({
  verifyIdentityPassword: vi.fn(async () => {
    state.calls.push('verify');
    return state.passwordOk;
  }),
  verifyAgainstDecoy: vi.fn(async () => {
    state.calls.push('decoy');
    return false;
  }),
}));
vi.mock('../security/brute-force.js', () => ({
  assertLoginAllowed: vi.fn(async () => undefined),
  recordLoginFailure: vi.fn(async () => ({ locked: false, accountLocked: false })),
  clearLoginFailures: vi.fn(async () => undefined),
}));
vi.mock('../geofence/service.js', () => ({ enforceGeofencedLogin: vi.fn(async () => undefined) }));
vi.mock('../sessions/service.js', () => ({
  createIdentitySession: vi.fn(async () => ({ sessionId: 'fixture-session', accessToken: 'access', refreshToken: 'refresh' })),
}));
vi.mock('../security/detection.js', () => ({
  detectSuspiciousLogin: vi.fn(async () => [
    { event: 'SUSPICIOUS_LOGIN_NEW_DEVICE', metadata: {} },
    { event: 'SUSPICIOUS_LOGIN_NEW_COUNTRY', metadata: {} },
  ]),
}));
vi.mock('../../notifications/facade.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../notifications/facade.js')>()),
  notify: state.notify,
}));
vi.mock('../../../platform/dal/db.js', () => ({
  db: { transaction: vi.fn(async (_ctx: unknown, run: (tx: { query: () => Promise<[]> }) => Promise<unknown>) => {
    if (!state.createSession) throw REACHED;
    return run({ query: async () => [] });
  }) },
}));

const { login } = await import('./login.js');
const attempt = { email: 'asha@example.com', password: 'correct horse battery', ip: '203.0.113.5', userAgent: null };

function activeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: '01a1d128-f439-7466-a160-a3401c287c90', organizationId: '01a1d128-f439-7466-a160-a3401c287c91', accountType: 'employee', email: 'asha@example.com', fullName: 'Asha',
    passwordHash: '$argon2id$...', status: 'active', organizationStatus: 'active', mustChangePassword: false,
    lockedUntil: null, sessionVersion: 1, geofenceRequired: false, ...overrides,
  };
}

describe('sign-in', () => {
  beforeEach(() => {
    state.user = null;
    state.passwordOk = false;
    state.calls = [];
    state.createSession = false;
    state.notify.mockClear();
  });

  it('spends the same password work on an unknown email, then refuses as invalid credentials', async () => {
    await expect(login(attempt)).rejects.toMatchObject({ code: 'IDENTITY_INVALID_CREDENTIALS' });
    expect(state.calls).toEqual(['decoy']);
  });

  it('does the same for a deactivated account', async () => {
    state.user = activeUser({ status: 'inactive' });
    await expect(login(attempt)).rejects.toMatchObject({ code: 'IDENTITY_INVALID_CREDENTIALS' });
    expect(state.calls).toEqual(['decoy']);
  });

  it('does not reveal a locked account to someone with the wrong password', async () => {
    state.user = activeUser({ lockedUntil: new Date(Date.now() + 10 * 60_000) });
    await expect(login(attempt)).rejects.toMatchObject({ code: 'IDENTITY_INVALID_CREDENTIALS' });
  });

  it('tells the account holder (right password) that the account is locked', async () => {
    state.user = activeUser({ lockedUntil: new Date(Date.now() + 10 * 60_000) });
    state.passwordOk = true;
    await expect(login(attempt)).rejects.toMatchObject({ code: 'IDENTITY_ACCOUNT_LOCKED' });
  });

  it('signs in with the right password', async () => {
    state.user = activeUser();
    state.passwordOk = true;
    await expect(login(attempt)).rejects.toBe(REACHED);
    expect(state.calls).toEqual(['verify']);
  });

  it('groups unusual sign-in signals into one alert for the account and one for other Super Admins', async () => {
    state.user = activeUser();
    state.passwordOk = true;
    state.createSession = true;

    await expect(login(attempt)).resolves.toMatchObject({ accessToken: 'access' });

    const alerts = state.notify.mock.calls.map((call) => call[2]);
    expect(alerts).toEqual([
      expect.objectContaining({ type: 'identity.suspicious_sign_in', audience: { users: [state.user['id']], includeActor: true } }),
      expect.objectContaining({ type: 'identity.suspicious_sign_in', audience: { superAdmins: true } }),
    ]);
  });
});
