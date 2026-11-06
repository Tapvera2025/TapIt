import type { ReportPeriod } from '../projects/reports/period.js';

export type PortalWorkStatus = 'new' | 'ongoing' | 'ended' | 'expired';
export type PortalServiceKind = 'website' | 'seo' | 'ads' | 'smo' | 'google_marketing' | 'other';

/**
 * Client-facing projections (PRD §12.3 "Visible / not visible"). These are
 * deliberately NOT the employee `Project` type: budget, remarks, priority,
 * assignment controls/IDs and the internal discussion group are absent by
 * construction, so no future field added to `Project` can leak to a client.
 */
export interface PortalService {
  readonly service: PortalServiceKind;
  readonly otherLabel: string | null;
}

export interface PortalAssignee {
  readonly fullName: string;
}

/** Public blog preview fields; internal notes and author identity stay private. */
export interface PortalBlogPost {
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
  readonly description: string | null;
  readonly category: string;
  readonly status: 'draft' | 'published' | 'archived';
  readonly publishDate: Date | null;
  readonly wordCount: number;
  readonly targetKeywords: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PortalBlogReport {
  readonly period: ReportPeriod;
  readonly overview: {
    readonly totalBlogs: number;
    readonly publishedBlogs: number;
    readonly draftBlogs: number;
    readonly archivedBlogs: number;
    readonly lastUpdatedAt: Date | null;
  };
  readonly blogs: {
    readonly items: readonly PortalBlogPost[];
    readonly total: number;
    readonly page: number;
    readonly pageSize: number;
    readonly totalPages: number;
  };
}

export interface PortalKeyword {
  readonly id: string;
  readonly keyword: string;
  readonly pastRank: number | null;
  readonly previousRank: number | null;
  readonly currentRank: number | null;
  readonly targetUrl: string | null;
  readonly searchEngine: string;
  readonly country: string;
  readonly city: string | null;
  readonly device: 'desktop' | 'mobile';
  readonly priority: 'low' | 'medium' | 'high';
  readonly category: 'seo' | 'gmb';
  readonly lastCheckedAt: Date | null;
  readonly trend: 'improving' | 'declining' | 'stagnant' | 'unclassified';
  readonly rankChange: number | null;
}

export interface PortalKeywordReport {
  readonly period: ReportPeriod;
  readonly overview: { readonly totalKeywords: number; readonly improving: number; readonly declining: number; readonly stagnant: number; readonly unclassified: number; readonly averageCurrentRank: number | null };
  readonly keywords: { readonly items: readonly PortalKeyword[]; readonly total: number; readonly page: number; readonly pageSize: number; readonly totalPages: number };
}

export interface PortalBacklink {
  readonly id: string;
  readonly url: string;
  readonly category: 'social_media' | 'others';
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PortalBacklinkPage {
  readonly items: readonly PortalBacklink[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly kpis: { readonly total: number; readonly socialMedia: number; readonly others: number };
}

export interface PortalScreenshot {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly originalFilename: string;
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly sizeBytes: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PortalScreenshotPage {
  readonly items: readonly PortalScreenshot[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

export interface PortalProject {
  readonly id: string;
  readonly name: string;
  readonly clientName: string;
  readonly businessName: string;
  readonly description: string | null;
  readonly workStatus: PortalWorkStatus;
  readonly startDate: Date;
  readonly expectedEndDate: Date | null;
  readonly services: readonly PortalService[];
  /** Read-only display names; employee IDs and assignment controls stay private. */
  readonly assignedEmployees: readonly PortalAssignee[];
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
