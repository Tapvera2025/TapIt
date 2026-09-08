import { PlatformValidationError, PlatformNotFoundError } from '../errors.js';
import * as repo from './repository.js';

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
  return repo.setEntitlement(orgId, key, enabled, actorId);
}
