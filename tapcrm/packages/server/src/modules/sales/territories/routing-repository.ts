import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { AssignmentStrategy, RoutingConfiguration } from './routing-types.js';

interface ConfigRow {
  enabled: boolean;
  assignmentStrategy: AssignmentStrategy;
  activeLeadMax: number | null;
  dailyClaimMax: number | null;
  updatedBy: string;
  updatedAt: Date;
}

export async function findRoutingConfiguration(ctx: RequestContext): Promise<RoutingConfiguration | null> {
  const row = await db.maybeOne<ConfigRow>(ctx, sql`
    SELECT enabled,
           assignment_strategy AS "assignmentStrategy",
           active_lead_max     AS "activeLeadMax",
           daily_claim_max     AS "dailyClaimMax",
           updated_by          AS "updatedBy",
           updated_at          AS "updatedAt"
      FROM sales_routing_configuration
     WHERE organization_id = ${ctx.organizationId}
  `);
  return row ? { ...row, updatedAt: new Date(row.updatedAt) } : null;
}

export async function upsertRoutingConfiguration(
  tx: Tx,
  organizationId: string,
  actorId: string,
  input: {
    enabled: boolean;
    assignmentStrategy: AssignmentStrategy;
    activeLeadMax: number | null;
    dailyClaimMax: number | null;
  },
): Promise<void> {
  await tx.query(sql`
    INSERT INTO sales_routing_configuration (
      organization_id, enabled, assignment_strategy,
      active_lead_max, daily_claim_max, updated_by
    )
    VALUES (
      ${organizationId}, ${input.enabled}, ${input.assignmentStrategy},
      ${input.activeLeadMax}, ${input.dailyClaimMax}, ${actorId}
    )
    ON CONFLICT (organization_id) DO UPDATE
      SET enabled             = EXCLUDED.enabled,
          assignment_strategy = EXCLUDED.assignment_strategy,
          active_lead_max     = EXCLUDED.active_lead_max,
          daily_claim_max     = EXCLUDED.daily_claim_max,
          updated_by          = EXCLUDED.updated_by,
          updated_at          = now()
  `);
}
