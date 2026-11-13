import {
  PLATFORM_MODULE_GROUPS,
  PLATFORM_SELECTABLE_MODULES,
  isPlatformSelectableModule,
  platformModuleGroupOf,
  type PlatformModuleCatalogEntry,
  type PlatformModuleChangeResult,
} from '@tapcrm/contracts';
import { PlatformValidationError, PlatformNotFoundError } from '../errors.js';
import * as repo from './repository.js';
import { planModuleChanges } from './plan.js';
import { platformDb, setTenantContext } from '../dal/db.js';
import { sql } from '../dal/sql.js';
import { bootstrapOrganization } from '../organizations/bootstrap.js';
import { provisionDefaultPositionPolicies } from '../organizations/policy-matrix.js';
import { ORGANIZATION_TEMPLATE } from '../organizations/template.js';
import { getOrganization } from '../organizations/repository.js';
import { provisionAccountingFoundation } from '../../modules/finance/accounting/provisioning.js';
import { provisionSeoRules } from '../../modules/seo-intelligence/provisioning.js';

/**
 * Master Admin module groups. The list lives in @tapcrm/contracts so the
 * Master Admin screen and this service cannot drift apart — a module the API
 * gates must always have a switch (see contracts/src/platform-modules.ts).
 */
export { PLATFORM_MODULE_GROUPS };

/** `GET /platform/modules` — every selectable module, in Master Admin order. */
export async function catalog(): Promise<PlatformModuleCatalogEntry[]> {
  const [modules, edges] = await Promise.all([repo.listModules(), repo.listAllDependencies()]);
  const byKey = new Map(modules.map((module) => [module.key, module]));
  const keyById = new Map(modules.map((module) => [module.id, module.key]));
  return PLATFORM_SELECTABLE_MODULES.flatMap((key) => {
    const module = byKey.get(key);
    if (!module) return [];
    // Core modules stand alone (plan.ts); their edges never constrain a toggle.
    const dependsOn = module.isCore ? [] : edges
      .filter((edge) => edge.moduleId === module.id)
      .map((edge) => keyById.get(edge.dependsOnModuleId))
      // Foundation modules (identity, …) are always on; listing them is noise.
      .filter((dep): dep is string => dep !== undefined && isPlatformSelectableModule(dep))
      .sort();
    return [
      {
        id: module.id,
        key,
        name: module.name,
        description: module.description,
        status: module.status,
        version: module.version,
        isCore: module.isCore,
        group: platformModuleGroupOf(key)!.key,
        dependsOn,
      },
    ];
  });
}

function normalizeKeys(keys: readonly string[]): string[] {
  return [...new Set(keys.map((key) => key.trim().toLowerCase()).filter(Boolean))];
}

function assertSelectable(keys: readonly string[]): void {
  const unsupported = keys.filter((key) => !isPlatformSelectableModule(key));
  if (unsupported.length)
    throw new PlatformValidationError(
      `Unsupported modules: ${unsupported.join(', ')}. Only ${PLATFORM_MODULE_GROUPS.map(
        (group) => group.label,
      ).join(', ')} modules can be selected for a company.`,
    );
}

export async function validateSelectedModules(keys: readonly string[]) {
  const unique = normalizeKeys(keys);
  assertSelectable(unique);
  const modules = await repo.getModulesByKeys(unique);
  const found = new Set(modules.map((m) => m.key));
  const missing = unique.filter((k) => !found.has(k));
  if (missing.length)
    throw new PlatformValidationError(
      `Unknown or inactive modules: ${missing.join(', ')}`,
    );
  return modules;
}

export async function listOrganizationModules(orgId: string) {
  return repo.getOrganizationModules(orgId);
}

/** Single-module toggle, kept for `POST …/modules/:moduleKey/enable|disable`. */
export async function changeOrganizationModule(
  orgId: string,
  key: string,
  enabled: boolean,
  actorId: string,
): Promise<PlatformModuleChangeResult> {
  if (!isPlatformSelectableModule(key.trim().toLowerCase()))
    throw new PlatformValidationError(
      `Module "${key}" is managed automatically or is not available for company toggles`,
    );
  return applyOrganizationModuleChanges(
    orgId,
    enabled ? { enable: [key] } : { disable: [key] },
    actorId,
  );
}

