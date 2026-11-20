import { REGISTRY, type Action } from '@tapcrm/contracts';

const SEARCH_ALIASES_BY_PATH: Readonly<Record<string, readonly string[]>> = {
  '/company/todo': [
    'todo',
    'to do',
    'to-do',
    'checklist',
    'task list',
    'my tasks',
    'personal tasks',
  ],
  '/company/my-notepad': [
    'note',
    'notes',
    'notepad',
    'write',
    'personal notes',
    'my notes',
    'memo',
    'scratchpad',
  ],
  '/company/employee-notes': [
    'employee notes',
    'staff notes',
    'hr notes',
    'personnel notes',
    'team notes',
  ],
  '/company/holidays': [
    'holiday calendar',
    'public holidays',
    'festivals',
    'weekend',
    'weekends',
    'week off',
    'week-off',
    'days off',
  ],
  '/company/attendance/my': [
    'attendance calendar',
    'work calendar',
    'work day',
    'work days',
    'punch history',
  ],
  '/company/attendance/live': [
    'workforce',
    'workforce board',
    'live workforce',
    'employee live board',
    'presence',
    'live attendance',
    'live board',
  ],
  '/company/audit': [
    'audit',
    'audit trail',
    'activity log',
    'activity records',
    'security log',
    'history',
    'records',
  ],
  '/company/sessions': [
    'login',
    'logins',
    'logged in devices',
    'active devices',
    'security sessions',
  ],
  '/company/sales/deals': ['sales pipeline', 'opportunities', 'business deals'],
  '/company/sales/wins': [
    'record',
    'records',
    'record win',
    'won deals',
    'successful deals',
  ],
  '/company/sales/reports': ['sales forecast', 'forecast', 'sales analytics'],
  '/company/weekday-schedules': [
    'weekday',
    'working days',
    'weekends',
    'schedule',
    'work schedule',
  ],
  '/company/payroll/cycle': ['payroll period', 'pay run', 'salary cycle'],
  '/company/finance/accounting': [
    'accounting',
    'accounts',
    'ledger',
    'finance',
    'financial records',
    'balance sheet',
    'p&l',
    'profit and loss',
  ],
  '/company/social': [
    'social media',
    'posts',
    'instagram',
    'facebook',
    'linkedin',
    'twitter',
    'content calendar',
    'social planner',
    'social scheduling',
    'manage social',
  ],
  '/company/seo-intelligence': [
    'seo',
    'search engine',
    'google ranking',
    'website audit',
    'keyword tracking',
    'backlinks',
    'site health',
    'search visibility',
    'organic traffic',
    'serp',
  ],
};

/* ==================================================================== *
 * Screen permissions: the one list
 *
 * Every company screen names the powers its page needs from the server.
 * The sidebar, the feature search, the Access Explorer's "reachable screens"
 * and the workspace's own page guard all read this list through the same
 * functions below, so they cannot disagree. Visibility comes from the powers
 * the server resolved for the session (position policy + overrides), never
 * from department or position names.
 * ==================================================================== */

/**
 * One power a screen needs. `reach: 'beyond-own'` means the holder's scope must
 * cover more than their own records (a team, a department, everyone).
 */
export type ScreenPower =
  Action | { readonly action: Action; readonly reach: 'beyond-own' };

export interface ScreenAccess {
  /** Every one of these powers must be held. */
  readonly all?: readonly ScreenPower[];
  /** At least one of these powers must be held. */
  readonly any?: readonly ScreenPower[];
  /**
   * Company modules the page's server routes belong to, when they differ from
   * the modules of its powers (the live board is served by Live Status).
   */
  readonly modules?: readonly string[];
  /** Account types the screen is for; every account type when omitted. */
  readonly accountTypes?: readonly string[];
  /**
   * Listed only for people on an interview panel. A data condition, never a
   * permission: the page itself still opens for anyone holding the powers.
   */
  readonly listedFor?: 'interview-panel';
}

/** Open to every signed-in company user. */
export const OPEN: ScreenAccess = Object.freeze({});

const beyondOwn = (action: Action): ScreenPower => ({ action, reach: 'beyond-own' });

export interface CompanyNavSubItem {
  label: string;
  path: string;
  access?: ScreenAccess;
}

export interface CompanyNavItem {
  label: string;
  path: string;
  icon: string;
  /**
   * What the screen needs. On an entry with sub-entries this is the parent's
   * own page; the entry is shown only while at least one sub-entry is.
   */
  access?: ScreenAccess;
  children?: CompanyNavSubItem[];
}

