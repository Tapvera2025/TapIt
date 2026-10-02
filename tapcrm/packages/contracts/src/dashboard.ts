/**
 * Dashboard widget catalog and per-user preferences.
 *
 * Adding a new widget: extend {@link DASHBOARD_WIDGET_IDS} here and register a
 * matching entry in the client-side registry. The server rejects any id not
 * present in {@link DASHBOARD_WIDGET_IDS} when persisting preferences.
 */

export const DASHBOARD_WIDGET_IDS = [
  'punch-state',
  'todays-shift',
  'my-tasks',
  'my-leave',
  'upcoming-holidays',
  'my-sessions',
  'leave-queue',
  'corrections-queue',
  'team-live',
  'org-visible-employees',
  'org-dept-coverage',
  'org-team-distribution',
  'org-readiness',
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

/** A single widget's placement on the responsive grid. */
export interface DashboardLayoutItem {
  readonly i: DashboardWidgetId;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface DashboardPreferences {
  readonly layout: readonly DashboardLayoutItem[];
  readonly hidden: readonly DashboardWidgetId[];
  readonly updatedAt: string | null;
}

export interface DashboardPreferencesInput {
  readonly layout: readonly DashboardLayoutItem[];
  readonly hidden: readonly DashboardWidgetId[];
}
