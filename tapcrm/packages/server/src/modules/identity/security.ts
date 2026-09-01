import { identityDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { getCounterStore } from '../../platform/security/counters.js';
import { sendAccountLockedAlert, sendSuspiciousLoginAlert } from './email.js';

/**
 * Brute-force protection and suspicious-login detection — ID-9, ID-10.
 *
 * ID-9: "Progressive delay then temporary lockout per account and per source
 * address. Lockout is releasable by HR or Super Admin."
 *
 * Two things this file deliberately does NOT do:
 *
 *   It does not sleep. The previous implementation applied the progressive
 *   delay with `await setTimeout(delayMs)`, which holds an Express worker for
 *   the duration. Against a bot that is not a defence, it is an amplifier: the
 *   attacker spends nothing and the server spends a worker. The delay is
 *   returned to the caller as a `Retry-After` instead, which costs the attacker
 *   the same wall-clock time and costs us nothing.
 *
 *   It does not keep counters in process memory. See
 *   `platform/security/counters.ts` — a counter that resets on deploy and does
 *   not span replicas is a control an attacker gets for free.
 */

export interface LockoutState {
  readonly isLocked: boolean;
  readonly retryAfterSeconds: number;
}

const MAX_ACCOUNT_ATTEMPTS = 5;
/** An address is doing more than one person's worth of failing. */
const MAX_ADDRESS_ATTEMPTS = 20;
const LOCKOUT_MS = 15 * 60 * 1000;
const WINDOW_MS = 30 * 60 * 1000;

function accountKey(organizationId: string, accountType: string, email: string): string {
  return `login:acct:${organizationId}:${accountType}:${email.trim().toLowerCase()}`;
}

function addressKey(ip: string): string {
  return `login:ip:${ip}`;
}

/**
 * The progressive part of ID-9, expressed as a number of seconds the caller
 * should wait rather than as a sleep the server performs.
 */
function backoffSeconds(attempts: number): number {
  if (attempts >= 4) return 8;
  if (attempts >= 3) return 4;
  if (attempts >= 2) return 2;
  return 0;
}

/**
 * What to do when the shared counter store cannot be reached.
 *
 * Deliberately fail OPEN, and loudly. Failing closed would mean a Redis outage
 * locks every employee out of the product — turning a cache incident into a
 * total one — and the thing being protected here is a rate, not the credential
 * itself: the password is still verified either way.
 *
 * §13 lists this as a paging alert rather than a log line, because the window
 * where it applies is a window with no brute-force protection, and nobody
 * should discover that from a graph a week later.
 */
function storeUnavailable(operation: string, error: unknown): void {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'brute-force counter store unavailable — protection degraded',
      operation,
      err: error instanceof Error ? error.message : String(error),
    }),
  );
}

/** Checked before the password is verified, so a barred account costs nothing. */
export async function checkLoginSecurity(
  organizationId: string,
  accountType: string,
  email: string,
  ip: string | null,
): Promise<LockoutState> {
  // The database side first: an account an administrator locked stays locked
  // whatever the cache says, and this check does not depend on Redis at all.
  const user = await identityDb.readOne<{ status: string }>(
    organizationId,
    sql`
      SELECT status
      FROM app_user
      WHERE organization_id = ${organizationId}
        AND account_type = ${accountType}
        AND email = ${email}
      LIMIT 1
    `,
  );
  if (user?.status === 'locked') {
    return { isLocked: true, retryAfterSeconds: Math.ceil(LOCKOUT_MS / 1000) };
  }

  const counters = getCounterStore();
  const account = accountKey(organizationId, accountType, email);

  try {
    const [accountLock, addressLock] = await Promise.all([
      counters.lockedFor(account),
      ip === null ? Promise.resolve(null) : counters.lockedFor(addressKey(ip)),
    ]);

    const locked = Math.max(accountLock ?? 0, addressLock ?? 0);
    if (locked > 0) {
      return { isLocked: true, retryAfterSeconds: Math.ceil(locked / 1000) };
    }

    const [accountAttempts, addressAttempts] = await Promise.all([
      counters.peek(account),
      ip === null ? Promise.resolve(0) : counters.peek(addressKey(ip)),
    ]);

    return {
      isLocked: false,
      retryAfterSeconds: backoffSeconds(Math.max(accountAttempts, addressAttempts)),
    };
  } catch (error) {
    storeUnavailable('checkLoginSecurity', error);
    return { isLocked: false, retryAfterSeconds: 0 };
  }
}