export interface CompanyNavGroup {
  label: string;
  items: CompanyNavItem[];
}

export interface CompanyScreen {
  label: string;
  path: string;
  /** The first power in the screen's rule that this person holds. */
  requiredAction: Action;
}

export interface CompanySearchDestination {
  label: string;
  path: string;
  icon: string;
  category: string;
  keywords: readonly string[];
}

/** A power the server resolved for the session (identity bootstrap capability). */
export interface ScreenCapability {
  readonly action: string;
  readonly scope?: string | null | undefined;
}

/** Everything that decides what one person can open. */
export interface ScreenAccessSubject {
  readonly accountType: string;
  /** Modules switched on for the company; undefined while unknown (all count as on). */
  readonly enabledModules?: readonly string[] | undefined;
  /** The powers the server resolved for this session. */
  readonly capabilities?: readonly ScreenCapability[] | undefined;
  /** Sits on an interview panel (data, not a permission). */
  readonly hasInterviews?: boolean | undefined;
}

const moduleOn = (subject: ScreenAccessSubject, module: string): boolean =>
  !subject.enabledModules || subject.enabledModules.includes(module);

const powerAction = (power: ScreenPower): Action =>
  typeof power === 'string' ? power : power.action;

/**
 * Whether the person holds this power. The Super Admin holds every power of
 * every enabled module (globalAccess); everyone else holds what the server
 * resolved for them. A switched-off module grants nothing, to anyone.
 */
export function holdsPower(subject: ScreenAccessSubject, power: ScreenPower): boolean {
  const action = powerAction(power);
  const definition = (REGISTRY as Record<string, { module: string } | undefined>)[action];
  if (!definition || !moduleOn(subject, definition.module)) return false;
  if (subject.accountType === 'super-admin') return true;
  const needsReach = typeof power !== 'string' && power.reach === 'beyond-own';
  return (subject.capabilities ?? []).some(
    (capability) =>
      capability.action === action && (!needsReach || capability.scope !== 'own'),
  );
}

/** Whether the person may open a screen with this rule. */
export function canOpenScreen(
  access: ScreenAccess | undefined,
  subject: ScreenAccessSubject,
): boolean {
  if (!access) return true;
  if (access.accountTypes && !access.accountTypes.includes(subject.accountType))
    return false;
  if (access.modules && !access.modules.every((module) => moduleOn(subject, module)))
    return false;
  if (access.all && !access.all.every((power) => holdsPower(subject, power)))
    return false;
  if (
    access.any &&
    access.any.length > 0 &&
    !access.any.some((power) => holdsPower(subject, power))
  ) {
    return false;
  }
  return true;
}

/** Whether a screen is offered to the person (sidebar, search). */
export function isScreenListed(
  access: ScreenAccess | undefined,
  subject: ScreenAccessSubject,
): boolean {
  if (!canOpenScreen(access, subject)) return false;
  if (access?.listedFor === 'interview-panel' && !subject.hasInterviews) return false;
  return true;
}

/** Every power a rule names, in order. */
export function screenPowers(access: ScreenAccess | undefined): Action[] {
  return [...(access?.all ?? []), ...(access?.any ?? [])].map(powerAction);
}

/* ---- shared rules ---------------------------------------------------- */

const SALES_WORKSPACE: ScreenAccess = {
  any: [
    'territories:view',
    'leads:view',
    'callbacks:view',
    'handovers:view',
    'deals:view',
    'deals:record-win',
    'approvals:decide',
    'deals:forecast',
    'telephony:view',
    'telephony:manage',
  ],
};
/** Triage and the supervisor board: reading leads plus a power to move them. */
const SALES_SUPERVISION: ScreenAccess = {
  all: ['leads:view'],
  any: [beyondOwn('leads:reassign'), 'leads:rescue-from-triage'],
};
const ADVANCE_REQUESTS: ScreenAccess = { all: [beyondOwn('advance:view')] };
const MY_INTERVIEWS: ScreenAccess = { all: ['recruitment:submit-round-feedback'] };

/**
 * Single universal navigation item for My Todo.
 * Universally available to all authenticated company users without action or role gating.
 */
export const myTodoNavItem: CompanyNavItem = {
  label: 'My Todo',
  path: '/company/todo',
  icon: 'pencil',
  access: OPEN,
};

export const myTodoItem = myTodoNavItem;

