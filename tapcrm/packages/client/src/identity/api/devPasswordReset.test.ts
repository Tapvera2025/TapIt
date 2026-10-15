import { afterEach, describe, expect, it, vi } from 'vitest';
import { devInstantPasswordReset, IdentityApiError } from './authApi.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('development instant password reset (client)', () => {
  it('returns the new password for a company admin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { success: true, data: { email: 'admin@tapdemo.test', password: 'Dev-AbCd-EfGh-JkMn' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(devInstantPasswordReset('Admin@TapDemo.test')).resolves.toEqual({ email: 'admin@tapdemo.test', password: 'Dev-AbCd-EfGh-JkMn' });
    expect(fetchMock).toHaveBeenCalledWith('/api/identity/password/reset/dev-instant', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'Admin@TapDemo.test' }),
    }));
  });

  it.each([
    ['the flag is off (the API answers an unknown path with "sign in required")', () => Promise.resolve(json(401, { success: false, code: 'UNAUTHENTICATED', message: 'Authentication required' }))],
    ['the flag is off (no such route)', () => Promise.resolve(json(404, { success: false, code: 'NOT_FOUND', message: 'Not found' }))],
    ['the API fails', () => Promise.resolve(json(500, { success: false, code: 'INTERNAL_ERROR', message: 'Something went wrong' }))],
    ['the request did not come from this machine', () => Promise.resolve(json(403, { success: false, code: 'IDENTITY_DEV_RESET_LOCAL_ONLY', message: 'Local only' }))],
    ['the API is not running', () => Promise.reject(new TypeError('fetch failed'))],
    ['something other than the API answered', () => Promise.resolve(new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }))],
  ])('returns null, so the emailed link is used, when %s', async (_label, reply) => {
    vi.stubGlobal('fetch', vi.fn(reply));
    await expect(devInstantPasswordReset('admin@tapdemo.test')).resolves.toBeNull();
  });

  it.each([
    ['an employee', 'IDENTITY_DEV_RESET_ADMIN_ONLY'],
    ['an unknown address', 'IDENTITY_DEV_RESET_NOT_FOUND'],
  ])('passes on why %s cannot use it', async (_label, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(422, { success: false, code, message: 'Explained by the API.' })));
    const failure = devInstantPasswordReset('someone@tapdemo.test');
    await expect(failure).rejects.toBeInstanceOf(IdentityApiError);
    await expect(failure).rejects.toMatchObject({ code, status: 422, message: 'Explained by the API.' });
  });
});
