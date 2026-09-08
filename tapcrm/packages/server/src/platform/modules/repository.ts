import { platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export interface ModuleRow {
  id: string;
  key: string;
  name: string;
  description: string;
  status: string;
  version: string;
  isCore: boolean;
}

export async function listModules(): Promise<ModuleRow[]> {
  return platformDb.query(
    'health-check',
    'list platform module catalog',
    sql`SELECT id, key, name, description, status, version, is_core FROM module WHERE status = 'active' ORDER BY is_core DESC, name ASC`,
  );
}

export async function getModulesByKeys(keys: readonly string[]): Promise<ModuleRow[]> {
  if (keys.length === 0) return [];
  return platformDb.query(
    'organization-provisioning',
    'resolve selected module keys',
    sql`SELECT id, key, name, description, status, version, is_core FROM module WHERE key = ANY(${keys}::text[]) AND status = 'active'`,
  );
}

export async function listDependencies(moduleIds: readonly string[]) {
  if (moduleIds.length === 0) return [];
  return platformDb.query<{ moduleId: string; dependsOnModuleId: string }>(
    'organization-provisioning',
    'resolve module dependencies',
    sql`
    SELECT module_id, depends_on_module_id FROM module_dependency WHERE module_id = ANY(${moduleIds}::uuid[])
  `,
  );
}

export async function getOrganizationModules(organizationId: string) {
  return platformDb.query(
    'health-check',
    'read organization module entitlements',
    sql`
    SELECT m.key, m.name, m.is_core AS is_core, om.status, om.enabled_at, om.disabled_at
    FROM organization_module om JOIN module m ON m.id = om.module_id
    WHERE om.organization_id = ${organizationId}
    ORDER BY m.name
  `,
  );
}

export async function setEntitlement(
  organizationId: string,
  moduleKey: string,
  enabled: boolean,
  actorId: string,
) {
  return platformDb.one(
    'organization-provisioning',
    'change organization module entitlement',
    sql`
    INSERT INTO organization_module(organization_id, module_id, status, enabled_at, disabled_at, enabled_by, disabled_by)
    SELECT ${organizationId}, id, ${enabled ? 'enabled' : 'disabled'}, ${enabled ? new Date() : null}, ${enabled ? null : new Date()}, ${enabled ? actorId : null}, ${enabled ? null : actorId}
    FROM module WHERE key = ${moduleKey}
    ON CONFLICT (organization_id, module_id) DO UPDATE SET
      status = EXCLUDED.status,
      enabled_at = EXCLUDED.enabled_at,
      disabled_at = EXCLUDED.disabled_at,
      enabled_by = EXCLUDED.enabled_by,
      disabled_by = EXCLUDED.disabled_by
    RETURNING organization_id, module_id, status
  `,
  );
}