/**
 * Single universal navigation item for My Notepad.
 * Universally available to all authenticated company users without action or role gating.
 */
export const myNotepadNavItem: CompanyNavItem = {
  label: 'My Notepad',
  path: '/company/my-notepad',
  icon: 'notepad',
  access: OPEN,
};

export const myNotepadItem = myNotepadNavItem;

/**
 * The company menu, in sidebar order. Each entry names what its page needs
 * from the server; `navigationFor` keeps the entries a person can use.
 */
export const companyNavigation: CompanyNavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', path: '/company/dashboard', icon: 'grid', access: OPEN },
      {
        label: 'Tasks',
        path: '/company/tasks',
        icon: 'check',
        access: { all: ['tasks:view'] },
      },
      {
        label: 'My Interviews',
        path: '/company/my-interviews',
        icon: 'calendar',
        access: { ...MY_INTERVIEWS, listedFor: 'interview-panel' },
      },
      {
        label: 'Messages',
        path: '/company/messages',
        icon: 'message',
        access: { all: ['chat:view'] },
      },
      myTodoNavItem,
      myNotepadNavItem,
    ],
  },
  {
    label: 'Organization',
    items: [
      {
        label: 'Employees',
        path: '/company/employees',
        icon: 'users',
        access: { all: ['users:view'] },
      },
      // Read-only overviews need the view powers; the editors also need the
      // power that saves their changes, so a reader never lands on a form the
      // server will refuse.
      {
        label: 'Overview',
        path: '/company/organization',
        icon: 'grid',
        access: { all: ['org:view-structure', 'org:view-designations'] },
      },
      {
        label: 'Departments',
        path: '/company/organization/departments',
        icon: 'building',
        access: { all: ['org:view-structure', 'org:manage-departments'] },
      },
      {
        label: 'Teams',
        path: '/company/organization/teams',
        icon: 'users',
        access: { all: ['org:view-structure', 'org:manage-teams'] },
      },
      {
        label: 'Positions',
        path: '/company/organization/positions',
        icon: 'briefcase',
        access: {
          all: ['org:view-structure', 'org:view-policies', 'org:manage-positions'],
        },
      },
      {
        label: 'Designations',
        path: '/company/organization/designations',
        icon: 'briefcase',
        access: {
          all: ['org:view-structure', 'org:view-designations', 'org:manage-designations'],
        },
      },
      {
        label: 'Reporting',
        path: '/company/organization/reporting',
        icon: 'users',
        access: { all: ['org:view-structure', 'users:manage'] },
      },
      {
        label: 'Org Chart',
        path: '/company/organization/org-chart',
        icon: 'hierarchy',
        access: { all: ['org:view-structure'] },
      },
    ],
  },
  {
    label: 'Employee Activities',
    items: [
      {
        label: 'Employee Notes',
        path: '/company/employee-notes',
        icon: 'notepad',
        access: { all: ['notepad:view-all'] },
      },
    ],
  },
  {
    label: 'Recruitment',
    items: [
      {
        label: 'Overview',
        path: '/company/recruitment',
        icon: 'grid',
        access: { all: ['recruitment:view-metrics'] },
      },
      {
        label: 'Requisitions',
        path: '/company/recruitment/requisitions',
        icon: 'clipboard-list',
        access: { all: ['recruitment:view-requisitions'] },
      },
      {
        label: 'Resume Inbox',
        path: '/company/recruitment/resumes',
        icon: 'inbox',
        access: { all: ['recruitment:manage-submissions'] },
      },
      {
        label: 'Candidates',
        path: '/company/recruitment/candidates',
        icon: 'users',
        access: { all: ['recruitment:view-candidates'] },
      },
      {
        label: 'Interviews',
        path: '/company/recruitment/interviews',
        icon: 'calendar',
        access: { all: ['recruitment:view-interviews'] },
      },
      {
        label: 'Offers',
        path: '/company/recruitment/offers',
        icon: 'file-text',
        access: { all: ['recruitment:view-offers'] },
      },
      {
        label: 'Joining',
        path: '/company/recruitment/joining',
        icon: 'user-plus',
        access: { all: ['recruitment:view-joining'] },
      },
    ],
  },
  {
    label: 'Delivery',
    items: [
      {
        label: 'Clients',
        path: '/company/clients',
        icon: 'briefcase',
        access: { all: ['clients:view'] },
      },
      {
        label: 'Projects',
        path: '/company/projects',
        icon: 'grid',
        access: { all: ['projects:view'] },
      },
      {
        label: 'Client meetings',
        path: '/company/meetings',
        icon: 'calendar',
        access: { any: ['meetings:host', 'meetings:view'] },
      },
      {
        label: 'Manage Social Media',
        path: '/company/social',
        icon: 'share',
        access: { all: ['social:view'] },
      },
    ],
  },
  {
    label: 'SEO Intelligence',
    items: [
      {
        label: 'SEO Dashboard',
        path: '/company/seo-intelligence',
        icon: 'trending-up',
        access: { all: ['seo:list-sites'] },
      },
    ],
  },
  {
    label: 'Sales',
    items: [
      {
        label: 'Overview',
        path: '/company/sales',
        icon: 'chart',
        access: SALES_WORKSPACE,
      },
      {
        label: 'My Work',
        path: '/company/sales/my-work',
        icon: 'briefcase',
        access: { all: ['leads:view'] },
      },
      {
        label: 'Lead Management',
        path: '/company/sales/leads',
        icon: 'users',
        access: OPEN,
        children: [
          {
            label: 'All Leads',
            path: '/company/sales/leads',
            access: { all: ['leads:view'] },
          },
          {
            label: 'Lead Pool',
            path: '/company/sales/bid-pool',
            access: { all: ['leads:view'] },
          },
          {
            label: 'Inactive Leads',
            path: '/company/sales/leads/stalled',
            access: { all: ['leads:view'] },
          },
          {
            label: 'Follow-up Required',
            path: '/company/sales/leads/re-engagement',
            access: { all: ['leads:view'] },
          },
          {
            label: 'Needs Review',
            path: '/company/sales/triage',
            access: SALES_SUPERVISION,
          },
          {
            label: 'Imported Leads',
            path: '/company/sales/leads/imported',
            access: { all: ['lead-imports:view'] },
          },
        ],
      },
      {
        label: 'Activities',
        path: '/company/sales/callbacks',
        icon: 'calendar',
        access: OPEN,
        children: [
          {
            label: 'Callbacks',
            path: '/company/sales/callbacks',
            access: { all: ['callbacks:view'] },
          },
          {
            label: 'Handovers',
            path: '/company/sales/handovers',
            access: { all: ['handovers:view'] },
          },
          {
            label: 'Calls',
            path: '/company/sales/calls',
            access: { all: ['telephony:view'] },
          },
          {
            label: 'My calls',
            path: '/company/sales/calls/me',
            access: { all: ['telephony:view'] },
          },
          {
            label: 'Call log',
            path: '/company/sales/calls/log',
            access: { all: ['telephony:view'] },
          },
          {
            label: 'Assigned lead calls',
            path: '/company/sales/calls/assigned-leads',
            access: { all: ['lead-imports:view'], modules: ['telephony'] },
          },
        ],
      },
      {
        label: 'Deals',
        path: '/company/sales/deals',
        icon: 'briefcase',
        access: OPEN,
        children: [
          {
            label: 'Pipeline',
            path: '/company/sales/deals',
            access: { all: ['deals:view'] },
          },
          {
            label: 'Approvals',
            path: '/company/sales/approvals',
            access: { all: ['approvals:decide'] },
          },
          {
            label: 'Wins to record',
            path: '/company/sales/wins',
            access: { all: ['deals:record-win'] },
          },
        ],
      },
      {
        label: 'Performance',
        path: '/company/sales/reports',
        icon: 'chart',
        access: OPEN,
        children: [
          {
            label: 'Team overview',
            path: '/company/sales/supervisor',
            access: SALES_SUPERVISION,
          },
          {
            label: 'Reports',
            path: '/company/sales/reports',
            access: { all: ['deals:forecast'] },
          },
        ],
      },
      {
        label: 'Setup',
        path: '/company/sales/setup',
        icon: 'settings',
        access: SALES_WORKSPACE,
        children: [
          {
            label: 'Territories & routing',
            path: '/company/sales/territories',
            access: { all: ['territories:view'] },
          },
          {
            label: 'Lead sources',
            path: '/company/sales/leads',
            access: { all: ['leads:view'] },
          },
          {
            label: 'Call integrations',
            path: '/company/sales/call-integrations',
            access: { all: ['telephony:manage'] },
          },
        ],
      },
    ],
  },
  {
    label: 'Attendance',
    items: [
      // Today loads the person's live status and punches through Live Status.
      {
        label: 'Today',
        path: '/company/attendance/today',
        icon: 'clock',
        access: {
          all: ['attendance:view-live', 'status:punch'],
          accountTypes: ['employee'],
        },
      },
      {
        label: 'My Attendance',
        path: '/company/attendance/my',
        icon: 'calendar',
        access: { all: ['attendance:view'], accountTypes: ['employee'] },
      },
      {
        label: 'Employee Wise',
        path: '/company/attendance/employee-wise',
        icon: 'users',
        access: { all: [beyondOwn('attendance:view')] },
      },
      {
        label: 'Attendance Report',
        path: '/company/attendance/report',
        icon: 'grid',
        access: { all: [beyondOwn('attendance:view')] },
      },
      {
        label: 'Daily Late Report',
        path: '/company/attendance/late',
        icon: 'clock',
        access: { all: [beyondOwn('attendance:view')] },
      },
      {
        label: 'Workforce Board',
        path: '/company/attendance/live',
        icon: 'users',
        access: { all: [beyondOwn('attendance:view-live')], modules: ['live-status'] },
      },
      {
        label: 'Corrections',
        path: '/company/attendance/corrections',
        icon: 'edit',
        access: { all: ['attendance:correct', 'attendance:view'] },
      },
      {
        label: 'Break Queue',
        path: '/company/breaks/queue',
        icon: 'alert-circle',
        access: { all: ['breaks:review-breach', 'breaks:view'] },
      },
      {
        label: 'Break Policies',
        path: '/company/breaks/policies',
        icon: 'settings',
        access: { all: ['breaks:manage-policy'] },
      },
      {
        label: 'Biometric',
        path: '/company/biometric',
        icon: 'cpu',
        access: { all: ['biometric:manage'] },
      },
    ],
  },
  {
    label: 'Shifts & Leave',
    items: [
      {
        label: 'My Leave',
        path: '/company/leave/my',
        icon: 'sun',
        access: { all: ['leave:view', 'leave:request'] },
      },
      {
        label: 'Leave Queue',
        path: '/company/leave/queue',
        icon: 'inbox',
        access: { all: ['leave:view'], any: ['leave:acknowledge', 'leave:decide'] },
      },
      {
        label: 'Leave Balances',
        path: '/company/leave/balances',
        icon: 'chart',
        access: {
          all: ['leave:view'],
          any: ['leave:manage-types', beyondOwn('leave:view')],
        },
      },
      {
        label: 'Leave Types',
        path: '/company/leave/types',
        icon: 'settings',
        access: { all: ['leave:manage-types'] },
      },
      {
        label: 'Holidays',
        path: '/company/holidays',
        icon: 'flag',
        access: { all: ['holidays:view'] },
      },
      {
        label: 'Shifts',
        path: '/company/shifts',
        icon: 'layers',
        access: { all: ['shifts:manage', 'shifts:view'] },
      },
      {
        label: 'Weekday Schedules',
        path: '/company/weekday-schedules',
        icon: 'calendar',
        access: { all: ['shifts:manage', 'shifts:view'] },
      },
    ],
  },
  {
    label: 'Advances & Penalties',
    items: [
      {
        label: 'My Advances',
        path: '/company/advance/mine',
        icon: 'dollar-sign',
        access: { all: ['advance:view-own'] },
      },
      {
        label: 'Advance Requests',
        path: '/company/advance/requests',
        icon: 'inbox',
        access: ADVANCE_REQUESTS,
      },
      {
        label: 'Penalties',
        path: '/company/penalties',
        icon: 'alert-circle',
        access: { all: [beyondOwn('penalty:view')] },
      },
      {
        label: 'My Penalties',
        path: '/company/my-penalties',
        icon: 'alert-circle',
        access: { all: ['penalty:view-own'], accountTypes: ['employee'] },
      },
      {
        label: 'My Expenses',
        path: '/company/expenses/mine',
        icon: 'file-text',
        access: { all: ['payables:claim'] },
      },
      {
        label: 'Expense Approvals',
        path: '/company/expenses/approvals',
        icon: 'inbox',
        // The approvals list is served under payables:claim; deciding needs approve-claim.
        access: { all: ['payables:claim', beyondOwn('payables:approve-claim')] },
      },
      {
        label: 'TA Management',
        path: '/company/ta',
        icon: 'map',
        // The page loads the report, the assignments, the people and the
        // departments together; without any one of them it cannot open.
        access: { all: ['ta:view', 'ta:manage', 'users:view', 'org:view-structure'] },
      },
      {
        label: 'My TA',
        path: '/company/my-ta',
        icon: 'map',
        access: { all: ['ta:view-own'], accountTypes: ['employee'] },
      },
    ],
  },
  {
    label: 'Payroll',
    items: [
      {
        label: 'My Payslips',
        path: '/company/payroll/my-payslips',
        icon: 'file-text',
        access: { all: ['payroll:view'] },
      },
      {
        label: 'Payroll Cycle',
        path: '/company/payroll/cycle',
        icon: 'calendar',
        access: { all: ['payroll:manage', 'payroll:view'] },
      },
      {
        label: 'Payroll Runs',
        path: '/company/payroll/runs',
        icon: 'dollar-sign',
        access: { all: ['payroll:manage'] },
      },
      {
        label: 'Salary Structures',
        path: '/company/payroll/salaries',
        icon: 'briefcase',
        access: { all: ['payroll:manage'] },
      },
      {
        label: 'Bonuses & Deductions',
        path: '/company/payroll/inputs',
        icon: 'chart',
        access: { all: ['payroll:manage'] },
      },
      {
        label: 'Payroll Settings',
        path: '/company/payroll/settings',
        icon: 'wallet',
        access: { all: ['payroll:manage-config'] },
      },
    ],
  },
  {
    label: 'Finance',
    items: [
      {
        label: 'Accounting',
        path: '/company/finance/accounting',
        icon: 'wallet',
        access: {
          any: [
            'accounting:view-ledger',
            'accounting:view-statements',
            'accounting:tax-export',
          ],
        },
      },
    ],
  },
  {
    label: 'Identity & Access',
    items: [
      {
        label: 'Sessions & Devices',
        path: '/company/sessions',
        icon: 'monitor',
        access: OPEN,
      },
      {
        label: 'Access Explorer',
        path: '/company/access',
        icon: 'shield',
        access: { all: ['access:view'] },
      },
      {
        label: 'Audit Log',
        path: '/company/audit',
        icon: 'clipboard-list',
        access: { all: ['audit:view'] },
      },
      // Geofences decide where people may punch in, so they follow Attendance.
      {
        label: 'Geofencing',
        path: '/company/geofencing',
        icon: 'pin',
        access: { all: ['identity:manage-geofence'], modules: ['attendance'] },
      },
      {
        label: 'Request Role Change',
        path: '/company/role-change-request',
        icon: 'briefcase',
        access: { all: ['access:request-role-change'], accountTypes: ['employee'] },
      },
    ],
  },
  {
    label: 'Preferences',
    items: [
      { label: 'Settings', path: '/company/settings', icon: 'settings', access: OPEN },
    ],
  },
];

