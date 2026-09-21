import { PlatformValidationError, PlatformNotFoundError } from '../errors.js';
import * as repo from './repository.js';
import { platformDb, setTenantContext } from '../dal/db.js';
import { sql } from '../dal/sql.js';
import { bootstrapOrganization } from '../organizations/bootstrap.js';

export const PLATFORM_MODULE_GROUPS = [
  { key: 'hr', label: 'HR', moduleKeys: ['employee-directory', 'onboarding', 'live-status', 'attendance', 'break-management', 'shifts', 'biometric', 'leave', 'holidays', 'payroll', 'performance'] },
  { key: 'sales', label: 'Sales', moduleKeys: ['territories', 'leads', 'callbacks', 'handovers', 'deals', 'approvals'] },
  { key: 'development', label: 'Development', moduleKeys: ['handoff', 'projects', 'tasks', 'resource-planning', 'delivery'] },
  { key: 'client', label: 'Client', moduleKeys: ['clients', 'post-closure', 'client-portal'] },
  { key: 'finance', label: 'Finance', moduleKeys: ['billing-terms', 'invoicing', 'payments', 'receivables', 'payables', 'accounting'] },
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
      return { organizationId: orgId, moduleId: module.id, status: 'enabled' };
    },
  );
}
