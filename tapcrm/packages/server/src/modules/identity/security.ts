import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { identityDb, bootstrapDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { loadConfig } from '../../config.js';
import {
  sendAccountLockedAlert,
  sendSuspiciousLoginAlert,
  sendSecurityAlert,
} from './email.js';

export interface LockoutState {
  readonly isLocked: boolean;
  readonly remainingSeconds?: number;
  readonly delayMs?: number;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 15 * 60;
const ATTEMPT_WINDOW_SECONDS = 30 * 60;
let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis)
    redis = new Redis(loadConfig().REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
  return redis;
}
function accountKey(org: string, type: string, email: string) {
  return `tapcrm:auth:attempt:account:${org}:${type}:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`;
}
function ipKey(ip: string | null) {
  return `tapcrm:auth:attempt:ip:${ip ?? 'unknown'}`;
}
async function state(key: string): Promise<{ count: number; ttl: number }> {
  const r = getRedis();
  const count = Number((await r.get(key)) ?? 0);
  const ttl = Math.max(0, await r.ttl(key));
  return { count, ttl };
}

export async function checkLoginSecurity(
  organizationId: string,
  accountType: string,
  email: string,
  ip: string | null,
): Promise<LockoutState> {
  const [a, i] = await Promise.all([
    state(accountKey(organizationId, accountType, email)),
    ip ? state(ipKey(ip)) : Promise.resolve({ count: 0, ttl: 0 }),
  ]);
  const count = Math.max(a.count, i.count);
  if (count >= MAX_FAILED_ATTEMPTS)
    return { isLocked: true, remainingSeconds: Math.max(a.ttl, i.ttl) };
  return {
    isLocked: false,
    delayMs: count >= 3 ? Math.min(2000, 250 * 2 ** (count - 3)) : 0,
  };
}

export async function recordLoginFailure(
  organizationId: string,
  accountType: string,
  email: string,
  ip: string | null,
): Promise<void> {
  const r = getRedis();
  const keys = [
    accountKey(organizationId, accountType, email),
    ...(ip ? [ipKey(ip)] : []),
  ];
  for (const key of keys) {
    const count = await r.incr(key);
    if (count === 1) await r.expire(key, ATTEMPT_WINDOW_SECONDS);
  }
  const current = await state(accountKey(organizationId, accountType, email));
  if (current.count >= MAX_FAILED_ATTEMPTS) {
    const rows = await bootstrapDb.readAs<{ id: string; email: string | null }>(
      organizationId,
      sql`SELECT id,email FROM app_user WHERE organization_id=${organizationId} AND account_type=${accountType} AND email=${email} LIMIT 1`,
    );
    const u = rows[0];
    if (u) {
      if (u.email) void sendAccountLockedAlert(u.email, ip);
    }
  }
}
export async function recordLoginSuccess(
  _organizationId: string,
  _accountType: string,
  email: string,
  ip: string | null,
): Promise<void> {
  const r = getRedis();
  await r.del(accountKey(_organizationId, _accountType, email));
  if (ip) await r.del(ipKey(ip));
}
export async function unlockUserAccount(
  organizationId: string,
  userId: string,
): Promise<void> {
  await identityDb.transactionForOrganization(organizationId, (tx) =>
    tx.query(
      sql`UPDATE app_user SET status='active', session_version=session_version+1, updated_at=NOW() WHERE organization_id=${organizationId} AND id=${userId} AND account_type <> 'super-admin'`,
    ),
  );
}

export interface LoginLocation {
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
}
export async function evaluateSuspiciousLogin(
  organizationId: string,
  userId: string,
  email: string | null,
  meta: {
    ip: string | null;
    userAgent: string | null;
    countryCode?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  },
): Promise<void> {
  const country = meta.countryCode ?? null;
  const previous = await bootstrapDb.readAs<{
    countryCode: string | null;
    latitude: number | null;
    longitude: number | null;
    occurredAt: string;
    userAgent: string | null;
  }>(
    organizationId,
    sql`SELECT country_code AS "countryCode", latitude::float8, longitude::float8, occurred_at AS "occurredAt", user_agent AS "userAgent" FROM login_security_event WHERE organization_id=${organizationId} AND user_id=${userId} ORDER BY occurred_at DESC LIMIT 1`,
  );
  const p = previous[0];
  let suspicious = false;
  const reasons: string[] = [];
  if (p && p.userAgent && meta.userAgent && p.userAgent !== meta.userAgent) {
    suspicious = true;
    reasons.push('new device');
  }
  if (p && country && p.countryCode && country !== p.countryCode) {
    suspicious = true;
    reasons.push('new country');
  }
  if (
    p &&
    p.latitude != null &&
    p.longitude != null &&
    meta.latitude != null &&
    meta.longitude != null
  ) {
    const km = haversineKm(p.latitude, p.longitude, meta.latitude, meta.longitude);
    const hours = Math.max(
      0.1,
      (Date.now() - new Date(p.occurredAt).getTime()) / 3600000,
    );
    if (km / hours > 900) {
      suspicious = true;
      reasons.push('improbable travel');
    }
  }
  await identityDb.transactionForOrganization(organizationId, (tx) =>
    tx.query(
      sql`INSERT INTO login_security_event(organization_id,user_id,ip,user_agent,country_code,latitude,longitude,suspicious,reason) VALUES(${organizationId},${userId},${meta.ip},${meta.userAgent},${country},${meta.latitude ?? null},${meta.longitude ?? null},${suspicious},${reasons.join(', ') || null})`,
    ),
  );
  if (suspicious && email)
    void sendSuspiciousLoginAlert(email, {
      ip: meta.ip,
      userAgent: meta.userAgent,
      approxLocation: reasons.join(', ') || 'unusual sign-in',
    });
}
function haversineKm(a: number, b: number, c: number, d: number) {
  const R = 6371;
  const p = Math.PI / 180;
  const x = (c - a) * p,
    y = (d - b) * p;
  const q =
    Math.sin(x / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(y / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(q));
}

export async function sendRefreshReuseAlert(email: string | null, ip: string | null) {
  if (email)
    void sendSecurityAlert(
      email,
      'Refresh token reuse detected',
      `A refresh token was replayed and your active refresh-token family was revoked. Source: ${ip ?? 'unknown'}.`,
    );
}