/**
 * Pages reached from inside other pages or from search rather than from the
 * menu. They are guarded by the same rules.
 */
const searchOnlyScreens: readonly (CompanySearchDestination & {
  access: ScreenAccess;
})[] = [
  {
    label: 'My Profile',
    path: '/company/my-profile',
    icon: 'clipboard',
    category: 'Preferences',
    keywords: [
      'profile',
      'complete profile',
      'documents',
      'education',
      'experience',
      'address',
      'emergency contact',
    ],
    access: { accountTypes: ['employee'] },
  },
  {
    label: 'Social Planner',
    path: '/company/social/planner',
    icon: 'layers',
    category: 'Delivery',
    keywords: ['social planner', 'post planner', 'social queue'],
    access: { all: ['social:view'] },
  },
  {
    label: 'Social Content Calendar',
    path: '/company/social/calendar',
    icon: 'calendar',
    category: 'Delivery',
    keywords: ['content calendar', 'social calendar', 'publishing schedule'],
    access: { all: ['social:view'] },
  },
  {
    label: 'Create Social Post',
    path: '/company/social/create',
    icon: 'plus',
    category: 'Delivery',
    keywords: ['create post', 'new post', 'publish post', 'write post', 'compose post'],
    access: { all: ['social:view'] },
  },
  {
    label: 'Social Analytics',
    path: '/company/social/analytics',
    icon: 'chart',
    category: 'Delivery',
    keywords: ['social analytics', 'engagement', 'reach', 'post metrics'],
    access: { all: ['social:view'] },
  },
  {
    label: 'Connected Social Accounts',
    path: '/company/social/accounts',
    icon: 'share',
    category: 'Delivery',
    keywords: [
      'connected accounts',
      'social accounts',
      'facebook page',
      'instagram',
      'linkedin',
    ],
    access: { all: ['social:view'] },
  },
  {
    label: 'SEO Keyword Search',
    path: '/company/seo-intelligence/keyword-search',
    icon: 'search',
    category: 'SEO Intelligence',
    keywords: ['keywords', 'keyword research', 'search terms', 'keyword search'],
    access: { all: ['seo:list-sites'] },
  },
  {
    label: 'SEO Website Health',
    path: '/company/seo-intelligence/website',
    icon: 'shield',
    category: 'SEO Intelligence',
    keywords: ['website audit', 'site health', 'seo audit', 'issues', 'fixes'],
    access: { all: ['seo:list-sites'] },
  },
  {
    label: 'Search Visibility',
    path: '/company/seo-intelligence/visibility',
    icon: 'chart',
    category: 'SEO Intelligence',
    keywords: [
      'google traffic',
      'search console',
      'rank tracking',
      'google positions',
      'backlinks',
      'ai visibility',
    ],
    access: { all: ['seo:list-sites'] },
  },
  {
    label: 'SEO Content & Briefs',
    path: '/company/seo-intelligence/content',
    icon: 'file-text',
    category: 'SEO Intelligence',
    keywords: ['articles', 'briefs', 'content board', 'blog', 'drafts', 'seo content'],
    access: { all: ['seo:list-sites'] },
  },
];

