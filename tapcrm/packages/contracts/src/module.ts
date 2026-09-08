/**
 * The 42 modules of PRD §5.
 *
 * PRD §5 opens with "Thirty-six modules in six groups" and closes with
 * "Total: 42 modules". The counts by group (5 + 11 + 6 + 5 + 3 + 6 + 6) sum to
 * 42, and TECH.md consistently says 42, so 42 is taken as correct and the
 * opening sentence as a defect in the PRD.
 *
 * CI-11 asserts that the module catalog, the permission matrix, the build
 * classification and the screen inventory all name this same set.
 */

export const FOUNDATION_MODULES = [
  'identity',
  'organization',
  'access-management',
  'audit',
  'system-administration',
] as const;

export const PEOPLE_MODULES = [
  'employee-directory',
  'onboarding',
  'live-status',
  'attendance',
  'break-management',
  'shifts',
  'biometric',
  'leave',
  'holidays',
  'payroll',
  'performance',
] as const;

export const SALES_MODULES = [
  'territories',
  'leads',
  'callbacks',
  'handovers',
  'deals',
  'approvals',
] as const;

export const DELIVERY_MODULES = [
  'handoff',
  'projects',
  'tasks',
  'resource-planning',
  'delivery',
] as const;

export const CLIENT_MODULES = ['clients', 'post-closure', 'client-portal'] as const;

export const FINANCE_MODULES = [
  'billing-terms',
  'invoicing',
  'payments',
  'receivables',
  'payables',
  'accounting',
] as const;

export const CROSS_CUTTING_MODULES = [
  'chat',
  'project-communication',
  'documents',
  'reporting',
  'notifications',
  'workspace',
] as const;

export const MODULE_GROUPS = {
  foundation: FOUNDATION_MODULES,
  people: PEOPLE_MODULES,
  sales: SALES_MODULES,
  delivery: DELIVERY_MODULES,
  client: CLIENT_MODULES,
  finance: FINANCE_MODULES,
  'cross-cutting': CROSS_CUTTING_MODULES,
} as const;

export type ModuleGroup = keyof typeof MODULE_GROUPS;

export const MODULES = [
  ...FOUNDATION_MODULES,
  ...PEOPLE_MODULES,
  ...SALES_MODULES,
  ...DELIVERY_MODULES,
  ...CLIENT_MODULES,
  ...FINANCE_MODULES,
  ...CROSS_CUTTING_MODULES,
] as const;

export type ModuleName = (typeof MODULES)[number];

const MODULE_SET: ReadonlySet<string> = new Set(MODULES);

export function isModuleName(value: string): value is ModuleName {
  return MODULE_SET.has(value);
}

/**
 * Release phase, PRD §18. P0 is strictly first; everything depends on the
 * authorization engine.
 */
export const MODULE_PHASE: Readonly<Record<ModuleName, number>> = {
  // P0 — Foundation
  identity: 0,
  organization: 0,
  'access-management': 0,
  audit: 0,
  'system-administration': 0,
  // P1 — People
  'employee-directory': 1,
  onboarding: 1,
  'live-status': 1,
  attendance: 1,
  shifts: 1,
  biometric: 1,
  holidays: 1,
  leave: 1,
  // P2 — Payroll and Governance
  payroll: 2,
  'break-management': 2,
  performance: 2,
  // P3 — Sales
  territories: 3,
  leads: 3,
  callbacks: 3,
  handovers: 3,
  deals: 3,
  approvals: 3,
  // P4 — Delivery
  handoff: 4,
  projects: 4,
  tasks: 4,
  'resource-planning': 4,
  delivery: 4,
  // P5 — Client and Insight
  clients: 5,
  'post-closure': 5,
  'client-portal': 5,
  'project-communication': 5,
  documents: 5,
  reporting: 5,
  // P6 — Finance
  'billing-terms': 6,
  invoicing: 6,
  payments: 6,
  receivables: 6,
  payables: 6,
  accounting: 6,
  // P7 — Platform
  chat: 7,
  notifications: 7,
  workspace: 7,
};
