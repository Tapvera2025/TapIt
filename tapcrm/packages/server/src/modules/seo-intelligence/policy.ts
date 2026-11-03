import { z } from 'zod';
import { registerContentPolicies } from './content-policy.js';
import {
  MATCH_NOTHING,
  registerResourcePolicy,
  type ResourcePolicy,
} from '@tapcrm/authz';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { RequestContext } from '../../platform/dal/context.js';

function seoSitePolicy(): ResourcePolicy {
  return {
    resourceType: 'seo_site',
    domain: 'business',
    async check(ctx, _action, resource, _scope) {
      if (resource['organizationId'] !== ctx.organizationId) return false;
      if (ctx.principal.accountType === 'client') return false;
      return true;
    },
    async filter(ctx, _action, _scope) {
      if (ctx.principal.accountType === 'client') return MATCH_NOTHING;
      return sql`s.organization_id = ${ctx.organizationId}`;
    },
    participantFields: () => [],
    initiatorField: () => null,
  };
}

function seoFindingPolicy(): ResourcePolicy {
  return {
    resourceType: 'seo_finding',
    domain: 'business',
    async check(ctx, _action, resource, _scope) {
      if (resource['organizationId'] !== ctx.organizationId) return false;
      if (ctx.principal.accountType === 'client') return false;
      return true;
    },
    async filter(ctx, _action, _scope) {
      if (ctx.principal.accountType === 'client') return MATCH_NOTHING;
      return sql`f.organization_id = ${ctx.organizationId}`;
    },
    participantFields: () => [],
    initiatorField: () => null,
  };
}

export async function loadSiteResource(ctx: RequestContext, siteId: string) {
  if (!z.string().uuid().safeParse(siteId).success) return null;
  const row = await db.maybeOne<{ id: string; organizationId: string }>(
    ctx,
    sql`
    SELECT id, organization_id FROM seo_sites
    WHERE organization_id = ${ctx.organizationId} AND id = ${siteId}
  `,
  );
  if (!row) return null;
  return { type: 'seo_site' as const, id: row.id, organizationId: row.organizationId };
}

export function registerSeoPolicies(): void {
  registerContentPolicies();
  registerResourcePolicy(seoSitePolicy());
  registerResourcePolicy(seoFindingPolicy());
}