/** Older links and in-page routes that belong to a screen but are not in the menu. */
const routeOnlyScreens: readonly { path: string; access: ScreenAccess }[] = [
  { path: '/company/recruitment/my-interviews', access: MY_INTERVIEWS },
  { path: '/company/advance/deductions', access: ADVANCE_REQUESTS },
];

/* ---- derived views over the list -------------------------------------- */

/** The menu one person sees. Entries and groups they cannot use are left out. */
export function navigationFor(subject: ScreenAccessSubject): CompanyNavGroup[] {
  return companyNavigation
    .map((group) => ({
      label: group.label,
      items: group.items.flatMap((item): CompanyNavItem[] => {
        if (!isScreenListed(item.access, subject)) return [];
        if (!item.children) return [item];
        const children = item.children.filter((child) =>
          isScreenListed(child.access, subject),
        );
        if (children.length === 0) return [];
        // An entry that opens one of its own sub-entries opens the first one
        // this person has when they do not have that one.
        const opensChild = item.children.some((child) => child.path === item.path);
        const path =
          opensChild && !children.some((child) => child.path === item.path)
            ? children[0]!.path
            : item.path;
        return [{ ...item, path, children }];
      }),
    }))
    .filter((group) => group.items.length > 0);
}

interface ScreenEntry {
  readonly label: string;
  readonly path: string;
  readonly access: ScreenAccess;
}

