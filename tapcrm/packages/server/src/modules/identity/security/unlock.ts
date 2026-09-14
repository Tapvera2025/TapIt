import { db } from '../../../platform/dal/db.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { sql } from '../../../platform/dal/sql.js';
import { IdentityNotFoundError, IdentityValidationError } from '../errors.js';
import { clearAccountLoginFailures } from './brute-force.js';
import { recordSecurityEvent } from './events.js';

export async function userResource(ctx: RequestContext, id: string) {
  return db.maybeOne<Record<string, unknown>>(ctx, sql`
    SELECT id, organization_id AS "organizationId", department_id AS "departmentId",
           team_id AS "teamId"
    FROM app_user
    WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `).then((row) => row === null ? null : { ...row, type: 'user' as const, id });
}

export async function unlockUser(ctx: RequestContext, userId: string) {
  const result = await db.transaction(ctx, async (tx) => {
    const actor = await tx.maybeOne<{ accountType: string; departmentCode: string | null }>(sql`
      SELECT u.account_type, d.code AS department_code
      FROM app_user u
      LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
      WHERE u.organization_id = ${ctx.organizationId} AND u.id = ${ctx.principal.id}
    `);
    const isHr = actor?.accountType === 'employee' && actor.departmentCode?.toUpperCase() === 'HR';
    if (actor?.accountType !== 'super-admin' && !isHr) {
      throw new IdentityValidationError('IDENTITY_UNLOCK_NOT_ALLOWED', 'Only a Super Admin or authorized HR administrator can unlock accounts');
    }

    const target = await tx.maybeOne<{ id: string; email: string; status: string; lockedUntil: Date | null }>(sql`
      SELECT id, email, status, locked_until
      FROM app_user
      WHERE organization_id = ${ctx.organizationId} AND id = ${userId}
      FOR UPDATE
    `);
    if (!target) throw new IdentityNotFoundError('IDENTITY_UNLOCK_TARGET_NOT_FOUND', 'User not found');
    if (target.status !== 'active') {
      throw new IdentityValidationError('IDENTITY_UNLOCK_TARGET_DEACTIVATED', 'Deactivated users cannot be unlocked');
    }
    const wasLocked = target.lockedUntil !== null;
    await tx.query(sql`
      UPDATE app_user SET locked_until = NULL
      WHERE organization_id = ${ctx.organizationId} AND id = ${userId}
    `);
    await recordSecurityEvent(tx, {
      organizationId: ctx.organizationId,
      event: 'ACCOUNT_UNLOCKED',
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetId: userId,
      sourceIp: ctx.sourceIp,
      metadata: { wasLocked },
    });
    return { id: target.id, email: target.email, wasLocked };
  });

  // Keep source-address protection intact; only the target account is reset.
  await clearAccountLoginFailures(result.email);
  return { id: result.id, unlocked: true, wasLocked: result.wasLocked };
}
