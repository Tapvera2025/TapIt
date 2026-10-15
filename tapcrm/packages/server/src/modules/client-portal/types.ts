export type PortalWorkStatus = 'new' | 'ongoing' | 'ended' | 'expired';
export type PortalServiceKind = 'website' | 'seo' | 'ads' | 'smo' | 'google_marketing' | 'other';

/**
 * Client-facing projections (PRD §12.3 "Visible / not visible"). These are
 * deliberately NOT the employee `Project` type: budget, remarks, priority,
 * individual assignees and the internal discussion group are absent by
 * construction, so no future field added to `Project` can leak to a client.
 */
export interface PortalService {
  readonly service: PortalServiceKind;
  readonly otherLabel: string | null;
}

export interface PortalProject {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly workStatus: PortalWorkStatus;
  readonly startDate: Date;
  readonly expectedEndDate: Date | null;
  readonly services: readonly PortalService[];
  /** Aggregate only — never individual tasks (PRD: "Internal task detail" is not visible). */
  readonly progress: { readonly completed: number; readonly scheduled: number };
}

export interface PortalProfile {
  readonly clientName: string;
  readonly businessName: string;
  readonly email: string;
  readonly region: string;
  readonly timezone: string;
  readonly organizationName: string;
}

export interface PortalDashboard {
  readonly profile: Pick<PortalProfile, 'clientName' | 'businessName' | 'organizationName'>;
  readonly counts: Readonly<Record<PortalWorkStatus, number>>;
  readonly recentProjects: readonly PortalProject[];
}