/** Records a failed attempt and locks the account or address once it crosses the line. */
export async function recordLoginFailure(
  organizationId: string,
  accountType: string,
  email: string,
  ip: string | null,
): Promise<void> {
  try {
    await countFailure(organizationId, accountType, email, ip);
  } catch (error) {
    storeUnavailable('recordLoginFailure', error);
  }
}

async function countFailure(
  organizationId: string,
  accountType: string,
  email: string,
  ip: string | null,
): Promise<void> {
  const counters = getCounterStore();
  const account = accountKey(organizationId, accountType, email);

  const accountHit = await counters.hit(account, WINDOW_MS);

  if (accountHit.count >= MAX_ACCOUNT_ATTEMPTS) {
    await counters.lock(account, LOCKOUT_MS);

    // ID-9 — the lock is releasable by HR or Super Admin, so it is recorded on
    // the user rather than only in the cache. `mustExecute` is deliberately not
    // used: the account may already be locked from an earlier burst, and a
    // second lock attempt affecting no rows is the expected case, not a defect.
    await identityDb.execute(
      organizationId,
      sql`
        UPDATE app_user
        SET status = 'locked',
            updated_at = now()
        WHERE organization_id = ${organizationId}
          AND account_type = ${accountType}
          AND email = ${email}
          AND status = 'active'
      `,
    );

    void sendAccountLockedAlert(email, ip);
  }

  if (ip !== null) {
    const addressHit = await counters.hit(addressKey(ip), WINDOW_MS);
    if (addressHit.count >= MAX_ADDRESS_ATTEMPTS) {
      await counters.lock(addressKey(ip), LOCKOUT_MS);
    }
  }
}

/** Clears the counters after a successful sign-in. */
export async function recordLoginSuccess(
  organizationId: string,
  accountType: string,
  email: string,
  ip: string | null,
): Promise<void> {
  const counters = getCounterStore();
  try {
    await Promise.all([
      counters.clear(accountKey(organizationId, accountType, email)),
      ip === null ? Promise.resolve() : counters.clear(addressKey(ip)),
    ]);
  } catch (error) {
    // Worst case the user carries a stale backoff for one window. Never a
    // reason to fail a sign-in that has already succeeded.
    storeUnavailable('recordLoginSuccess', error);
  }
}

/** ID-9 — Super Admin or HR releases a locked account. */
export async function unlockUserAccount(
  organizationId: string,
  userId: string,
): Promise<{ id: string; email: string | null; accountType: string }> {
  const unlocked = await identityDb.transaction(organizationId, async (tx) => {
    const rows = await tx.query<{ id: string; email: string | null; accountType: string }>(sql`
      UPDATE app_user
      SET status = 'active',
          updated_at = now()
      WHERE organization_id = ${organizationId}
        AND id = ${userId}
        AND status = 'locked'
      RETURNING id, email, account_type
    `);
    return rows[0] ?? null;
  });

  if (unlocked === null) {
    throw new Error(`User ${userId} is not locked, so there is nothing to release.`);
  }

  if (unlocked.email !== null) {
    await getCounterStore().clear(
      accountKey(organizationId, unlocked.accountType, unlocked.email),
    );
  }
  return unlocked;
}

/**
 * ID-10 — "A sign-in from a new device, a new country, or an improbable travel
 * pattern notifies the user and Super Admin. It does not block by default."
 *
 * Novelty is judged against the sessions this user has actually held. It is a
 * notification, never a gate — the requirement is explicit that it does not
 * block, because the false-positive rate on this signal is high and a blocked
 * legitimate sign-in costs more than a notified suspicious one.
 */
export async function evaluateSuspiciousLogin(
  organizationId: string,
  userId: string,
  email: string | null,
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  if (email === null || (meta.ip === null && meta.userAgent === null)) return;

  try {
    const seenBefore = await identityDb.readOne<{ id: string }>(
      organizationId,
      sql`
        SELECT id
        FROM session
        WHERE organization_id = ${organizationId}
          AND user_id = ${userId}
          AND (
            (${meta.ip}::text IS NOT NULL AND ip = ${meta.ip}::inet)
            OR (${meta.userAgent}::text IS NOT NULL AND user_agent = ${meta.userAgent})
          )
        LIMIT 1
      `,
    );

    if (seenBefore === null) {
      await sendSuspiciousLoginAlert(email, { ip: meta.ip, userAgent: meta.userAgent });
    }
  } catch (error) {
    // Advisory signal. It must never be the reason a legitimate sign-in fails.
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'suspicious-login evaluation failed',
        err: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
