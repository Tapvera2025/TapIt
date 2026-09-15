import { Redis } from 'ioredis';
import { loadConfig } from '../../../config.js';
import { IdentityAuthenticationError } from '../errors.js';

const failures = new Map<string, { count: number; until: number }>();
let redis: Redis | null = null;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function store() {
  if (loadConfig().SECURITY_COUNTER_STORE !== 'redis') return null;
  return (redis ??= new Redis(loadConfig().REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 }));
}

function key(kind: 'account' | 'source', value: string): string {
  return `tapcrm:identity:login-failures:${kind}:${value.trim().toLowerCase()}`;
}

export async function assertLoginAllowed(email: string, ip: string | null): Promise<void> {
  const now = Date.now();
  let delayMs = 0;
  for (const candidate of [key('account', email), key('source', ip ?? 'unknown')]) {
    const client = store();
    if (client) {
      const until = await client.get(`${candidate}:lock`);
      if (until && Number(until) > now) throw new IdentityAuthenticationError('IDENTITY_ACCOUNT_LOCKED', undefined, 429);
      const count = Number(await client.get(candidate) ?? 0);
      delayMs = Math.max(delayMs, Math.min(count * 1000, 30_000));
    } else {
      const entry = failures.get(candidate);
      if (entry && entry.count >= MAX_FAILURES && entry.until > now) throw new IdentityAuthenticationError('IDENTITY_ACCOUNT_LOCKED', undefined, 429);
      if (entry && entry.until > now) delayMs = Math.max(delayMs, entry.until - now);
    }
  }
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function recordLoginFailure(email: string, ip: string | null): Promise<{ locked: boolean; accountLocked: boolean }> {
  let locked = false;
  let accountLocked = false;
  for (const [kind, candidate] of [['account', key('account', email)], ['source', key('source', ip ?? 'unknown')]] as const) {
    const client = store();
    if (client) {
      const count = await client.incr(candidate);
      await client.expire(candidate, 900);
      if (count >= MAX_FAILURES) {
        await client.set(`${candidate}:lock`, String(Date.now() + LOCKOUT_MS), 'EX', 900);
        locked = true;
        accountLocked ||= kind === 'account';
      }
    } else {
      const current = failures.get(candidate) ?? { count: 0, until: 0 };
      current.count += 1;
      current.until = current.count >= MAX_FAILURES ? Date.now() + LOCKOUT_MS : Date.now() + Math.min(current.count * 1000, 30_000);
      failures.set(candidate, current);
      locked ||= current.count >= MAX_FAILURES;
      accountLocked ||= kind === 'account' && current.count >= MAX_FAILURES;
    }
  }
  return { locked, accountLocked };
}

export async function clearLoginFailures(email: string, ip: string | null): Promise<void> {
  for (const candidate of [key('account', email), key('source', ip ?? 'unknown')]) {
    const client = store();
    if (client) await client.del(candidate, `${candidate}:lock`);
    else failures.delete(candidate);
  }
}

/** Clears only the account counter; source-address protection remains intact. */
export async function clearAccountLoginFailures(email: string): Promise<void> {
  const candidate = key('account', email);
  const client = store();
  if (client) await client.del(candidate, `${candidate}:lock`);
  else failures.delete(candidate);
}
