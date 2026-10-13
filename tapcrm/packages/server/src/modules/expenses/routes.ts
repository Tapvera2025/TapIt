import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { route } from '../../platform/http/route.js';
import { makeExpenseResource } from './policy.js';
import { approveClaim, createClaim, deleteClaim, downloadAttachment, getClaim, listApprovals, listMine, rejectClaim, updateClaim } from './service.js';
import { createExpenseSchema, expenseListSchema, rejectExpenseSchema, updateExpenseSchema } from './validators.js';

async function loadClaim(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await db.maybeOne<{ id: string; organizationId: string; claimedBy: string; departmentId: string | null; teamId: string | null }>(ctx, sql`SELECT c.id, c.organization_id AS "organizationId", c.claimed_by AS "claimedBy", u.department_id AS "departmentId", u.team_id AS "teamId" FROM expense_claim c JOIN app_user u ON u.organization_id=c.organization_id AND u.id=c.claimed_by WHERE c.organization_id=${ctx.organizationId} AND c.id=${id}`);
  return row ? makeExpenseResource(row.id, row.organizationId, row.claimedBy, row.departmentId, row.teamId) : null;
}

export function registerExpenseRoutes(): void {
  route({ method: 'GET', path: '/api/payables/claims/mine', action: 'payables:claim', module: 'payables', handler: async ({ ctx, query }) => listMine(ctx, expenseListSchema.parse(query)) });
  // Collection reads cannot use the approval-bearing action: SoD requires an
  // individual claim resource for that action. The service still applies the
  // approval visibility filter, while each approve/reject mutation performs
  // the resource-level approval check below.
  route({ method: 'GET', path: '/api/payables/claims/approvals', action: 'payables:claim', module: 'payables', handler: async ({ ctx, query }) => listApprovals(ctx, expenseListSchema.parse(query)) });
  route({ method: 'POST', path: '/api/payables/claims', action: 'payables:claim', module: 'payables', status: 201, handler: async ({ ctx, body }) => createClaim(ctx, createExpenseSchema.parse(body ?? {})) });
  route({ method: 'GET', path: '/api/payables/claims/:id', action: 'payables:claim', module: 'payables', resourceParam: 'id', loadResource: loadClaim, handler: async ({ ctx, params }) => getClaim(ctx, params['id']!) });
  route({ method: 'PATCH', path: '/api/payables/claims/:id', action: 'payables:claim', module: 'payables', resourceParam: 'id', loadResource: loadClaim, handler: async ({ ctx, params, body }) => updateClaim(ctx, params['id']!, updateExpenseSchema.parse(body ?? {})) });
  route({ method: 'DELETE', path: '/api/payables/claims/:id', action: 'payables:claim', module: 'payables', resourceParam: 'id', loadResource: loadClaim, handler: async ({ ctx, params }) => { await deleteClaim(ctx, params['id']!); return null; } });
  route({ method: 'POST', path: '/api/payables/claims/:id/approve', action: 'payables:approve-claim', module: 'payables', resourceParam: 'id', loadResource: loadClaim, handler: async ({ ctx, params }) => { await approveClaim(ctx, params['id']!); return null; } });
  route({ method: 'POST', path: '/api/payables/claims/:id/reject', action: 'payables:approve-claim', module: 'payables', resourceParam: 'id', loadResource: loadClaim, handler: async ({ ctx, params, body }) => { await rejectClaim(ctx, params['id']!, rejectExpenseSchema.parse(body ?? {})); return null; } });
  route({ method: 'GET', path: '/api/payables/claims/:claimId/attachments/:attachmentId', action: 'payables:claim', module: 'payables', resourceParam: 'claimId', loadResource: loadClaim, handler: async ({ ctx, params, res }) => { const file = await downloadAttachment(ctx, params['claimId']!, params['attachmentId']!); res.setHeader('Content-Type', file.mimeType); res.setHeader('Content-Disposition', `inline; filename="${file.originalFilename.replaceAll('"', '')}"`); res.send(file.body); return null; } });
}
