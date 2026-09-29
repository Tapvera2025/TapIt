import type { Principal } from '@tapcrm/contracts';
import { createJobContext, type RequestContext } from '../../../platform/dal/context.js';
import { platformDb } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { notify } from '../../notifications/facade.js';
import { insertActivity, insertAudit } from './repository.js';

const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';
function jobContext(organizationId: string): RequestContext { const principal: Principal = { id: SYSTEM_ID, organizationId, sessionVersion: 0, accountType: 'service', allowedActions: [], allowedResources: [], expiresAt: new Date(0) }; return createJobContext({ organizationId, principal, jobName: 'lead-stalled-sweep', runId: 'scheduled' }); }

export async function runStalledLeadSweep(): Promise<number> {
  const organizations = await platformDb.query<{ id: string }>('retention-enforcement', 'find organizations for stalled lead sweep', sql`SELECT id FROM organization WHERE status <> 'deleted'`);
  let total = 0;
  for (const organization of organizations) {
    const ctx = jobContext(organization.id);
    total += await platformDb.transactionForOrganization(organization.id, 'retention-enforcement', 'flag stalled leads', async (tx) => {
      const config = await tx.maybeOne<{ stalledAfterDays: number }>(sql`SELECT stalled_after_days AS "stalledAfterDays" FROM lead_lifecycle_configuration WHERE organization_id = ${organization.id}`);
      const days = config?.stalledAfterDays ?? 7;
      const rows = await tx.query<{ id: string; ownerId: string | null }>(sql`UPDATE lead l SET stalled_at = now(), stalled_reason = 'inactivity' WHERE l.organization_id = ${organization.id} AND l.stalled_at IS NULL AND l.status NOT IN ('converted', 'closed_lost') AND GREATEST(l.updated_at, COALESCE((SELECT MAX(a.created_at) FROM lead_activity a WHERE a.organization_id = l.organization_id AND a.lead_id = l.id), l.created_at)) < now() - (${days} * interval '1 day') RETURNING l.id, l.owner_id AS "ownerId"`);
      for (const row of rows) { await insertActivity(tx, organization.id, row.id, 'lead.stalled', null, { reason: 'inactivity' }); await insertAudit(tx, ctx, 'lead.stalled', row.id, null, { reason: 'inactivity' }); if (row.ownerId) await notify(tx, ctx, { type: 'lead.stalled', priority: 'operational', audience: { users: [row.ownerId] }, title: 'Lead needs review', body: 'A lead has stalled and needs supervisor attention.', link: `/company/sales/leads/${row.id}`, metadata: { leadId: row.id, reason: 'inactivity' } }); }
      return rows.length;
    });
  }
  return total;
}