let allScreens: readonly ScreenEntry[] | undefined;
/** Every screen that owns a route: menu entries, sub-entries, search-only and route-only pages. */
function screenEntries(): readonly ScreenEntry[] {
  if (!allScreens) {
    const entries: ScreenEntry[] = [];
    for (const group of companyNavigation) {
      for (const item of group.items) {
        const opensChild =
          item.children?.some((child) => child.path === item.path) ?? false;
        // A parent that only opens one of its sub-entries owns no route of its own.
        if (!opensChild)
          entries.push({
            label: item.label,
            path: item.path,
            access: item.access ?? OPEN,
          });
        for (const child of item.children ?? []) {
          entries.push({
            label: child.label,
            path: child.path,
            access: child.access ?? OPEN,
          });
        }
      }
    }
    for (const screen of searchOnlyScreens) entries.push(screen);
    for (const screen of routeOnlyScreens)
      entries.push({ label: screen.path, ...screen });
    allScreens = entries;
  }
  return allScreens;
}

const owns = (entryPath: string, path: string): boolean =>
  path === entryPath || path.startsWith(`${entryPath}/`);

/**
 * The screen a route belongs to: the one with the longest matching path, so
 * `/company/sales/leads/imported` is Imported Leads, `/company/sales/leads/42`
 * is All Leads. Undefined for routes no screen owns.
 */
