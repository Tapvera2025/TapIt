import { platformDb, bootstrapDb, db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { sendAccountLockedAlert, sendSuspiciousLoginAlert } from './email.js';

export interface LockoutState {
  readonly isLocked: boolean;
  readonly remainingSeconds?: number;
  readonly delayMs?: number;
}

interface AttemptRecord {
  count: number;
  lastAttemptAt: number;
  lockedUntil: number | null;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

// In-memory brute force cache per account and per IP
const accountAttempts = new Map<string, AttemptRecord>();
const ipAttempts = new Map<string, AttemptRecord>();

function getAccountKey(
  organizationId: string,
  accountType: string,
  email: string,
): string {
  return `${organizationId}:${accountType}:${email.trim().toLowerCase()}`;
}

/**
 * ID-9: Checks if an account or IP is currently locked or requires progressive delay.
 */
export async function checkLoginSecurity(
  organizationId: string,
  accountType: string,
  email: string,
  ip: string | null,
): Promise<LockoutState> {
  const now = Date.now();
  const accKey = getAccountKey(organizationId, accountType, email);

  // Check DB status for user if locked at account level
  try {
    const rows = await bootstrapDb.readAs<{ status: string }>(
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

    if (rows[0]?.status === 'locked') {
      return { isLocked: true };
    }
  } catch {
    // Continue with in-memory check if DB read fails
  }

  // Check in-memory account lockout
  const accRecord = accountAttempts.get(accKey);
  if (accRecord && accRecord.lockedUntil && accRecord.lockedUntil > now) {
    return {
      isLocked: true,
      remainingSeconds: Math.ceil((accRecord.lockedUntil - now) / 1000),
    };
  }

  // Check in-memory IP lockout
  if (ip) {
    const ipRecord = ipAttempts.get(ip);
    if (ipRecord && ipRecord.lockedUntil && ipRecord.lockedUntil > now) {
      return {
        isLocked: true,
        remainingSeconds: Math.ceil((ipRecord.lockedUntil - now) / 1000),
      };
    }
  }

  // Calculate progressive delay
  const attempts = Math.max(
    accRecord?.count ?? 0,
    ip ? (ipAttempts.get(ip)?.count ?? 0) : 0,
  );
  let delayMs = 0;
  if (attempts >= 4) {
    delayMs = 2000;
  } else if (attempts >= 3) {
    delayMs = 1000;
  } else if (attempts >= 2) {
    delayMs = 300;
  }

  return { isLocked: false, delayMs };
}

/**
 * ID-9: Records a failed login attempt and applies progressive delay / lockout.
 */
export async function recordLoginFailure(
  organizationId: string,
  accountType: string,
  email: string,
  ip: string | null,
): Promise<void> {
  const now = Date.now();
  const accKey = getAccountKey(organizationId, accountType, email);

  // Update account attempts
  let accRecord = accountAttempts.get(accKey);
  if (!accRecord || now - accRecord.lastAttemptAt > ATTEMPT_WINDOW_MS) {
    accRecord = { count: 1, lastAttemptAt: now, lockedUntil: null };
  } else {
    accRecord.count += 1;
    accRecord.lastAttemptAt = now;
  }

  if (accRecord.count >= MAX_FAILED_ATTEMPTS) {
    accRecord.lockedUntil = now + LOCKOUT_DURATION_MS;

    // Send account locked email alert
    void sendAccountLockedAlert(email, ip);

    // Optionally update user status in DB
    try {
      await platformDb.query(
        'health-check',
        'lock user account after brute-force attempts',
        sql`
          UPDATE app_user
          SET status = 'locked'
          WHERE organization_id = ${organizationId}
            AND account_type = ${accountType}
            AND email = ${email}
            AND status = 'active'
        `,
      );
    } catch {
      // Best effort
    }
  }
  accountAttempts.set(accKey, accRecord);

  // Update IP attempts
  if (ip) {
    let ipRecord = ipAttempts.get(ip);
    if (!ipRecord || now - ipRecord.lastAttemptAt > ATTEMPT_WINDOW_MS) {
      ipRecord = { count: 1, lastAttemptAt: now, lockedUntil: null };
    } else {
      ipRecord.count += 1;
      ipRecord.lastAttemptAt = now;
    }

    if (ipRecord.count >= MAX_FAILED_ATTEMPTS * 2) {
      ipRecord.lockedUntil = now + LOCKOUT_DURATION_MS;
    }
    ipAttempts.set(ip, ipRecord);
  }
}

/**
 * Resets failed login counters on successful login.
 */
export function recordLoginSuccess(
  organizationId: string,
  accountType: string,
  email: string,
  ip: string | null,
): void {
  const accKey = getAccountKey(organizationId, accountType, email);
  accountAttempts.delete(accKey);
  if (ip) {
    ipAttempts.delete(ip);
  }
}

/**
 * ID-9: Super Admin or HR unlocks a locked account.
 */
export async function unlockUserAccount(
  organizationId: string,
  userId: string,
): Promise<void> {
  const rows = await platformDb.query<{
    id: string;
    email: string | null;
    accountType: string;
  }>(
    'health-check',
    'unlock user account',
    sql`
      UPDATE app_user
      SET status = 'active'
      WHERE organization_id = ${organizationId}
        AND id = ${userId}
        AND status = 'locked'
      RETURNING id, email, account_type AS "accountType"
    `,
  );

  const updated = rows[0];
  if (updated && updated.email) {
    const accKey = getAccountKey(organizationId, updated.accountType, updated.email);
    accountAttempts.delete(accKey);
  }
}

/**
 * ID-10: Suspicious sign-in check: checks if device/IP is novel for this user.
 */
export async function evaluateSuspiciousLogin(
  organizationId: string,
  userId: string,
  email: string | null,
  meta: {
    ip: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  if (!email || (!meta.ip && !meta.userAgent)) {
    return;
  }

  try {
    const priorSessions = await bootstrapDb.readAs<{ id: string }>(
      organizationId,
      sql`
        SELECT id
        FROM session
        WHERE organization_id = ${organizationId}
          AND user_id = ${userId}
          AND (ip = ${meta.ip}::inet OR user_agent = ${meta.userAgent})
        LIMIT 1
      `,
    );

    // If no prior session matches IP or user agent, alert user (ID-10)
    if (priorSessions.length === 0) {
      void sendSuspiciousLoginAlert(email, {
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }
  } catch {
    // Non-blocking observability check
  }
}
