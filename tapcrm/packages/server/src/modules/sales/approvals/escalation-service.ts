/**
 * Approval SLA escalation sweeper (R-APP-05, "a second breach does not
 * escalate again"). Called by the registered job every minute; each
 * tenant that has pending or returned approval requests whose SLA is
 * past due gets one escalation per request.
 *
 * The service lookup is deliberately platformDb-wide: the job runs
 * without a user principal, and the per-tenant transaction below sets
 * the RLS context so the escalateIfBreached call sees only its tenant.
 */

import type { Principal } from '@tapcrm/contracts';
import { createJobContext, type RequestContext } from '../../../platform/dal/context.js';
import { platformDb } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { escalateIfBreached } from './service.js';

const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';

function jobContext(organizationId: string): RequestContext {
  const principal: Principal = {
    id: SYSTEM_ID,
    organizationId,
    sessionVersion: 0,
    accountType: 'service',
    allowedActions: [],
    allowedResources: [],
    expiresAt: new Date(0),
  };
  return createJobContext({
    organizationId,
    principal,
    jobName: 'sales.approvals.escalate-breached',
    runId: 'scheduled',
  });
}

export async function runEscalationSweep(now: Date = new Date()): Promise<number> {
  // Find every tenant that still has at least one request worth escalating.
  // Keeps the per-tenant loop short on quiet orgs.
  const organizations = await platformDb.query<{ id: string }>(
    'job-scheduling',
    'find organizations with breached approval requests',
    sql`
      SELECT DISTINCT ar.organization_id AS id
        FROM approval_request ar
       WHERE ar.state IN ('pending', 'returned')
         AND ar.escalation_count < 1
         AND ar.sla_due_at <= ${now}
    `,
  );

  let escalated = 0;
  for (const organization of organizations) {
    escalated += await platformDb.transactionForOrganization(
      organization.id,
      'job-scheduling',
      'escalate breached approval requests',
      async (tx) => {
        const requests = await tx.query<{ id: string }>(sql`
          SELECT id
            FROM approval_request
           WHERE organization_id = ${organization.id}
             AND state IN ('pending', 'returned')
             AND escalation_count < 1
             AND sla_due_at <= ${now}
           ORDER BY sla_due_at
        `);
        let count = 0;
        const ctx = jobContext(organization.id);
        for (const request of requests) {
          // escalateIfBreached runs its own transaction and re-checks the
          // breach + escalation state under row lock; this inner query is
          // only a quick batch filter so we do not open a transaction per
          // tenant with nothing to do.
          await escalateIfBreached(ctx, request.id, now);
          count += 1;
        }
        return count;
      },
    );
  }
  return escalated;
}
