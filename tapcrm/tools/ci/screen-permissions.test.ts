import { describe, expect, it } from 'vitest';
import {
  BINDINGS,
  PLATFORM_AUTOMATIC_MODULES,
  PLATFORM_SELECTABLE_MODULES,
  REGISTRY,
  type Action,
} from '@tapcrm/contracts';
import {
  canOpenPath,
  companyNavigation,
  companySearchDestinations,
  navigationFor,
  screenForPath,
  screensForSubject,
  type ScreenAccess,
  type ScreenAccessSubject,
} from '../../packages/client/src/company/layout/navigation.js';
import {
  MATRIX_POSITIONS,
  PERMISSION_MATRIX,
  expandPermissionCell,
  registryActionsByModule,
} from '../../packages/server/src/platform/organizations/policy-matrix.js';
import { ORGANIZATION_TEMPLATE } from '../../packages/server/src/platform/organizations/template.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Screen permissions: the sidebar, the feature search, the Access Explorer and
 * the workspace page guard all read the screen list in
 * packages/client/src/company/layout/navigation.ts. These checks keep that list
 * honest against the server:
 *
 *   1. every menu entry names what its page needs;
 *   2. the calls each page makes when it opens are bound (AUTHORIZATION.md §6.5)
 *      to powers the entry's rule guarantees, so the menu never offers a page
 *      the server will refuse;
 *   3. for every starter position's default policies, the sidebar, search,
 *      Access Explorer and page guard agree;
 *   4. nothing decides access from department or position names.
 */

/**
 * The calls a page makes as it opens (or, for an editor, the call that saves
 * it). `oneOf` is for pages that load whichever list the person's power covers.
 * A screen whose page is composed per power (the Sales overview and setup,
 * Accounting) is listed as `composite` with the reason.
 */
type PageCalls = readonly string[] | { readonly oneOf: readonly string[] } | { readonly composite: string };

