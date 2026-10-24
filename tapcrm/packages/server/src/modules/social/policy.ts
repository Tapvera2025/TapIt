import { z } from 'zod';
import {
  authorize,
  MATCH_NOTHING,
  registerResourcePolicy,
  visibilityFilter,
  type Resource,
  type ResourcePolicy,
} from '@tapcrm/authz';
import { createRequestContext, type RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { requireModuleEnabled } from '../../platform/module-entitlement.js';
import { loadActivePrincipal } from '../identity/facade.js';

function policy(resourceType: string): ResourcePolicy {
  return {
    resourceType,
    domain: 'business',
    async check(ctx, _action, resource, scope) {
      if (resource['organizationId'] !== ctx.organizationId || scope === 'all-people')
        return false;
      if (ctx.principal.accountType === 'client')
        return resource['clientId'] === ctx.principal.clientId;
      return (
        resource['clientCreatedBy'] === ctx.principal.id ||
        (Array.isArray(resource['projectAssigneeIds']) &&
          resource['projectAssigneeIds'].includes(ctx.principal.id))
      );
    },
    async filter(ctx, _action, scope) {
      if (scope === 'all-people') return MATCH_NOTHING;
      if (ctx.principal.accountType === 'client')
        return sql`c.id = ${ctx.principal.clientId}`;
      return sql`(c.created_by = ${ctx.principal.id} OR EXISTS (
        SELECT 1 FROM project p JOIN project_assignee pa ON pa.organization_id = p.organization_id AND pa.project_id = p.id
        WHERE p.organization_id = c.organization_id AND p.client_id = c.id AND pa.user_id = ${ctx.principal.id}
      ))`;
    },
    participantFields: () => ['clientCreatedBy', 'projectAssigneeIds'],
    initiatorField: (action) => (action === 'social:approve' ? 'createdBy' : null),
  };
}

export function registerSocialPolicies(): void {
  registerResourcePolicy(policy('socialWorkspace'));
  registerResourcePolicy(policy('socialPost'));
}

export async function loadWorkspaceResource(
  ctx: RequestContext,
  clientId: string,
): Promise<Resource | null> {
  if (!z.string().uuid().safeParse(clientId).success) return null;
  const client = await db.maybeOne<{ id: string; createdBy: string }>(
    ctx,
    sql`
    SELECT id, created_by FROM client WHERE organization_id = ${ctx.organizationId} AND id = ${clientId}
  `,
  );
  if (!client) return null;
  const assignees = await db.query<{ userId: string }>(
    ctx,
    sql`
    SELECT DISTINCT pa.user_id FROM project p JOIN project_assignee pa ON pa.organization_id = p.organization_id AND pa.project_id = p.id
    WHERE p.organization_id = ${ctx.organizationId} AND p.client_id = ${clientId}
  `,
  );
  return {
    type: 'socialWorkspace',
    id: clientId,
    organizationId: ctx.organizationId,
    clientId,
    clientCreatedBy: client.createdBy,
    projectAssigneeIds: assignees.map((r) => r.userId),
  };
}

export async function loadPostResource(
  ctx: RequestContext,
  postId: string,
): Promise<Resource | null> {
  if (!z.string().uuid().safeParse(postId).success) return null;
  const post = await db.maybeOne<{ clientId: string; createdBy: string }>(
    ctx,
    sql`
    SELECT client_id, created_by FROM social_post WHERE organization_id = ${ctx.organizationId} AND id = ${postId}
  `,
  );
  if (!post) return null;
  const workspace = await loadWorkspaceResource(ctx, post.clientId);
  return workspace
    ? { ...workspace, type: 'socialPost', id: postId, createdBy: post.createdBy }
    : null;
}

/** Scope filtering happens before reading existing CRM clients; no duplicate client store. */
export async function listSocialClients(
  ctx: RequestContext,
  query: { search?: string | undefined; page: number; pageSize: number },
) {
  const filter = await visibilityFilter(ctx, 'social:view', 'socialWorkspace');
  const search = `%${query.search ?? ''}%`;
  const where = sql`c.organization_id = ${ctx.organizationId} AND (${filter}) AND c.status = 'active'
    AND (c.client_name ILIKE ${search} OR c.business_name ILIKE ${search})`;
  const items = await db.query<{
    id: string;
    clientName: string;
    businessName: string;
    timezone: string;
  }>(
    ctx,
    sql`
    SELECT c.id, c.client_name, c.business_name, c.timezone FROM client c WHERE ${where}
    ORDER BY c.business_name, c.id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
  `,
  );
  const { count } = await db.one<{ count: string }>(
    ctx,
    sql`SELECT count(*)::text AS count FROM client c WHERE ${where}`,
  );
  return {
    items,
    total: Number(count),
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(Number(count) / query.pageSize)),
  };
}

/** Delayed publishing uses current account state, permissions and client assignments. */
export async function authorizeSocialActor(
  ctx: RequestContext,
  clientId: string,
  userId: string,
  action: 'social:publish' | 'social:approve',
  postId?: string,
): Promise<boolean> {
  const principal = await loadActivePrincipal(ctx, userId);
  if (
    !principal ||
    principal.accountType === 'service' ||
    (principal.accountType === 'client' && action === 'social:publish')
  )
    return false;
  const actor = createRequestContext({
    organizationId: ctx.organizationId,
    principal,
    requestId: ctx.requestId,
  });
  const resource =
    action === 'social:approve'
      ? postId
        ? await loadPostResource(actor, postId)
        : null
      : await loadWorkspaceResource(actor, clientId);
  if (!resource || resource['clientId'] !== clientId) return false;
  try {
    await requireModuleEnabled(actor, 'social');
    await authorize(actor, action, resource);
    return true;
  } catch {
    return false;
  }
}

export async function authorizePublishingActor(
  ctx: RequestContext,
  clientId: string,
  userId: string,
): Promise<boolean> {
  return authorizeSocialActor(ctx, clientId, userId, 'social:publish');
}

export async function getSocialClient(ctx: RequestContext, clientId: string) {
  return db.one<{
    id: string;
    clientName: string;
    businessName: string;
    timezone: string;
  }>(
    ctx,
    sql`
    SELECT id,client_name,business_name,timezone FROM client WHERE organization_id = ${ctx.organizationId} AND id = ${clientId}
  `,
  );
}
