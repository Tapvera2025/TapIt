import {
  getIdentitySessionSnapshot,
  identityDownload,
  identityRequest,
  IdentitySessionChangedError,
  subscribeIdentitySessionChange,
  type IdentitySessionSnapshot,
} from '../../identity/api/authApi.js';

interface CachedValue {
  readonly path: string;
  readonly value: unknown;
  readonly expiresAt: number;
}

interface InFlightRead {
  readonly path: string;
  readonly controller: AbortController;
  readonly promise: Promise<unknown>;
}

export interface PeopleReadOptions {
  readonly staleMs?: number;
  readonly signal?: AbortSignal;
}

const cache = new Map<string, CachedValue>();
const inFlight = new Map<string, InFlightRead>();

function stablePath(path: string): string {
  const url = new URL(path, 'http://people.invalid');
  const pairs = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
  );
  const query = new URLSearchParams(pairs).toString();
  return `${url.pathname}${query ? `?${query}` : ''}`;
}

function contextKey(context: IdentitySessionSnapshot, path: string): string {
  if (!context.principalId || !context.organizationId) {
    throw new Error('People data requires an authenticated session');
  }
  return `${context.organizationId}\u0000${context.principalId}\u0000${context.epoch}\u0000${path}`;
}

function stillCurrent(context: IdentitySessionSnapshot): boolean {
  const current = getIdentitySessionSnapshot();
  return current.epoch === context.epoch &&
    current.principalId === context.principalId &&
    current.organizationId === context.organizationId;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Request aborted', 'AbortError');
}

function withCallerSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** GET deduplication and short-lived memory cache, scoped to the active identity epoch. */
export function peopleRead<T>(path: string, options: PeopleReadOptions = {}): Promise<T> {
  const context = getIdentitySessionSnapshot();
  const normalizedPath = stablePath(path);
  const key = contextKey(context, normalizedPath);
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) {
    return withCallerSignal(Promise.resolve(existing.value as T), options.signal);
  }
  const pending = inFlight.get(key);
  if (pending) return withCallerSignal(pending.promise as Promise<T>, options.signal);

  const controller = new AbortController();
  const promise = identityRequest<T>(normalizedPath, { signal: controller.signal })
    .then((value) => {
      if (!stillCurrent(context)) throw new IdentitySessionChangedError();
      cache.set(key, {
        path: normalizedPath,
        value,
        expiresAt: Date.now() + Math.max(0, options.staleMs ?? 30_000),
      });
      return value;
    })
    .finally(() => { inFlight.delete(key); });
  inFlight.set(key, { path: normalizedPath, controller, promise });
  return withCallerSignal(promise, options.signal);
}

export function invalidatePeopleQueries(pathPrefixes?: readonly string[]): void {
  if (!pathPrefixes?.length) {
    clearPeopleQueries();
    return;
  }
  for (const [key, entry] of cache) {
    if (pathPrefixes.some((prefix) => entry.path.startsWith(prefix))) cache.delete(key);
  }
  for (const [key, request] of inFlight) {
    if (pathPrefixes.some((prefix) => request.path.startsWith(prefix))) {
      request.controller.abort();
      inFlight.delete(key);
    }
  }
}

/** Mutations always go to the server; callers name the reads affected by the write. */
export async function peopleMutation<T>(
  path: string,
  init: RequestInit,
  invalidate: readonly string[] = [],
): Promise<T> {
  const result = await identityRequest<T>(path, init);
  invalidatePeopleQueries(invalidate.length ? invalidate : undefined);
  return result;
}

export function peopleDownload(path: string, init: RequestInit = {}): Promise<Blob> {
  return identityDownload(path, init);
}

export function clearPeopleQueries(): void {
  for (const request of inFlight.values()) request.controller.abort();
  inFlight.clear();
  cache.clear();
}

export function peopleCacheEntryCount(): number {
  return cache.size;
}

subscribeIdentitySessionChange(() => clearPeopleQueries());