export function screenForPath(path: string): ScreenEntry | undefined {
  let best: ScreenEntry | undefined;
  for (const entry of screenEntries()) {
    if (owns(entry.path, path) && (!best || entry.path.length > best.path.length))
      best = entry;
  }
  return best;
}

/** Whether the person may open this route. Routes no screen owns are left to the page. */
export function canOpenPath(path: string, subject: ScreenAccessSubject): boolean {
  const screen = screenForPath(path);
  return screen === undefined || canOpenScreen(screen.access, subject);
}

/**
 * Whether the module behind a destination is switched on for the company. The
 * server rejects every call into a switched-off module (super-admins included),
 * so such a destination must not be offered. A path is judged by the screen
 * that owns it; paths no screen owns are left alone, and an omitted
 * `enabledModules` means all are on.
 */
export function isDestinationModuleEnabled(
  path: string,
  enabledModules: readonly string[] | undefined,
): boolean {
  if (!enabledModules) return true;
  const screen = screenForPath(path);
  if (!screen) return true;
  const on = (module: string): boolean => enabledModules.includes(module);
  const moduleOf = (power: ScreenPower): string | undefined =>
    (REGISTRY as Record<string, { module: string } | undefined>)[powerAction(power)]
      ?.module;
  const { all = [], any = [], modules = [] } = screen.access;
  if (!modules.every(on)) return false;
  if (
    !all.every((power) => {
      const module = moduleOf(power);
      return module !== undefined && on(module);
    })
  )
    return false;
  if (
    any.length > 0 &&
    !any.some((power) => {
      const module = moduleOf(power);
      return module !== undefined && on(module);
    })
  ) {
    return false;
  }
  return true;
}

