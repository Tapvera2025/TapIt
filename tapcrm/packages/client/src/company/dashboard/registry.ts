import type { CompanyIdentity } from '../api/companyApi.js';
import type { WidgetDef } from './widget-types.js';
import {
  PunchStateWidget,
  BreakManagementWidget,
  TodaysShiftWidget,
  MyTasksWidget,
  MyLeaveWidget,
  UpcomingHolidaysWidget,
  MySessionsWidget,
} from './widgets/personal.js';
import {
  LeaveQueueWidget,
  CorrectionsQueueWidget,
  TeamLiveWidget,
} from './widgets/queues.js';
import {
  OrgVisibleEmployeesWidget,
  OrgDeptCoverageWidget,
  OrgTeamDistributionWidget,
  OrgReadinessWidget,
} from './widgets/org.js';
import {
  AdminTeamAttendanceWidget,
  AdminActivityWidget,
  AdminCallbacksWidget,
  AdminMeetingsWidget,
  AdminPendingRequestsWidget,
  AdminSalesCallsWidget,
} from './widgets/admin.js';

const isSuperAdmin = (id: CompanyIdentity): boolean => id.user.accountType === 'super-admin';
const has = (action: string) => (id: CompanyIdentity): boolean =>
  id.capabilities.some((item) => item.action === action);
const hasBeyondOwn = (action: string) => (id: CompanyIdentity): boolean =>
  id.capabilities.some((item) => item.action === action && item.scope !== 'own');
const superAdminOr = (action: string) => (id: CompanyIdentity): boolean =>
  isSuperAdmin(id) || has(action)(id);

