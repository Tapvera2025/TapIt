import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { devInstantPasswordResetController } from '../security/controller.js';
import { devInstantPasswordReset, generateDevPassword } from './dev-reset.js';
import type * as DevReset from './dev-reset.js';
import type * as LocalRequest from './local-request.js';

// The controller's own decision, as when the API runs on the computer.
vi.mock('./local-request.js', async (importOriginal) => ({
  ...await importOriginal<typeof LocalRequest>(),
  runningInContainer: () => false,
}));

vi.mock('./dev-reset.js', async (importOriginal) => {
  const actual = await importOriginal<typeof DevReset>();
  return {
    ...actual,
    devInstantPasswordReset: vi.fn((email: string) => Promise.resolve({ email, password: 'Dev-AbCd-EfGh-JkMn' })),
  };
});

function call(remoteAddress: string, headers: Record<string, string> = {}) {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const set = vi.fn();
  const request = { socket: { remoteAddress }, headers, body: { email: 'admin@tapdemo.test' }, ip: '127.0.0.1' };
  return {
    json,
    status,
    set,
    done: devInstantPasswordResetController(request as unknown as Request, { status, set } as unknown as Response),
  };
}

describe('development instant password reset', () => {
  afterEach(() => vi.clearAllMocks());

  it('generates readable passwords that meet the length policy and do not repeat', () => {
    const passwords = new Set(Array.from({ length: 200 }, () => generateDevPassword()));
    expect(passwords.size).toBe(200);
    for (const password of passwords) {
      expect(password).toMatch(/^Dev-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/);
      expect(password.length).toBeGreaterThanOrEqual(12);
    }
  });

  it.each([
    ['another computer', '192.168.1.40', {}],
    ['a proxy that reports another computer', '127.0.0.1', { 'x-forwarded-for': '127.0.0.1, 192.168.1.40' }],
    ['a page opened from another device through the dev server', '127.0.0.1', { origin: 'http://192.168.1.10:5173' }],
    ['an opaque origin', '::1', { origin: 'null' }],
  ])('refuses %s', async (_label, remoteAddress, headers) => {
    const response = call(remoteAddress, headers);
    await response.done;
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'IDENTITY_DEV_RESET_LOCAL_ONLY' }));
    expect(devInstantPasswordReset).not.toHaveBeenCalled();
  });

  it.each([
    ['the Vite dev server on this machine', '127.0.0.1', { origin: 'http://localhost:5173' }],
    ['a direct request on this machine', '::ffff:127.0.0.1', {}],
    ['an IPv6 localhost page', '::1', { origin: 'http://[::1]:5173' }],
  ])('answers %s without caching the password', async (_label, remoteAddress, headers) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = call(remoteAddress, headers);
    await response.done;
    expect(devInstantPasswordReset).toHaveBeenCalledWith('admin@tapdemo.test', '127.0.0.1');
    expect(response.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ success: true, data: { email: 'admin@tapdemo.test', password: 'Dev-AbCd-EfGh-JkMn' } });
    // The log line names the account, never the password.
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('Dev-AbCd-EfGh-JkMn');
  });
});