const PAGE_CALLS: Readonly<Record<string, PageCalls>> = {
  '/company/tasks': ['GET /api/tasks'],
  '/company/my-interviews': ['GET /api/recruitment/my-interviews'],
  '/company/messages': ['GET /api/chat/conversations'],
  '/company/employees': ['GET /api/users'],
  '/company/organization': ['GET /api/org/departments', 'GET /api/org/teams', 'GET /api/org/designations', 'GET /api/org/chart'],
  '/company/organization/departments': ['GET /api/org/departments', 'POST /api/org/departments'],
  '/company/organization/teams': ['GET /api/org/teams', 'GET /api/org/departments', 'GET /api/org/chart', 'POST /api/org/teams'],
  '/company/organization/positions': ['GET /api/org/ladder/:departmentCode', 'GET /api/org/positions/:id/policies', 'PATCH /api/org/positions/:id'],
  '/company/organization/designations': ['GET /api/org/designations', 'GET /api/org/departments', 'POST /api/org/designations'],
  '/company/organization/reporting': ['GET /api/org/chart', 'POST /api/users/:id/manager-reassignment'],
  '/company/organization/org-chart': ['GET /api/org/chart'],
  '/company/employee-notes': ['GET /api/admin/employee-notes'],
  '/company/recruitment': ['GET /api/recruitment/metrics'],
  '/company/recruitment/requisitions': ['GET /api/recruitment/requisitions'],
  '/company/recruitment/resumes': ['GET /api/recruitment/resume-submissions'],
  '/company/recruitment/candidates': ['GET /api/recruitment/candidates'],
  '/company/recruitment/interviews': ['GET /api/recruitment/interviews'],
  '/company/recruitment/offers': ['GET /api/recruitment/offers'],
  '/company/recruitment/joining': ['GET /api/recruitment/joinings'],
  '/company/clients': ['GET /api/clients'],
  '/company/projects': ['GET /api/projects'],
  '/company/meetings': { oneOf: ['GET /api/meetings/mine', 'GET /api/meetings'] },
  '/company/social': ['GET /api/social/clients'],
  '/company/seo-intelligence': ['GET /api/seo/sites'],
  '/company/sales': { composite: 'the overview loads one panel per Sales power the person holds' },
  '/company/sales/my-work': ['GET /api/leads'],
  '/company/sales/bid-pool': ['GET /api/bid-pool'],
  '/company/sales/leads': ['GET /api/leads'],
  '/company/sales/leads/stalled': ['GET /api/leads/stalled'],
  '/company/sales/leads/re-engagement': ['GET /api/leads/re-engagement/segments'],
  '/company/sales/triage': ['GET /api/leads/triage'],
  '/company/sales/leads/imported': ['GET /api/lead-imports'],
  '/company/sales/callbacks': ['GET /api/callbacks'],
  '/company/sales/handovers': ['GET /api/handovers'],
  '/company/sales/calls': ['GET /api/telephony/overview'],
  '/company/sales/calls/me': ['GET /api/telephony/calls'],
  '/company/sales/calls/log': ['GET /api/telephony/calls'],
  '/company/sales/calls/assigned-leads': ['GET /api/lead-imports/call-tracking'],
  '/company/sales/deals': ['GET /api/deals'],
  '/company/sales/approvals': ['GET /api/approvals/queue'],
  '/company/sales/wins': ['GET /api/deals/wins-to-record'],
  '/company/sales/supervisor': ['GET /api/sales/dashboard/pool-health'],
  '/company/sales/reports': ['GET /api/deals/forecast'],
  '/company/sales/setup': { composite: 'setup shows one card per Sales power the person holds' },
  '/company/sales/territories': ['GET /api/territories'],
  '/company/sales/call-integrations': ['GET /api/telephony/connections'],
  '/company/attendance/today': ['GET /api/attendance/live', 'POST /api/status/punch'],
  '/company/attendance/my': ['GET /api/attendance'],
  '/company/attendance/employee-wise': ['GET /api/attendance/reports/employees'],
  '/company/attendance/report': ['GET /api/attendance/reports/monthly'],
  '/company/attendance/late': ['GET /api/attendance/reports/late/daily'],
  '/company/attendance/live': ['GET /api/attendance/live'],
  '/company/attendance/corrections': ['GET /api/attendance/corrections', 'POST /api/attendance/corrections/:id/approve'],
  '/company/breaks/queue': ['GET /api/breaks/breaches'],
  '/company/breaks/policies': ['GET /api/breaks/policies'],
  '/company/biometric': ['GET /api/biometric/devices'],
  '/company/leave/my': ['GET /api/leaves', 'GET /api/leaves/types/available'],
  '/company/leave/queue': ['GET /api/leaves/acknowledgements', 'GET /api/leaves/decisions'],
  '/company/leave/balances': ['GET /api/leaves/balances'],
  '/company/leave/types': ['GET /api/leaves/types'],
  '/company/holidays': ['GET /api/holidays'],
  '/company/shifts': ['GET /api/shifts'],
  '/company/weekday-schedules': ['GET /api/shifts/weekday-schedules'],
  '/company/advance/mine': ['GET /api/advances/mine'],
  '/company/advance/requests': ['GET /api/advances'],
  '/company/penalties': ['GET /api/penalties'],
  '/company/my-penalties': ['GET /api/penalties/mine'],
  '/company/expenses/mine': ['GET /api/payables/claims/mine'],
  '/company/expenses/approvals': ['GET /api/payables/claims/approvals'],
  '/company/ta': ['GET /api/ta/report', 'GET /api/ta/assignments', 'GET /api/users', 'GET /api/org/departments'],
  '/company/my-ta': ['GET /api/ta/my'],
  '/company/payroll/my-payslips': ['GET /api/payroll/payslips/mine'],
  '/company/payroll/cycle': ['GET /api/payroll/cycle'],
  '/company/payroll/runs': ['GET /api/payroll/runs'],
  '/company/payroll/salaries': ['GET /api/payroll/structures'],
  '/company/payroll/inputs': ['GET /api/payroll/inputs'],
  '/company/payroll/settings': ['GET /api/payroll/config'],
  '/company/finance/accounting': { composite: 'each accounting tab loads under its own power' },
  '/company/access': ['GET /api/access/effective/:userId'],
  '/company/audit': ['GET /api/audit'],
  '/company/geofencing': ['GET /api/identity/geofences'],
  '/company/role-change-request': ['GET /api/access/role-change-request-access'],
};

const bindingAction = (call: string): Action => {
  const [method, path] = call.split(' ');
  const binding = BINDINGS.find((candidate) => candidate.method === method && candidate.path === path);
  if (!binding) throw new Error(`${call} is not bound to any action in AUTHORIZATION.md §6.5`);
  return binding.action;
};

const actionOf = (power: NonNullable<ScreenAccess['all']>[number]): Action =>
  typeof power === 'string' ? power : power.action;

/** Every person who passes `access` holds `action`. */
function guarantees(access: ScreenAccess, action: Action): boolean {
  if ((access.all ?? []).some((power) => actionOf(power) === action)) return true;
  const any = access.any ?? [];
  return any.length > 0 && any.every((power) => actionOf(power) === action);
}

/** Every person who passes `access` holds at least one of `actions`. */
function guaranteesOneOf(access: ScreenAccess, actions: readonly Action[]): boolean {
  if (actions.some((action) => guarantees(access, action))) return true;
  const any = access.any ?? [];
  return any.length > 0 && any.every((power) => actions.includes(actionOf(power)));
}

interface MenuEntry {
  readonly label: string;
  readonly path: string;
  readonly access: ScreenAccess | undefined;
  readonly parent: boolean;
}

const menuEntries: MenuEntry[] = companyNavigation.flatMap((group) =>
  group.items.flatMap((item) => [
    { label: item.label, path: item.path, access: item.access, parent: Boolean(item.children) },
    ...(item.children ?? []).map((child) => ({ label: child.label, path: child.path, access: child.access, parent: false })),
  ]),
);

