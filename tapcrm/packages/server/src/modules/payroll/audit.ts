import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

/**
 * Payroll's activity trail. Sensitive writes are recorded without amounts
 * (design §9, Task 7): who did what to which run, structure, setting, input or
 * payslip, and why — never the salary figures themselves.
 */
export async function writePayrollAudit(
  tx: Tx,
  ctx: RequestContext,
  entry: {
    readonly action: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly after: Record<string, unknown>;
    readonly before?: Record<string, unknown> | null;
    readonly reason?: string | null;
  },
): Promise<void> {
  await tx.query(sql`
    INSERT INTO audit_outbox (organization_id, stream, payload)
    VALUES (${ctx.organizationId}, 'activity', ${JSON.stringify({
      action: entry.action,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: entry.before ?? null,
      after: entry.after,
      reason: entry.reason ?? null,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    })}::jsonb)
  `);
}
