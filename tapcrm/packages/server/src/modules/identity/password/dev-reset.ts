import { randomInt } from 'node:crypto';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { createIdentityContext } from '../authentication/principal.js';
import { IdentityValidationError } from '../errors.js';
import { findUserByEmail } from '../repository.js';
import { clearAccountLoginFailures } from '../security/brute-force.js';
import { recordSecurityEvent } from '../security/events.js';
import { hashIdentityPassword } from './service.js';

/**
 * DEVELOPMENT ONLY — instant password reset for company admins.
 *
 * A laptop has no mailbox for the emailed reset link (the console mailer hides
 * reset emails), so with DEV_INSTANT_PASSWORD_RESET=true "Forgot password?" on
 * the company login page gives a company admin (super-admin account) a new
 * password straight away. Anyone who can reach the endpoint could take over an
 * admin account with it, so it is off unless the flag is set, never available
 * in production (the API refuses to start with the flag there), and answers
 * only requests made from this machine.
 *
 * Employees keep the normal emailed reset link.
 */

export interface DevPasswordReset {
  readonly email: string;
  readonly password: string;
}

/** Letters and digits that cannot be misread (no I, l, O, 0, 1). */
const READABLE = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function block(): string {
  let out = '';
  for (let index = 0; index < 4; index += 1) out += READABLE[randomInt(READABLE.length)];
  return out;
}

/** "Dev-7KqM-x3vR-f2Pa": easy to read aloud and type, about 70 bits of randomness. */
export function generateDevPassword(): string {
  return `Dev-${block()}-${block()}-${block()}`;
}

export async function devInstantPasswordReset(email: string, sourceIp: string | null): Promise<DevPasswordReset> {
  const user = await findUserByEmail(email);
  if (!user || user.status !== 'active') {
    throw new IdentityValidationError('IDENTITY_DEV_RESET_NOT_FOUND', 'No active account uses that email address.');
  }
  if (user.accountType !== 'super-admin') {
    throw new IdentityValidationError(
      'IDENTITY_DEV_RESET_ADMIN_ONLY',
      'Instant reset is only for company admin accounts. Other accounts use the emailed reset link.',
    );
  }

  const password = generateDevPassword();
  const passwordHash = await hashIdentityPassword(password);
  await db.transaction(createIdentityContext(user, `identity:dev-password-reset:${user.id}`, sourceIp), async (tx) => {
    // The new password works at once: no forced change, no lockout, and every
    // existing session (and any emailed reset link) stops working.
    await tx.query(sql`
      UPDATE app_user
      SET password_hash = ${passwordHash}, must_change_password = false, locked_until = NULL,
          session_version = session_version + 1
      WHERE organization_id = ${user.organizationId} AND id = ${user.id}
    `);
    await tx.query(sql`
      UPDATE session SET revoked_at = now()
      WHERE organization_id = ${user.organizationId} AND user_id = ${user.id} AND revoked_at IS NULL
    `);
    await tx.query(sql`
      UPDATE password_reset_token SET used_at = now()
      WHERE organization_id = ${user.organizationId} AND user_id = ${user.id} AND used_at IS NULL
    `);
    await recordSecurityEvent(tx, {
      organizationId: user.organizationId,
      event: 'DEV_PASSWORD_RESET',
      actorId: user.id,
      actorType: user.accountType,
      targetId: user.id,
      sourceIp,
      metadata: { flag: 'DEV_INSTANT_PASSWORD_RESET' },
    });
  });
  await clearAccountLoginFailures(user.email);
  return { email: user.email, password };
}
