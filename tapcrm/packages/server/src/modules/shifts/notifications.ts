import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import {
  NOTIFICATION_TYPES,
  clip,
  formatDay,
  inBatches,
  notify,
} from '../notifications/facade.js';

/**
 * Notifies active employees who are covered by a working-day exception.
 * Recipient IDs are resolved inside the business transaction so a rolled-back
 * exception never leaves a notification behind. Explicit batches keep the
 * notification audience within the platform's size limit.
 */
export async function notifyWorkingDayException(
  tx: Tx,
  ctx: RequestContext,
  exceptionId: string,
  exceptionDate: string,
  reason: string,
  departmentIds: readonly string[],
  change: 'created' | 'deactivated' | 'reactivated',
): Promise<void> {
  const recipients = await tx.query<{ id: string }>(sql`
    SELECT id
    FROM app_user
    WHERE organization_id = ${ctx.organizationId}
      AND account_type = 'employee'
      AND status = 'active'
      AND (
        ${departmentIds.length === 0}
        OR department_id = ANY(${[...departmentIds]}::uuid[])
      )
    ORDER BY id
  `);
  const audienceUsers = recipients.map((row) => row.id);
  for (const users of inBatches(audienceUsers)) {
    const title =
      change === 'deactivated'
        ? `Working-day exception removed for ${formatDay(exceptionDate)}`
        : change === 'reactivated'
          ? `Working day restored for ${formatDay(exceptionDate)}`
          : `Working day added for ${formatDay(exceptionDate)}`;
    const body = change === 'deactivated'
      ? clip(`The normal weekday schedule is restored. ${reason}`, 500)
      : clip(reason, 500);
    await notify(tx, ctx, {
      type: NOTIFICATION_TYPES.WORKING_DAY_EXCEPTION,
      priority: 'informational',
      audience: { users, includeActor: true },
      title,
      body,
      link: '/company/attendance/my',
      metadata: { exceptionId, exceptionDate },
    });
  }
}
