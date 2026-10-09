import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export async function writePenaltyAudit(
  tx: Tx,
  ctx: RequestContext,
  action: 'penalty.created' | 'penalty.cancelled' | 'penalty.exported',
  targetId: string,
  after: Record<string, unknown>,
  before: Record<string, unknown> | null = null,
  reason: string | null = null,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO audit_outbox (organization_id, stream, payload)
    VALUES (
      ${ctx.organizationId}, 'activity',
      ${JSON.stringify({
        action,
        actorId: ctx.principal.id,
        actorType: ctx.principal.accountType,
        targetType: 'employeePenalty',
        targetId,
        before,
        after,
        reason,
        requestId: ctx.requestId,
        sourceIp: ctx.sourceIp,
      })}::jsonb
    )
  `);
}
