import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { AssignmentStrategy, RoutingConfiguration } from './routing-types.js';

interface ConfigRow { enabled: boolean; assignmentStrategy: AssignmentStrategy; updatedBy: string; updatedAt: Date; }

export async function findRoutingConfiguration(ctx: RequestContext): Promise<RoutingConfiguration | null> {
  const row = await db.maybeOne<ConfigRow>(ctx, sql`SELECT enabled, assignment_strategy AS "assignmentStrategy", updated_by AS "updatedBy", updated_at AS "updatedAt" FROM sales_routing_configuration WHERE organization_id = ${ctx.organizationId}`);
  return row ? { ...row, updatedAt: new Date(row.updatedAt) } : null;
}

export async function upsertRoutingConfiguration(tx: Tx, organizationId: string, actorId: string, input: { enabled: boolean; assignmentStrategy: AssignmentStrategy }): Promise<void> {
  await tx.query(sql`INSERT INTO sales_routing_configuration (organization_id, enabled, assignment_strategy, updated_by) VALUES (${organizationId}, ${input.enabled}, ${input.assignmentStrategy}, ${actorId}) ON CONFLICT (organization_id) DO UPDATE SET enabled = EXCLUDED.enabled, assignment_strategy = EXCLUDED.assignment_strategy, updated_by = EXCLUDED.updated_by`);
}
