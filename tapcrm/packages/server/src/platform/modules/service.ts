import { PlatformValidationError, PlatformNotFoundError } from '../errors.js';
import * as repo from './repository.js';
import { platformDb, setTenantContext } from '../dal/db.js';
import { sql } from '../dal/sql.js';
import { bootstrapOrganization } from '../organizations/bootstrap.js';
import { provisionDefaultPositionPolicies } from '../organizations/policy-matrix.js';
import { ORGANIZATION_TEMPLATE } from '../organizations/template.js';
import { provisionAccountingFoundation } from '../../modules/finance/accounting/provisioning.js';
import { provisionSeoRules } from '../../modules/seo-intelligence/provisioning.js';

export const PLATFORM_MODULE_GROUPS = [
  // TA, advances and penalties are switched on per company like the rest of HR;
  // enabling one provisions its position policies (bootstrapOrganization).
  { key: 'hr', label: 'HR', moduleKeys: ['employee-directory', 'onboarding', 'live-status', 'attendance', 'break-management', 'shifts', 'biometric', 'leave', 'holidays', 'ta', 'payroll', 'advance', 'penalties', 'performance', 'recruitment'] },
  { key: 'sales', label: 'Sales', moduleKeys: ['territories', 'leads', 'callbacks', 'handovers', 'deals', 'approvals', 'telephony', 'lead-imports'] },
  { key: 'development', label: 'Development', moduleKeys: ['handoff', 'projects', 'tasks', 'resource-planning', 'delivery'] },
  { key: 'client', label: 'Client', moduleKeys: ['clients', 'social', 'post-closure', 'client-portal', 'meetings'] },
  { key: 'finance', label: 'Finance', moduleKeys: ['billing-terms', 'invoicing', 'payments', 'receivables', 'payables', 'accounting'] },
  { key: 'marketing', label: 'Marketing', moduleKeys: ['seo-intelligence'] },
] as const;

const PLATFORM_SELECTABLE_MODULE_KEYS = PLATFORM_MODULE_GROUPS.flatMap(
  (group) => group.moduleKeys,
);

function isPlatformSelectableModuleName(value: string): boolean {
  return PLATFORM_SELECTABLE_MODULE_KEYS.includes(value as never);
}

export async function catalog() {
  const modules = await repo.listModules();
  const byKey = new Map(modules.map((module) => [module.key, module]));
  return PLATFORM_SELECTABLE_MODULE_KEYS.flatMap((key) => {
    const module = byKey.get(key);
    return module ? [module] : [];
  });
}

export async function validateSelectedModules(keys: readonly string[]) {
  const unique = [...new Set(keys.map((k) => k.trim().toLowerCase()).filter(Boolean))];
  const unsupported = unique.filter((key) => !isPlatformSelectableModuleName(key));
  if (unsupported.length)
    throw new PlatformValidationError(
      `Unsupported modules: ${unsupported.join(', ')}. Only ${PLATFORM_MODULE_GROUPS.map(
        (group) => group.label,
      ).join(', ')} can be selected for a company.`,
    );
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

export async function changeOrganizationModule(
  orgId: string,
  key: string,
  enabled: boolean,
  actorId: string,
) {
  if (!isPlatformSelectableModuleName(key))
    throw new PlatformValidationError(
      `Module "${key}" is managed automatically or is not available for company toggles`,
    );
  const modules = await repo.getModulesByKeys([key]);
  const module = modules[0];
  if (!module) throw new PlatformNotFoundError(`Module "${key}" not found`);
  if (module.isCore && !enabled)
    throw new PlatformValidationError(`Core module "${key}" cannot be disabled`);
  if (!enabled) return repo.setEntitlement(orgId, key, false, actorId);

  // Enabling a module is also a provisioning boundary. Resolve the complete
  // dependency closure once, then update entitlements and starter structure in
  // one transaction so late enablement behaves like initial provisioning.
  const all = await repo.listModules();
  const activeById = new Map(all.map((item) => [item.id, item]));
  const selectedIds = new Set<string>([module.id]);
  const queue = [module.id];
  while (queue.length) {
    const current = queue.shift()!;
    const dependencies = await repo.listDependencies([current]);
    for (const dependency of dependencies) {
      if (!activeById.has(dependency.dependsOnModuleId))
        throw new PlatformValidationError(
          `Module "${key}" has an unavailable dependency`,
        );
      if (!selectedIds.has(dependency.dependsOnModuleId)) {
        selectedIds.add(dependency.dependsOnModuleId);
        queue.push(dependency.dependsOnModuleId);
      }
    }
  }
  const toEnable = all.filter((item) => item.isCore || selectedIds.has(item.id));
  const alreadyEnabled = new Set(
    (await repo.getOrganizationModules(orgId) as { key: string; status: string }[])
      .filter((row) => row.status === 'enabled')
      .map((row) => row.key),
  );
  const newlyEnabled = toEnable.filter((item) => !alreadyEnabled.has(item.key)).map((item) => item.key);
  return platformDb.transaction(
    'organization-provisioning',
    'enable organization module and provision starter structure',
    async (tx) => {
      await setTenantContext(tx, orgId);
      for (const item of toEnable) {
        await tx.query(sql`
          INSERT INTO organization_module
            (organization_id, module_id, status, enabled_at, disabled_at, enabled_by, disabled_by)
          VALUES (${orgId}, ${item.id}, 'enabled', now(), NULL, ${actorId}, NULL)
          ON CONFLICT (organization_id, module_id) DO UPDATE SET
            status = 'enabled', enabled_at = now(), disabled_at = NULL,
            enabled_by = ${actorId}, disabled_by = NULL
        `);
      }
      await bootstrapOrganization(tx, orgId, toEnable.map((item) => item.key));
      // Bootstrap reaches the positions of the departments the module belongs
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
      if (toEnable.some((item) => item.key === 'accounting')) {
        await provisionAccountingFoundation(tx, orgId);
      }
      if (toEnable.some((item) => item.key === 'seo-intelligence')) {
        await provisionSeoRules(tx, orgId);
      }
      return { organizationId: orgId, moduleId: module.id, status: 'enabled' };
    },
  );
}
