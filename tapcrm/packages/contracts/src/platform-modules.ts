import { MODULES, type ModuleName } from './module.js';

/**
 * Master Admin module catalogue — the ONE list of modules a platform admin can
 * switch on or off for a company, and how the Master Admin screen groups them.
 *
 * The server (`platform/modules/service.ts`) uses it to validate toggles and
 * company provisioning; the Master Admin screen renders it. Keeping a copy in
 * either place is how modules ended up gated by the API ("Module … is not
 * enabled for this organization") with no switch to turn them on.
 *
 * Every module in `MODULES` is in exactly one of:
 *   - a group below                (selectable per company)
 *   - PLATFORM_AUTOMATIC_MODULES   (always on; enabled for every company)
 *   - PLATFORM_UNRELEASED_MODULES  (catalogued, nothing to switch on yet)
 * `platform-modules.test.ts` fails the build when a new module is added to
 * `MODULES` without being placed here.
 *
 * A module can be in a group and still be "core" in the database catalogue
 * (`module.is_core`, today Tasks and Advances): it is then shown as always on
 * and cannot be disabled. The database flag, served by `GET /platform/modules`,
 * is the authority for that. Note: Advances must stay core until
 * `GET /api/org/currency-settings` stops using `advance:view-own` as its
 * "every employee" action, or companies without Advances lose currency settings.
 */
export const PLATFORM_MODULE_GROUPS = [
  {
    key: 'hr',
    label: 'HR',
    moduleKeys: [
      'employee-directory',
      'onboarding',
      'live-status',
      'attendance',
      'break-management',
      'shifts',
      'biometric',
      'leave',
      'holidays',
      'ta',
      'payroll',
      'advance',
      'penalties',
      'performance',
      'recruitment',
    ],
  },
  {
    key: 'sales',
    label: 'Sales',
    moduleKeys: [
      'territories',
      'leads',
      'callbacks',
      'handovers',
      'deals',
      'approvals',
      'telephony',
      'lead-imports',
    ],
  },
  {
    key: 'development',
    label: 'Development',
    moduleKeys: ['handoff', 'projects', 'tasks', 'resource-planning', 'delivery'],
  },
  {
    key: 'client',
    label: 'Client',
    moduleKeys: ['clients', 'social', 'post-closure', 'client-portal', 'meetings'],
  },
  {
    key: 'finance',
    label: 'Finance',
    moduleKeys: ['billing-terms', 'invoicing', 'payments', 'receivables', 'payables', 'accounting'],
  },
  {
    key: 'marketing',
    label: 'Marketing',
    moduleKeys: ['seo-intelligence'],
  },
] as const satisfies readonly {
  readonly key: string;
  readonly label: string;
  readonly moduleKeys: readonly ModuleName[];
}[];

export type PlatformModuleGroup = (typeof PLATFORM_MODULE_GROUPS)[number];
export type PlatformModuleGroupKey = PlatformModuleGroup['key'];
export type PlatformSelectableModule = PlatformModuleGroup['moduleKeys'][number];

/** Enabled for every company at provisioning and never toggled (is_core). */
export const PLATFORM_AUTOMATIC_MODULES = [
  'identity',
  'organization',
  'access-management',
  'audit',
  'system-administration',
  'chat',
  'notifications',
  'workspace',
] as const satisfies readonly ModuleName[];

/**
 * In the PRD catalogue but with no routes or screens yet. Not offered to
 * Master Admin, so a company can never "enable" a module that does nothing.
 * Move a module into a group above when its first feature ships.
 */
export const PLATFORM_UNRELEASED_MODULES = [
  'project-communication',
  'documents',
  'reporting',
] as const satisfies readonly ModuleName[];

export const PLATFORM_SELECTABLE_MODULES: readonly PlatformSelectableModule[] =
  PLATFORM_MODULE_GROUPS.flatMap((group) => group.moduleKeys);

const SELECTABLE: ReadonlySet<string> = new Set(PLATFORM_SELECTABLE_MODULES);

export function isPlatformSelectableModule(key: string): key is PlatformSelectableModule {
  return SELECTABLE.has(key);
}

export function platformModuleGroupOf(key: string): PlatformModuleGroup | undefined {
  return PLATFORM_MODULE_GROUPS.find((group) =>
    (group.moduleKeys as readonly string[]).includes(key),
  );
}

/** Modules from `MODULES` that are in none of the three lists — must be empty. */
export function unplacedPlatformModules(): ModuleName[] {
  const placed = new Set<string>([
    ...PLATFORM_SELECTABLE_MODULES,
    ...PLATFORM_AUTOMATIC_MODULES,
    ...PLATFORM_UNRELEASED_MODULES,
  ]);
  return MODULES.filter((key) => !placed.has(key));
}

/* ---- Master Admin API shapes ---------------------------------------------- */

/** One row of `GET /platform/modules`, in Master Admin display order. */
export interface PlatformModuleCatalogEntry {
  readonly id: string;
  readonly key: PlatformSelectableModule;
  readonly name: string;
  readonly description: string;
  readonly status: string;
  readonly version: string;
  /** Always on for every company; Master Admin cannot disable it. */
  readonly isCore: boolean;
  readonly group: PlatformModuleGroupKey;
  /** Selectable modules this one needs; enabling it enables them too. */
  readonly dependsOn: readonly string[];
}

/** Body of `POST /platform/organizations/:id/modules`. Applied atomically. */
export interface PlatformModuleChangeRequest {
  readonly enable?: readonly string[];
  readonly disable?: readonly string[];
}

/** One row of `GET /platform/organizations/:id/modules`. */
export interface PlatformOrganizationModule {
  readonly key: string;
  readonly name: string;
  readonly isCore: boolean;
  readonly status: 'enabled' | 'disabled';
  readonly enabledAt: string | null;
  readonly disabledAt: string | null;
}

export interface PlatformModuleChangeResult {
  readonly organizationId: string;
  /** Every module switched on by this change, including dependencies. */
  readonly enabled: readonly string[];
  /** Every module switched off by this change. */
  readonly disabled: readonly string[];
  /** The company's entitlements after the change. */
  readonly modules: readonly PlatformOrganizationModule[];
}
