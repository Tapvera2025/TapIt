import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ allowed: true, lookups: 0 }));

vi.mock('../../../platform/security/rate-limit.js', () => ({
  consumeRateLimit: vi.fn(async () => ({ allowed: state.allowed, count: 1, retryAfterSeconds: 60 })),
}));
vi.mock('../repository.js', () => ({
  normalizeIdentityEmail: (email: string) => email.trim().toLowerCase(),
  findUserByEmail: vi.fn(async () => {
    state.lookups += 1;
    return null;
  }),
  findUserById: vi.fn(),
}));

const { requestPasswordReset } = await import('./reset.js');

describe('password reset requests', () => {
  beforeEach(() => {
    state.allowed = true;
    state.lookups = 0;
  });

  it('looks the address up while under the hourly cap', async () => {
    await requestPasswordReset('Asha@Example.com');
    expect(state.lookups).toBe(1);
  });

  it('drops requests over the cap without touching the account', async () => {
    state.allowed = false;
    await requestPasswordReset('asha@example.com');
    expect(state.lookups).toBe(0);
  });
});

describe('the reset request endpoint', () => {
  it('answers 202 before the reset work finishes', async () => {
    let finish!: () => void;
    vi.resetModules();
    vi.doMock('../password/reset.js', () => ({
      requestPasswordReset: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })),
      resetPassword: vi.fn(),
    }));
    const { requestPasswordResetController } = await import('../security/controller.js');
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = { status, json } as unknown as Response;
    await requestPasswordResetController({ body: { email: 'asha@example.com' } } as Request, res);
    expect(status).toHaveBeenCalledWith(202);
    expect(json).toHaveBeenCalledWith({ success: true, data: { accepted: true } });
    finish();
  });
});
