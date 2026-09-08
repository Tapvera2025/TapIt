import type { RequestContext } from './dal/context.js';
import { platformDb } from './dal/db.js';
import { sql } from './dal/sql.js';
import { PlatformForbiddenError } from './errors.js';

/**
 * Server-side enforcement of company module entitlements.
 * The UI may hide disabled modules, but this guard is the security boundary.
 */
export async function requireModuleEnabled(
  ctx: RequestContext,
  moduleKey: string,
): Promise<void> {
  const row = await platformDb.maybeOne<{ ok: boolean }>(
    'health-check',
    'enforce tenant module entitlement',
    sql`
    SELECT true AS ok
    FROM organization_module om
    JOIN module m ON m.id = om.module_id
    WHERE om.organization_id = ${ctx.organizationId}
      AND m.key = ${moduleKey}
      AND om.status = 'enabled'
    LIMIT 1
  `,
  );
  if (!row)
    throw new PlatformForbiddenError(
      `Module "${moduleKey}" is not enabled for this organization`,
    );
}

export async function enabledModuleKeys(organizationId: string): Promise<string[]> {
  const rows = await platformDb.query<{ key: string }>(
    'health-check',
    'resolve enabled modules for tenant',
    sql`
    SELECT m.key FROM organization_module om JOIN module m ON m.id = om.module_id
    WHERE om.organization_id = ${organizationId} AND om.status = 'enabled' ORDER BY m.key
  `,
  );
  return rows.map((r) => r.key);
}
