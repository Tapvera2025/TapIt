import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  invalidateIdentityPermissions,
  saveIdentityTokens,
  setIdentitySessionPrincipal,
} from '../../identity/api/authApi.js';
import { clearPeopleQueries, peopleCacheEntryCount, peopleRead } from './client.js';

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
  clearPeopleQueries();
});

afterEach(() => {
  clearPeopleQueries();
  vi.unstubAllGlobals();
});

it('discards an old principal response after logout and a different login', async () => {
  let replyToA: ((response: Response) => void) | undefined;
  const fetchMock = vi.fn()
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { replyToA = resolve; }))
    .mockResolvedValueOnce(success({ owner: 'B' }));
  vi.stubGlobal('fetch', fetchMock);

  saveIdentityTokens('token-A', 'refresh-A');
  setIdentitySessionPrincipal('A', 'org-A');
  const oldRead = peopleRead<{ owner: string }>('/api/people/me');
  const oldRejection = expect(oldRead).rejects.toThrow();

  saveIdentityTokens('token-B', 'refresh-B');
  setIdentitySessionPrincipal('B', 'org-B');
  replyToA?.(success({ owner: 'A' }));
  await oldRejection;
  expect(peopleCacheEntryCount()).toBe(0);

  expect(await peopleRead<{ owner: string }>('/api/people/me')).toEqual({ owner: 'B' });
  expect(peopleCacheEntryCount()).toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('discards an old response when the same principal changes organization', async () => {
  let replyToOldOrg: ((response: Response) => void) | undefined;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { replyToOldOrg = resolve; })));
  saveIdentityTokens('token-A', 'refresh-A');
  setIdentitySessionPrincipal('A', 'org-A');
  const oldRead = peopleRead('/api/attendance/live');
  const oldRejection = expect(oldRead).rejects.toThrow();

  setIdentitySessionPrincipal('A', 'org-B');
  replyToOldOrg?.(success({ rows: ['org-A'] }));
  await oldRejection;
  expect(peopleCacheEntryCount()).toBe(0);
});

it('drops cached and in-flight People reads when permissions change', async () => {
  let replyToOldPolicy: ((response: Response) => void) | undefined;
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(success({ visible: 'before' }))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { replyToOldPolicy = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  saveIdentityTokens('token-A', 'refresh-A');
  setIdentitySessionPrincipal('A', 'org-A');

  expect(await peopleRead('/api/attendance/live')).toEqual({ visible: 'before' });
  expect(peopleCacheEntryCount()).toBe(1);
  const oldRead = peopleRead('/api/leave/queue');
  const oldRejection = expect(oldRead).rejects.toThrow();
  invalidateIdentityPermissions();
  replyToOldPolicy?.(success({ visible: 'before' }));
  await oldRejection;
  expect(peopleCacheEntryCount()).toBe(0);
});
