import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  getIdentitySessionSnapshot,
  identityRequest,
  saveIdentityTokens,
  setIdentitySessionPrincipal,
} from './authApi.js';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); },
  };
}

function success(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('keeps requests sent before the signed-in account was first identified', async () => {
  const replies: Array<(response: Response) => void> = [];
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { replies.push(resolve); })));
  saveIdentityTokens('token-A', 'refresh-A');

  // Two requests leave together, as a page's first loads do after sign-in.
  const first = identityRequest<{ user: string }>('/api/identity/me');
  const second = identityRequest<{ user: string }>('/api/identity/me');
  const epoch = getIdentitySessionSnapshot().epoch;

  replies[0]?.(success({ user: 'A' }));
  expect(await first).toEqual({ user: 'A' });
  setIdentitySessionPrincipal('A', 'org-A');
  expect(getIdentitySessionSnapshot().epoch).toBe(epoch);

  replies[1]?.(success({ user: 'A' }));
  expect(await second).toEqual({ user: 'A' });
});

it('still refuses a response when a known account changes to another', async () => {
  let reply: ((response: Response) => void) | undefined;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { reply = resolve; })));
  saveIdentityTokens('token-A', 'refresh-A');
  setIdentitySessionPrincipal('A', 'org-A');

  const pending = identityRequest('/api/identity/me');
  const rejection = expect(pending).rejects.toThrow(/signed-in account changed/);
  setIdentitySessionPrincipal('B', 'org-A');
  reply?.(success({ user: 'A' }));
  await rejection;
});

it('keeps other requests valid while an expired access token is renewed, renewing it once', async () => {
  const refused = () =>
    new Response(JSON.stringify({ success: false }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  const waitingWithOldToken: Array<(response: Response) => void> = [];
  let renewals = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      if (String(url).endsWith('/identity/refresh')) {
        renewals += 1;
        return Promise.resolve(success({ accessToken: 'fresh', refreshToken: 'refresh-2' }));
      }
      const authorization = (init.headers as Record<string, string>)['authorization'];
      if (authorization === 'Bearer expired')
        return new Promise<Response>((resolve) => { waitingWithOldToken.push(resolve); });
      return Promise.resolve(success({ sentWith: authorization }));
    }),
  );
  saveIdentityTokens('expired', 'refresh-1');
  setIdentitySessionPrincipal('A', 'org-A');

  // A page's first loads leave together with a token that has expired.
  const first = identityRequest('/api/identity/me');
  const second = identityRequest('/api/notifications');

  // The first is refused and renews the token while the second is still out.
  waitingWithOldToken[0]?.(refused());
  expect(await first).toEqual({ sentWith: 'Bearer fresh' });

  // The second is refused afterwards: it uses the renewed token, not an error.
  waitingWithOldToken[1]?.(refused());
  expect(await second).toEqual({ sentWith: 'Bearer fresh' });
  expect(renewals).toBe(1);
});