/**
 * The protected screens a person can reach, for the Access Explorer. Built from
 * the same rules as the sidebar, so the two cannot disagree.
 */
export function screensForSubject(subject: ScreenAccessSubject): CompanyScreen[] {
  const seen = new Set<string>();
  const screens: CompanyScreen[] = [];
  for (const entry of screenEntries()) {
    if (
      seen.has(entry.path) ||
      routeOnlyScreens.some((screen) => screen.path === entry.path)
    )
      continue;
    const powers = [...(entry.access.all ?? []), ...(entry.access.any ?? [])];
    if (powers.length === 0 || !canOpenScreen(entry.access, subject)) continue;
    const held = powers.find((power) => holdsPower(subject, power));
    if (held === undefined) continue;
    seen.add(entry.path);
    screens.push({
      label: entry.label,
      path: entry.path,
      requiredAction: powerAction(held),
    });
  }
  return screens;
}

/** For each power, the screens whose rule names it (Access Explorer, "By power"). */
export function navigationScreensByAction(): ReadonlyMap<
  Action,
  readonly CompanyScreen[]
> {
  const mapping = new Map<Action, CompanyScreen[]>();
  const seen = new Set<string>();
  for (const entry of screenEntries()) {
    if (routeOnlyScreens.some((screen) => screen.path === entry.path)) continue;
    for (const action of new Set(screenPowers(entry.access))) {
      const key = `${action} ${entry.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const screens = mapping.get(action) ?? [];
      screens.push({ label: entry.label, path: entry.path, requiredAction: action });
      mapping.set(action, screens);
    }
  }
  return mapping;
}

/** The feature-search index: every destination this person can open, menu and search-only. */
export function companySearchDestinations(
  subject: ScreenAccessSubject,
): CompanySearchDestination[] {
  const destinations: CompanySearchDestination[] = [];
  const seen = new Set<string>();
  const add = (destination: CompanySearchDestination): void => {
    if (seen.has(destination.path)) return;
    seen.add(destination.path);
    const pathKeywords = destination.path
      .split('/')
      .filter(Boolean)
      .flatMap((segment) => segment.split(/[-_]/g));
    destinations.push({
      ...destination,
      keywords: [
        ...destination.keywords,
        ...pathKeywords,
        ...(SEARCH_ALIASES_BY_PATH[destination.path] ?? []),
      ],
    });
  };

  for (const group of navigationFor(subject)) {
    for (const item of group.items) {
      const entries = item.children?.length
        ? item.children
        : [{ label: item.label, path: item.path }];
      for (const entry of entries) {
        add({
          label: entry.label,
          path: entry.path,
          icon: item.icon,
          category: group.label,
          keywords: [
            item.label,
            group.label,
            entry.label,
            ...(SEARCH_ALIASES_BY_PATH[entry.path] ??
              SEARCH_ALIASES_BY_PATH[item.path] ??
              []),
          ],
        });
      }
    }
  }
  for (const { access, ...destination } of searchOnlyScreens) {
    if (!isScreenListed(access, subject)) continue;
    add({
      ...destination,
      keywords: [destination.label, destination.category, ...destination.keywords],
    });
  }
  return destinations;
}