describe('screen permissions: the list itself', () => {
  it('names what every menu entry needs, with powers from the registry', () => {
    for (const entry of menuEntries) {
      expect(entry.access, `${entry.label} (${entry.path}) declares no access rule`).toBeDefined();
      for (const power of [...(entry.access?.all ?? []), ...(entry.access?.any ?? [])]) {
        expect(REGISTRY[actionOf(power)], `${entry.label}: unknown power ${actionOf(power)}`).toBeDefined();
      }
    }
  });

  it('records the server calls of every protected page', () => {
    for (const entry of menuEntries) {
      if (entry.parent && !screenForPath(entry.path)?.access.all && !screenForPath(entry.path)?.access.any) continue;
      const rule = screenForPath(entry.path)?.access;
      const protectedScreen = (rule?.all?.length ?? 0) + (rule?.any?.length ?? 0) > 0;
      if (!protectedScreen) continue;
      expect(PAGE_CALLS[entry.path], `${entry.label} (${entry.path}): add the calls its page makes to PAGE_CALLS`).toBeDefined();
    }
  });
});

describe('screen permissions: the menu never offers a page the server refuses', () => {
  for (const [path, calls] of Object.entries(PAGE_CALLS)) {
    if ('composite' in calls) continue;
    it(`${path} needs what its page calls`, () => {
      const screen = screenForPath(path);
      expect(screen?.path, `${path} is not in the screen list`).toBe(path);
      const access = screen!.access;
      if ('oneOf' in calls) {
        const actions = calls.oneOf.map(bindingAction);
        expect(guaranteesOneOf(access, actions), `${path} must guarantee one of ${actions.join(', ')}`).toBe(true);
        return;
      }
      for (const call of calls) {
        const action = bindingAction(call);
        expect(guarantees(access, action), `${path} opens with ${call}, which needs ${action}`).toBe(true);
      }
    });
  }
});

describe('screen permissions: starter positions see one consistent picture', () => {
  const enabledModules = [...PLATFORM_SELECTABLE_MODULES, ...PLATFORM_AUTOMATIC_MODULES];
  const byModule = registryActionsByModule();
  const defaults = (column: string) => {
    const index = MATRIX_POSITIONS.indexOf(column as (typeof MATRIX_POSITIONS)[number]);
    return Object.entries(PERMISSION_MATRIX).flatMap(([module, cells]) =>
      expandPermissionCell(module, cells[index]!, column, byModule).map((policy) => ({
        action: policy.action,
        scope: policy.scope,
      })),
    );
  };
  const positions = ORGANIZATION_TEMPLATE.positions.filter((position) => position.matrixColumn !== null);

  for (const position of positions) {
    it(`${position.name}: sidebar, search, Access Explorer and page guard agree`, () => {
      const subject: ScreenAccessSubject = {
        accountType: 'employee',
        enabledModules,
        capabilities: defaults(position.matrixColumn!),
      };
      const sidebar = navigationFor(subject).flatMap((group) =>
        group.items.flatMap((item) => (item.children?.length ? item.children.map((child) => child.path) : [item.path])),
      );
      const search = new Set(companySearchDestinations(subject).map((destination) => destination.path));
      const explorer = new Set(screensForSubject(subject).map((screen) => screen.path));

      for (const path of sidebar) {
        expect(canOpenPath(path, subject), `${position.name}: sidebar offers ${path} but the page refuses it`).toBe(true);
        expect(search.has(path), `${position.name}: ${path} is in the sidebar but not in search`).toBe(true);
        const rule = screenForPath(path)?.access;
        if ((rule?.all?.length ?? 0) + (rule?.any?.length ?? 0) > 0) {
          expect(explorer.has(path), `${position.name}: Access Explorer misses ${path}`).toBe(true);
        }
        const calls = PAGE_CALLS[path];
        if (calls && Array.isArray(calls)) {
          for (const call of calls) {
            const action = bindingAction(call);
            expect(
              subject.capabilities!.some((capability) => capability.action === action),
              `${position.name}: sidebar offers ${path} without ${action}`,
            ).toBe(true);
          }
        }
      }
      for (const path of explorer) {
        expect(canOpenPath(path, subject), `${position.name}: Access Explorer lists ${path} but the page refuses it`).toBe(true);
      }
    });
  }
});

describe('screen permissions: no names', () => {
  const read = (relative: string) =>
    readFileSync(fileURLToPath(new URL(`../../packages/client/src/${relative}`, import.meta.url)), 'utf8');

  it('never decides access from department or position names', () => {
    for (const file of [
      'company/CompanyWorkspace.tsx',
      'company/layout/navigation.ts',
      'company/layout/sidebarNavigation.ts',
    ]) {
      expect(read(file), file).not.toMatch(/\b(departmentCode|departmentName|positionCode|positionName)\b/);
    }
  });
});
