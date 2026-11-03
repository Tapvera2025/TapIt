import { MATCH_NOTHING, registerResourcePolicy, type Resource } from '@tapcrm/authz';
import { globalAccess } from '@tapcrm/contracts';
import { z } from 'zod';
import { ApplicationError } from '../../errors.js';
import { db, type Tx } from '../../platform/dal/db.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { sql } from '../../platform/dal/sql.js';

export function isContentStaff(ctx: Pick<RequestContext, 'principal'>) {
  return (
    ctx.principal.accountType === 'employee' ||
    ctx.principal.accountType === 'super-admin'
  );
}
export function canAccessContentSite(
  ctx: Pick<RequestContext, 'principal' | 'organizationId'>,
  site: Resource,
) {
  return (
    isContentStaff(ctx) &&
    site['organizationId'] === ctx.organizationId &&
    (globalAccess(ctx.principal) ||
      site['clientId'] === null ||
      site['clientAccess'] === true)
  );
}
export async function loadContentSite(
  ctx: RequestContext,
  siteId: string,
): Promise<Resource | null> {
  if (!z.string().uuid().safeParse(siteId).success) return null;
  const site = await db.maybeOne<{
    id: string;
    organizationId: string;
    clientId: string | null;
    clientAccess: boolean;
  }>(
    ctx,
    sql`
    SELECT s.id, s.organization_id, s.client_id,
      (c.created_by = ${ctx.principal.id} OR EXISTS (
        SELECT 1 FROM project p JOIN project_assignee pa
          ON pa.organization_id = p.organization_id AND pa.project_id = p.id
        WHERE p.organization_id = s.organization_id AND p.client_id = s.client_id AND pa.user_id = ${ctx.principal.id}
      )) AS client_access
    FROM seo_sites s LEFT JOIN client c ON c.organization_id = s.organization_id AND c.id = s.client_id
    WHERE s.organization_id = ${ctx.organizationId} AND s.id = ${siteId} AND s.active = true
  `,
  );
  return site ? { ...site, type: 'seo_content_site' } : null;
}
export async function requireContentSite(ctx: RequestContext, siteId: string) {
  const site = await loadContentSite(ctx, siteId);
  if (!site || !canAccessContentSite(ctx, site))
    throw new ApplicationError(
      'This content workspace is not available to you.',
      404,
      'CONTENT_NOT_FOUND',
    );
  return site;
}
export async function loadContentReviewResource(
  ctx: RequestContext,
  documentId: string,
): Promise<Resource | null> {
  if (!z.string().uuid().safeParse(documentId).success) return null;
  const doc = await db.maybeOne<{
    id: string;
    siteId: string;
    ownerId: string;
    reviewerId: string | null;
  }>(
    ctx,
    sql`
    SELECT id, site_id, owner_id, reviewer_id FROM seo_content_documents
    WHERE organization_id = ${ctx.organizationId} AND id = ${documentId}
  `,
  );
  if (!doc) return null;
  const site = await loadContentSite(ctx, doc.siteId);
  return site && canAccessContentSite(ctx, site)
    ? { ...doc, organizationId: ctx.organizationId, type: 'seo_content_document' }
    : null;
}
export function registerContentPolicies() {
  registerResourcePolicy({
    resourceType: 'seo_content_site',
    domain: 'business',
    check: async (ctx, _action, resource) => canAccessContentSite(ctx, resource),
    // Site routes load one resource. Lists of documents additionally filter assignments.
    filter: async () => MATCH_NOTHING,
    participantFields: () => [],
    initiatorField: () => null,
  });
  registerResourcePolicy({
    resourceType: 'seo_content_document',
    domain: 'business',
    check: async (ctx, _action, resource) =>
      isContentStaff(ctx) &&
      resource['organizationId'] === ctx.organizationId &&
      (globalAccess(ctx.principal) ||
        resource['ownerId'] === ctx.principal.id ||
        resource['reviewerId'] === ctx.principal.id),
    filter: async () => MATCH_NOTHING,
    participantFields: () => ['ownerId', 'reviewerId'],
    initiatorField: () => 'ownerId',
  });
}

/** Assignment choices never grant action permissions. Client scope is checked again at use. */
export async function eligibleContentStaff(tx: Tx, ctx: RequestContext, siteId: string) {
  return tx.query<{ id: string; name: string }>(sql`
    SELECT u.id, u.full_name AS name FROM app_user u JOIN seo_sites s ON s.organization_id = u.organization_id
    LEFT JOIN client c ON c.organization_id = s.organization_id AND c.id = s.client_id
    WHERE s.organization_id = ${ctx.organizationId} AND s.id = ${siteId} AND u.status = 'active'
      AND u.account_type IN ('employee','super-admin') AND
      (u.account_type = 'super-admin' OR s.client_id IS NULL OR c.created_by = u.id OR EXISTS (
        SELECT 1 FROM project p JOIN project_assignee pa ON pa.organization_id = p.organization_id AND pa.project_id = p.id
        WHERE p.organization_id = s.organization_id AND p.client_id = s.client_id AND pa.user_id = u.id
      )) ORDER BY u.full_name, u.id
  `);
}