/**
 * `POST /platform/organizations/:id/modules` — switch any number of modules on
 * and off for one company in a single transaction.
 *
 *   - Enabling a module enables everything it depends on (and the core
 *     modules), then provisions starter structure and position policies, so
 *     late enablement behaves like initial provisioning.
 *   - Core modules cannot be disabled.
 *   - A module cannot be disabled while a module that stays enabled depends
 *     on it; the error names the dependents so the admin can include them.
 *
 * All-or-nothing: either every requested change is applied or none is, so a
 * group toggle can no longer stop half-way and leave a company partly set up.
 */
export async function applyOrganizationModuleChanges(
  orgId: string,
  request: { enable?: readonly string[] | undefined; disable?: readonly string[] | undefined },
  actorId: string,
): Promise<PlatformModuleChangeResult> {
  const enable = normalizeKeys(request.enable ?? []);
  const disable = normalizeKeys(request.disable ?? []);
  if (enable.length === 0 && disable.length === 0)
    throw new PlatformValidationError('Choose at least one module to enable or disable');
  assertSelectable([...enable, ...disable]);
  const both = enable.filter((key) => disable.includes(key));
  if (both.length)
    throw new PlatformValidationError(
      `Modules cannot be enabled and disabled at once: ${both.join(', ')}`,
    );
  if (!(await getOrganization(orgId)))
    throw new PlatformNotFoundError('Organization not found');

  const [all, edges, current] = await Promise.all([
    repo.listModules(),
    repo.listAllDependencies(),
    repo.getOrganizationModules(orgId),
  ]);
  const byKey = new Map(all.map((item) => [item.key, item]));
  const { enableClosure, newlyEnabled, newlyDisabled, disableRows } = planModuleChanges({
    modules: all,
    edges,
    current,
    enable,
    disable,
  });

  if (newlyEnabled.length > 0 || disableRows.length > 0) {
    await platformDb.transaction(
      'organization-provisioning',
      'change organization modules and provision starter structure',
      async (tx) => {
        await setTenantContext(tx, orgId);
        for (const key of newlyEnabled) {
          await tx.query(sql`
            INSERT INTO organization_module
              (organization_id, module_id, status, enabled_at, disabled_at, enabled_by, disabled_by)
            VALUES (${orgId}, ${byKey.get(key)!.id}, 'enabled', now(), NULL, ${actorId}, NULL)
            ON CONFLICT (organization_id, module_id) DO UPDATE SET
              status = 'enabled', enabled_at = now(), disabled_at = NULL,
              enabled_by = ${actorId}, disabled_by = NULL
          `);
        }
        for (const key of disableRows) {
          await tx.query(sql`
            INSERT INTO organization_module
              (organization_id, module_id, status, enabled_at, disabled_at, enabled_by, disabled_by)
            VALUES (${orgId}, ${byKey.get(key)!.id}, 'disabled', NULL, now(), NULL, ${actorId})
            ON CONFLICT (organization_id, module_id) DO UPDATE SET
              status = 'disabled', disabled_at = now(), disabled_by = ${actorId}
          `);
        }
        if (enable.length === 0) return;

        // Same provisioning boundary as initial company creation.
        await bootstrapOrganization(tx, orgId, [...enableClosure]);
        // Bootstrap reaches the positions of the departments a module belongs
        // to. A module every employee uses for themselves (TA, advances,
        // penalties) must reach every position the company already has, so the
        // newly enabled modules' defaults go to all of them. Only missing rows
        // are added, and only for modules that were off until now.
        if (newlyEnabled.length > 0) {
          const existing = await tx.query<{ id: string; code: string }>(sql`
            SELECT id, code FROM position WHERE organization_id = ${orgId} AND status = 'active'
          `);
          const positionIds = new Map(existing.map((row) => [row.code, row.id]));
          await provisionDefaultPositionPolicies(
            tx,
            orgId,
            newlyEnabled,
            ORGANIZATION_TEMPLATE.positions.filter((position) => positionIds.has(position.code)),
            positionIds,
          );
        }
        if (enableClosure.has('accounting')) await provisionAccountingFoundation(tx, orgId);
        if (enableClosure.has('seo-intelligence')) await provisionSeoRules(tx, orgId);
      },
    );
  }

  const modules = await repo.getOrganizationModules(orgId);
  return {
    organizationId: orgId,
    enabled: newlyEnabled,
    disabled: newlyDisabled,
    modules: modules.map((row) => ({
      key: row.key,
      name: row.name,
      isCore: row.isCore,
      status: row.status,
      enabledAt: row.enabledAt ? new Date(row.enabledAt).toISOString() : null,
      disabledAt: row.disabledAt ? new Date(row.disabledAt).toISOString() : null,
    })),
  };
}
