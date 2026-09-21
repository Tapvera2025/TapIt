/**
 * The standard organization starter template.
 *
 * This is definition data only. It contains no database IDs, so it can be
 * instantiated independently for every organization.
 */

const HR_MODULES = [
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
const SALES_MODULES = [
  'territories',
  'leads',
  'callbacks',
  'handovers',
  'deals',
  'approvals',
] as const;
const DEVELOPMENT_MODULES = [
  'handoff',
  'projects',
  'tasks',
  'resource-planning',
  'delivery',
] as const;
const FINANCE_MODULES = [
  'billing-terms',
  'invoicing',
  'payments',
  'receivables',
  'payables',
  'accounting',
] as const;

export interface OrganizationTemplateDepartment {
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly status: 'active' | 'inactive';
  readonly moduleKeys: readonly string[];
}

export interface OrganizationTemplatePosition {
  readonly code: string;
  readonly name: string;
  readonly department: string;
  readonly level: number;
  readonly parent: string | null;
  readonly status: 'active' | 'inactive';
  readonly matrixColumn: StarterMatrixPosition | null;
}

export type StarterMatrixPosition =
  | 'super-admin'
  | 'hr'
  | 'hr-executive'
  | 'sales-head'
  | 'project-manager'
  | 'dev-dept-head'
  | 'sales-team-lead'
  | 'sub-team-manager'
  | 'sales-supervisor'
  | 'base-employee'
  | 'client';

/** Canonical seeded position codes eligible to lead each supported team kind. */
export const TEAM_LEAD_POSITION_CODES = {
  'sales-team': ['sales-team-lead', 'sales-supervisor'],
  'sales-pool': ['sales-supervisor'],
  'dev-subteam': [
    'developer-team-manager',
    'digital-marketing-manager',
    'content-team-manager',
  ],
} as const;

export interface OrganizationTemplateDesignation {
  readonly code: string;
  readonly name: string;
  readonly department: string;
  readonly specializations: readonly string[];
  readonly moduleKeys: readonly string[];
}

export interface OrganizationTemplateTeam {
  readonly code: string;
  readonly name: string;
  readonly department: string;
  readonly kind: 'sales-team' | 'sales-pool' | 'dev-subteam';
  readonly parent: string | null;
  readonly sharedVisibility: boolean;
}

export interface OrganizationTemplate {
  readonly departments: readonly OrganizationTemplateDepartment[];
  readonly teams: readonly OrganizationTemplateTeam[];
  readonly positions: readonly OrganizationTemplatePosition[];
  readonly designations: readonly OrganizationTemplateDesignation[];
}

export const ORGANIZATION_TEMPLATE: OrganizationTemplate = {
  departments: [
    {
      code: 'hr',
      name: 'Human Resources',
      kind: 'support',
      status: 'active',
      moduleKeys: HR_MODULES,
    },
    {
      code: 'sales',
      name: 'Sales',
      kind: 'delivery',
      status: 'active',
      moduleKeys: SALES_MODULES,
    },
    {
      code: 'projects',
      name: 'Project Delivery',
      kind: 'delivery',
      status: 'active',
      moduleKeys: DEVELOPMENT_MODULES,
    },
    {
      code: 'development',
      name: 'Development',
      kind: 'delivery',
      status: 'active',
      moduleKeys: DEVELOPMENT_MODULES,
    },
    // Finance remains present but dormant, matching the existing seed/PRD
    // behavior. It is not activated merely because a company is provisioned.
    {
      code: 'finance',
      name: 'Finance',
      kind: 'support',
      status: 'inactive',
      moduleKeys: FINANCE_MODULES,
    },
  ] as const,
  // PRD T-2: Development starts with exactly three independent sub-teams.
  // Sales teams and pools remain company-configured because their number and
  // boundaries depend on the company's operating model.
  teams: [
    {
      code: 'developer-team',
      name: 'Developer Team',
      department: 'development',
      kind: 'dev-subteam',
      parent: null,
      sharedVisibility: false,
    },
    {
      code: 'digital-marketing',
      name: 'Digital & Marketing',
      department: 'development',
      kind: 'dev-subteam',
      parent: null,
      sharedVisibility: false,
    },
    {
      code: 'content-team',
      name: 'Content Team',
      department: 'development',
      kind: 'dev-subteam',
      parent: null,
      sharedVisibility: false,
    },
  ] as const,
  positions: [
    {
      code: 'hr',
      name: 'HR',
      department: 'hr',
      level: 90,
      parent: null,
      status: 'active',
      matrixColumn: 'hr',
    },
    {
      code: 'hr-executive',
      name: 'HR Executive / Assistant',
      department: 'hr',
      level: 40,
      parent: 'hr',
      status: 'active',
      matrixColumn: 'hr-executive',
    },
    {
      code: 'sales-head',
      name: 'Sales Department Head',
      department: 'sales',
      level: 90,
      parent: null,
      status: 'active',
      matrixColumn: 'sales-head',
    },
    {
      code: 'sales-team-lead',
      name: 'Sales Team Lead',
      department: 'sales',
      level: 70,
      parent: 'sales-head',
      status: 'active',
      matrixColumn: 'sales-team-lead',
    },
    {
      code: 'sales-supervisor',
      name: 'Sales Supervisor',
      department: 'sales',
      level: 50,
      parent: 'sales-team-lead',
      status: 'active',
      matrixColumn: 'sales-supervisor',
    },
    {
      code: 'sales-agent',
      name: 'Sales Agent',
      department: 'sales',
      level: 20,
      parent: 'sales-supervisor',
      status: 'active',
      matrixColumn: 'base-employee',
    },
    {
      code: 'project-manager',
      name: 'Project Manager',
      department: 'projects',
      level: 80,
      parent: null,
      status: 'active',
      matrixColumn: 'project-manager',
    },
    {
      code: 'dev-dept-head',
      name: 'Development Department Head',
      department: 'development',
      level: 90,
      parent: null,
      status: 'active',
      matrixColumn: 'dev-dept-head',
    },
    {
      code: 'developer-team-manager',
      name: 'Developer Team Manager',
      department: 'development',
      level: 65,
      parent: 'dev-dept-head',
      status: 'active',
      matrixColumn: 'sub-team-manager',
    },
    {
      code: 'digital-marketing-manager',
      name: 'Digital & Marketing Manager',
      department: 'development',
      level: 65,
      parent: 'dev-dept-head',
      status: 'active',
      matrixColumn: 'sub-team-manager',
    },
    {
      code: 'content-team-manager',
      name: 'Content Team Manager',
      department: 'development',
      level: 65,
      parent: 'dev-dept-head',
      status: 'active',
      matrixColumn: 'sub-team-manager',
    },
    {
      code: 'developer',
      name: 'Developer',
      department: 'development',
      level: 25,
      parent: 'developer-team-manager',
      status: 'active',
      matrixColumn: 'base-employee',
    },
    {
      code: 'marketing-executive',
      name: 'Marketing Executive',
      department: 'development',
      level: 25,
      parent: 'digital-marketing-manager',
      status: 'active',
      matrixColumn: 'base-employee',
    },
    {
      code: 'content-writer',
      name: 'Content Writer',
      department: 'development',
      level: 25,
      parent: 'content-team-manager',
      status: 'active',
      matrixColumn: 'base-employee',
    },
    {
      code: 'finance-manager',
      name: 'Finance Manager',
      department: 'finance',
      level: 90,
      parent: null,
      status: 'inactive',
      matrixColumn: null,
    },
    {
      code: 'accountant',
      name: 'Accountant',
      department: 'finance',
      level: 40,
      parent: 'finance-manager',
      status: 'inactive',
      matrixColumn: null,
    },
  ] as const,
  designations: [
    {
      code: 'developer',
      name: 'Developer',
      department: 'development',
      specializations: ['Frontend', 'Backend', 'Full-stack', 'QA / Tester'],
      moduleKeys: DEVELOPMENT_MODULES,
    },
    {
      code: 'marketing-executive',
      name: 'Marketing Executive',
      department: 'sales',
      specializations: ['SEO', 'Ads / PPC', 'Social Media', 'Analytics'],
      moduleKeys: DEVELOPMENT_MODULES,
    },
    {
      code: 'content-writer',
      name: 'Content Writer',
      department: 'sales',
      specializations: ['Web Copy', 'Blog', 'Technical', 'Ad Copy'],
      moduleKeys: DEVELOPMENT_MODULES,
    },
  ] as const,
};

export function templateForModules(
  moduleKeys: readonly string[],
  includeAll = false,
): OrganizationTemplate {
  if (includeAll) return ORGANIZATION_TEMPLATE;
  const enabled = new Set(moduleKeys);
  const includes = (keys: readonly string[]) => keys.some((key) => enabled.has(key));
  const departments = ORGANIZATION_TEMPLATE.departments.filter((department) =>
    includes(department.moduleKeys),
  );
  const departmentCodes = new Set(departments.map((department) => department.code));
  return {
    departments,
    teams: ORGANIZATION_TEMPLATE.teams.filter((team) =>
      departmentCodes.has(team.department),
    ),
    positions: ORGANIZATION_TEMPLATE.positions.filter((position) =>
      departmentCodes.has(position.department),
    ),
    designations: ORGANIZATION_TEMPLATE.designations.filter((designation) =>
      includes(designation.moduleKeys),
    ),
  };
}