export const WIDGET_REGISTRY: readonly WidgetDef[] = [
  // Personal widgets are available when their underlying module capability is
  // present. This prevents a dashboard card from calling a protected endpoint
  // for accounts that do not have attendance enabled.
  {
    id: 'punch-state',
    title: 'Today',
    description: 'Your punch state and hours worked today.',
    available: (id) => !isSuperAdmin(id) && has('attendance:view-live')(id),
    defaultLayout: { w: 6, h: 4, minW: 5, minH: 4, maxW: 12, maxH: 8 },
    component: PunchStateWidget,
  },
  {
    id: 'break-management',
    title: 'Break management',
    description: 'Start a preset lunch, coffee, or personal break.',
    available: (id) => !isSuperAdmin(id) && has('attendance:view-live')(id),
    defaultLayout: { w: 12, h: 2, minW: 6, minH: 2, maxW: 12, maxH: 4 },
    component: BreakManagementWidget,
  },
  {
    id: 'todays-shift',
    title: "Today's shift",
    description: 'The shift you are on today.',
    available: (id) => !isSuperAdmin(id),
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 },
    component: TodaysShiftWidget,
  },
  {
    id: 'my-tasks',
    title: 'My open tasks',
    description: 'Your pending tasks, soonest due first.',
    available: () => true,
    defaultLayout: { w: 4, h: 4, minW: 3, minH: 3 },
    component: MyTasksWidget,
  },
  {
    id: 'my-leave',
    title: 'My leave',
    description: 'Available balance and pending requests.',
    available: () => true,
    defaultLayout: { w: 4, h: 3, minW: 2, minH: 2 },
    component: MyLeaveWidget,
  },
  {
    id: 'upcoming-holidays',
    title: 'Upcoming holidays',
    description: 'Holidays coming up in the next two months.',
    available: () => true,
    defaultLayout: { w: 4, h: 4, minW: 3, minH: 3 },
    component: UpcomingHolidaysWidget,
  },
  {
    id: 'my-sessions',
    title: 'Sessions & devices',
    description: 'Active sessions signed in to your account.',
    available: () => true,
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 },
    component: MySessionsWidget,
  },

  // Manager / HR queues
  {
    id: 'leave-queue',
    title: 'Leave queue',
    description: 'Leave requests awaiting your action.',
    available: (id) => has('leave:decide')(id) || has('leave:acknowledge')(id),
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 },
    component: LeaveQueueWidget,
  },
  {
    id: 'corrections-queue',
    title: 'Attendance corrections',
    description: 'Pending correction requests.',
    available: has('attendance:correct'),
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 },
    component: CorrectionsQueueWidget,
  },
  {
    id: 'team-live',
    title: 'Team present today',
    description: 'Live headcount by state across your team.',
    available: (id) => !isSuperAdmin(id) && hasBeyondOwn('attendance:view-live')(id),
    defaultLayout: { w: 4, h: 4, minW: 3, minH: 3 },
    component: TeamLiveWidget,
  },

  // Super admin only
  {
    id: 'org-visible-employees',
    title: 'Employees',
    description: 'Headcount in your directory.',
    available: isSuperAdmin,
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 },
    component: OrgVisibleEmployeesWidget,
  },
  {
    id: 'org-dept-coverage',
    title: 'Department coverage',
    description: 'How many employees are assigned to a department.',
    available: isSuperAdmin,
    defaultLayout: { w: 3, h: 4, minW: 3, minH: 3 },
    component: OrgDeptCoverageWidget,
  },
  {
    id: 'org-team-distribution',
    title: 'Department distribution',
    description: 'Employee count by department.',
    available: isSuperAdmin,
    defaultLayout: { w: 6, h: 5, minW: 4, minH: 4 },
    component: OrgTeamDistributionWidget,
  },
  {
    id: 'org-readiness',
    title: 'Organization readiness',
    description: 'Assignment coverage across positions, teams, and managers.',
    available: isSuperAdmin,
    defaultLayout: { w: 3, h: 5, minW: 3, minH: 4 },
    component: OrgReadinessWidget,
  },
  {
    id: 'admin-team-attendance',
    title: 'Team attendance',
    description: 'Employee punch state and live break timers.',
    available: superAdminOr('attendance:view-live'),
    defaultLayout: { w: 6, h: 5, minW: 4, minH: 4 },
    component: AdminTeamAttendanceWidget,
  },
  {
    id: 'admin-activity',
    title: 'Recent team activity',
    description: 'Latest employee actions across the workspace.',
    available: superAdminOr('audit:view'),
    defaultLayout: { w: 6, h: 5, minW: 4, minH: 4 },
    component: AdminActivityWidget,
  },
  {
    id: 'admin-sales-calls',
    title: 'Sales calls today',
    description: 'Call volume by sales team member for today.',
    available: (id) => id.enabledModules.includes('telephony') && superAdminOr('telephony:view')(id),
    defaultLayout: { w: 6, h: 5, minW: 4, minH: 4 },
    component: AdminSalesCallsWidget,
  },
  {
    id: 'admin-callbacks',
    title: 'Upcoming calls',
    description: 'New callbacks and scheduled follow-ups.',
    available: superAdminOr('callbacks:view'),
    defaultLayout: { w: 6, h: 5, minW: 4, minH: 4 },
    component: AdminCallbacksWidget,
  },
  {
    id: 'admin-meetings',
    title: 'Upcoming meetings',
    description: 'Meetings scheduled across the company.',
    available: (id) => id.enabledModules.includes('meetings') && (isSuperAdmin(id) || has('meetings:view')(id) || has('meetings:host')(id)),
    defaultLayout: { w: 6, h: 4, minW: 4, minH: 3 },
    component: AdminMeetingsWidget,
  },
  {
    id: 'admin-pending-requests',
    title: 'Pending requests',
    description: 'Open employee, attendance, sales, and expense queues.',
    available: (id) => isSuperAdmin(id) || [
      'leave:decide', 'leave:acknowledge', 'attendance:correct', 'approvals:decide', 'payables:approve-claim',
    ].some((action) => has(action)(id)),
    defaultLayout: { w: 3, h: 4, minW: 3, minH: 3 },
    component: AdminPendingRequestsWidget,
  },
];

/** Widgets the user is allowed to see, in registry order. */
export function availableWidgets(identity: CompanyIdentity): readonly WidgetDef[] {
  return WIDGET_REGISTRY.filter((widget) => widget.available(identity));
}

export function getWidget(id: string): WidgetDef | undefined {
  return WIDGET_REGISTRY.find((widget) => widget.id === id);
}
