import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export async function enqueueOrganizationAudit(tx: Tx, input: { organizationId: string; actorId: string; actorType: string; requestId: string; sourceIp: string | null; action: string; resourceType: string; resourceId: string | null; before: unknown; after: unknown }): Promise<void> {
  await tx.query(sql`
    INSERT INTO audit_outbox (organization_id, stream, payload)
    VALUES (${input.organizationId}, 'activity', ${JSON.stringify({
      action: input.action,
      actorId: input.actorId,
      actorType: input.actorType,
      targetType: input.resourceType,
      targetId: input.resourceId,
      before: input.before,
      after: input.after,
      requestId: input.requestId,
      sourceIp: input.sourceIp,
    })}::jsonb)
  `);
}
