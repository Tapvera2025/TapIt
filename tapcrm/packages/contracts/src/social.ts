/** Social workspaces always belong to an existing CRM client. Secrets never appear in these DTOs. */
export const SOCIAL_PLATFORMS = [
  'facebook',
  'instagram',
  'linkedin',
  'google_business',
  'youtube',
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export const SOCIAL_POST_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'scheduled',
  'publishing',
  'published',
  'partially_published',
  'failed',
  'cancelled',
] as const;
export type SocialPostStatus = (typeof SOCIAL_POST_STATUSES)[number];
export type SocialDestinationStatus =
  | 'pending'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'cancelled'
  | 'outcome_unknown';
export interface SocialSettings {
  clientId: string;
  timezone: string;
  approvalRequired: boolean;
  clientReviewEnabled: boolean;
}
export type SocialConnectionStatus = 'connected' | 'reconnect_required' | 'disconnected';
/** `client_portal`: the client signed in from the client portal; `agency`: anyone else. */
export type SocialConnectionOrigin = 'agency' | 'client_portal';
export interface SocialAccount {
  id: string;
  clientId: string;
  platform: SocialPlatform;
  externalId: string;
  name: string;
  profileImageUrl: string | null;
  status: SocialConnectionStatus;
  /** `company`: assigned from the company's own platform sign-in. `client`: signed in for this client only. */
  connectionScope: 'client' | 'company';
  /** Who signed it in: the agency (staff, or a company login), or the client itself
   * from the client portal. Only the client may revoke a client-portal sign-in at the platform. */
  connectionOrigin: SocialConnectionOrigin;
  capabilities: string[];
  scopes: string[];
  connectedAt: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}
/** Platforms a company can sign in to once and share across its clients. A Meta
 * sign-in is `facebook` and lists the Pages and the Instagram accounts linked to them. */
export const SOCIAL_COMPANY_PLATFORMS = [
  'google_business',
  'facebook',
  'linkedin',
  'youtube',
] as const;
export type SocialCompanyPlatform = (typeof SOCIAL_COMPANY_PLATFORMS)[number];
/** What a company sign-in can list for assignment to clients. `search_console` is a
 * Search Console property: read for reporting, never published to. */
export const SOCIAL_COMPANY_ASSET_PLATFORMS = [
  ...SOCIAL_PLATFORMS,
  'search_console',
] as const;
export type SocialCompanyAssetPlatform = (typeof SOCIAL_COMPANY_ASSET_PLATFORMS)[number];
/** A company-wide platform sign-in. Its token never leaves the server. */
export interface SocialCompanyConnection {
  id: string;
  platform: SocialCompanyPlatform;
  accountEmail: string | null;
  /** The signed-in platform account's display name, when the platform shares one. */
  accountName: string | null;
  status: SocialConnectionStatus;
  connectedAt: string;
  connectedByName: string | null;
  lastDiscoveredAt: string | null;
  lastError: string | null;
  locationCount: number;
  assignedCount: number;
}
export interface SocialCompanyLocationAssignment {
  /** The client's publishing account; null for a Search Console property, which has none. */
  accountId: string | null;
  clientId: string;
  clientName: string;
  status: SocialConnectionStatus;
  /** `client_connection`: connected earlier through the client's own sign-in, not this company connection. */
  via: 'company_connection' | 'client_connection';
}
/** The client an unassigned location most likely belongs to, and why. */
export interface SocialCompanyLocationSuggestion {
  clientId: string;
  clientName: string;
  /** `website`: the location's website is one of the client's domains. `name`: the names match. */
  reason: 'website' | 'name';
}
/** Something a company sign-in can manage — a Page, Instagram account, Business Profile,
 * LinkedIn page, YouTube channel or Search Console property — and the client it serves. */
export interface SocialCompanyLocation {
  id: string;
  connectionId: string;
  platform: SocialCompanyAssetPlatform;
  externalId: string;
  name: string;
  address: string | null;
  /** A short platform-specific line, such as an Instagram username or a property's access level. */
  detail: string | null;
  websiteUrl: string | null;
  mapsUrl: string | null;
  /** `missing`: the connected account no longer manages this location. */
  status: 'available' | 'missing';
  lastSeenAt: string;
  assignment: SocialCompanyLocationAssignment | null;
  /** Only for an available, unassigned location. */
  suggestion: SocialCompanyLocationSuggestion | null;
}
export interface SocialMedia {
  id: string;
  clientId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  url: string;
  createdAt: string;
}
/** `story`: Instagram only. `reel`: one video, as a Facebook or Instagram Reel. */
export type SocialPostType = 'feed' | 'story' | 'reel';
/** YouTube visibility. */
export type SocialPrivacyStatus = 'public' | 'unlisted' | 'private';
export interface SocialPostOverride {
  caption?: string | undefined;
  title?: string | undefined;
  link?: string | undefined;
  mediaIds?: string[] | undefined;
  postType?: SocialPostType | undefined;
  /** YouTube only; an upload without one is private. */
  privacyStatus?: SocialPrivacyStatus | undefined;
}
export interface SocialPostInput {
  caption: string;
  accountIds: string[];
  mediaIds: string[];
  overrides?: Record<string, SocialPostOverride> | undefined;
  title?: string | undefined;
  link?: string | undefined;
  scheduledAt?: string | undefined;
  intent: 'draft' | 'publish' | 'schedule' | 'submit';
}
export interface SocialPostDestination {
  id: string;
  accountId: string;
  accountName: string;
  platform: SocialPlatform;
  status: SocialDestinationStatus;
  caption: string;
  title: string | null;
  link: string | null;
  mediaIds: string[];
  postType: SocialPostType;
  /** YouTube only; null uploads as private. */
  privacyStatus: SocialPrivacyStatus | null;
  platformPostId: string | null;
  platformPostUrl: string | null;
  attempts: number;
  error: string | null;
  publishedAt: string | null;
  nextAttemptAt: string | null;
}
export interface SocialApproval {
  id: string;
  decision: 'submitted' | 'approved' | 'changes_requested';
  comment: string | null;
  actorId: string;
  actorName: string;
  createdAt: string;
}
export interface SocialPost {
  id: string;
  clientId: string;
  caption: string;
  title: string | null;
  link: string | null;
  status: SocialPostStatus;
  timezone: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  media: SocialMedia[];
  sharedMediaIds: string[];
  destinations: SocialPostDestination[];
  approvals: SocialApproval[];
  approvalRequired: boolean;
  approvedAt: string | null;
}
export interface SocialPostList {
  items: SocialPost[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
export interface SocialPostQuery {
  search?: string | undefined;
  /** One status or several; the API takes them comma-separated (`draft,scheduled`). */
  status?: readonly SocialPostStatus[] | undefined;
  platform?: SocialPlatform | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  sort?: 'newest' | 'oldest' | undefined;
}
export type SocialPostAction =
  | 'publish'
  | 'schedule'
  | 'cancel'
  | 'duplicate'
  | 'submit'
  | 'approve'
  | 'request_changes';
export interface SocialPostActionInput {
  action: SocialPostAction;
  scheduledAt?: string | undefined;
  comment?: string | undefined;
}
export interface SocialAnalyticsMetric {
  key: string;
  label: string;
  value: number;
  unit?: string | undefined;
}
export interface SocialAnalyticsSnapshot {
  id: string;
  accountId: string;
  accountName: string;
  platform: SocialPlatform;
  source: string;
  periodStart: string;
  periodEnd: string;
  syncedAt: string;
  metrics: SocialAnalyticsMetric[];
  postId: string | null;
  caption: string | null;
  note: string | null;
  series: { date: string; metric: string; value: number }[];
}
/** Platform-local aggregates only. Cross-platform totals are intentionally not derived — see team-docs/setup/social-media.md. */
export interface SocialAnalyticsPlatformAggregate {
  platform: SocialPlatform;
  accountCount: number;
  /** Latest account-level counter per metric key, summed across accounts of this platform. */
  latestAccountMetrics: {
    key: string;
    label: string;
    value: number;
    asOf: string;
  }[];
  /** Sum of post-level counters across every post snapshot in the requested range for this platform. */
  postMetricTotals: { key: string; label: string; value: number; postCount: number }[];
  note: string;
}
export interface SocialAnalytics {
  snapshots: SocialAnalyticsSnapshot[];
  aggregates: SocialAnalyticsPlatformAggregate[];
  unavailable: { accountId: string; platform: SocialPlatform; reason: string }[];
}

/** Read-only Search Console property assigned to an existing CRM client. */
export interface SocialSearchConsoleProperty {
  propertyUrl: string;
  permissionLevel: string;
  status: SocialConnectionStatus;
}

export interface SocialSearchConsoleMetricSet {
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number | null;
}

export interface SocialSearchConsoleDailyMetric extends SocialSearchConsoleMetricSet {
  date: string;
}

export interface SocialSearchConsoleDimensionRow extends SocialSearchConsoleMetricSet {
  value: string;
}

export interface SocialSearchConsolePerformance {
  propertyUrl: string;
  startDate: string;
  endDate: string;
  fetchedAt: string;
  latestDataDate: string | null;
  totals: SocialSearchConsoleMetricSet | null;
  daily: SocialSearchConsoleDailyMetric[];
  queries: SocialSearchConsoleDimensionRow[];
  pages: SocialSearchConsoleDimensionRow[];
  countries: SocialSearchConsoleDimensionRow[];
  devices: SocialSearchConsoleDimensionRow[];
  rowLimitHit: { queries: boolean; pages: boolean; countries: boolean; devices: boolean };
}

export interface SocialGoogleIndexIssue {
  issueType?: string;
  severity?: string;
  message?: string;
  issueMessage?: string;
}

/** Google's indexed-version response from the Search Console URL Inspection API. */
export interface SocialGoogleIndexInspection {
  inspectionUrl: string;
  propertyUrl: string;
  inspectedAt: string;
  inspectionResultLink?: string;
  indexStatusResult?: {
    verdict?: string;
    coverageState?: string;
    robotsTxtState?: string;
    indexingState?: string;
    lastCrawlTime?: string;
    pageFetchState?: string;
    googleCanonical?: string;
    userCanonical?: string;
    sitemap?: string[];
    referringUrls?: string[];
    crawledAs?: string;
  };
  mobileUsabilityResult?: { verdict?: string; issues?: SocialGoogleIndexIssue[] };
  richResultsResult?: {
    verdict?: string;
    detectedItems?: Array<{
      richResultType?: string;
      items?: Array<{ name?: string; issues?: SocialGoogleIndexIssue[] }>;
    }>;
  };
  ampResult?: {
    verdict?: string;
    ampUrl?: string;
    lastCrawlTime?: string;
    issues?: SocialGoogleIndexIssue[];
  };
}

/* ------------------------------------------------------------------ *
 * Client portal: a client connecting its own social accounts.
 * None of these carry tokens, scopes or another client's details.
 * ------------------------------------------------------------------ */

/** Platforms the client portal offers. LinkedIn stays an agency-only connection. */
export const SOCIAL_PORTAL_PLATFORMS = [
  'facebook',
  'instagram',
  'youtube',
  'google_business',
] as const;
export type SocialPortalPlatform = (typeof SOCIAL_PORTAL_PLATFORMS)[number];

export interface SocialPortalProvider {
  platform: SocialPortalPlatform;
  name: string;
  /** `setup_required`: the agency has not finished the platform setup.
   * `unavailable`: this platform cannot be connected from the client portal. */
  status: 'ready' | 'setup_required' | 'unavailable';
  message: string;
  /** What the client needs before signing in, in plain words. */
  requirements: string[];
}

export interface SocialPortalAccount {
  id: string;
  platform: SocialPlatform;
  name: string;
  profileImageUrl: string | null;
  status: SocialConnectionStatus;
  /** `client`: the client connected it from the portal and may disconnect it.
   * `agency`: the agency manages it; the client can see it but not change it. */
  managedBy: 'client' | 'agency';
  connectedAt: string;
  /** The latest problem with the client's own account; never shown for agency accounts. */
  lastError: string | null;
}

export interface SocialPortalOverview {
  clientId: string;
  providers: SocialPortalProvider[];
  accounts: SocialPortalAccount[];
}

/** One account the platform authorized, and whether the client may choose it.
 * `available`: new. `reconnect`: already connected by this client; choosing it renews it.
 * `managed_by_agency`: the agency already manages it for this client.
 * `unavailable`: it serves a different client in this CRM; the agency has to move it. */
export interface SocialPortalCandidate {
  platform: SocialPlatform;
  externalId: string;
  name: string;
  profileImageUrl: string | null;
  availability: 'available' | 'reconnect' | 'managed_by_agency' | 'unavailable';
}

export interface SocialPortalConnectionChoice {
  state: string;
  platform: SocialPortalPlatform;
  /** How long the choice stays open after the platform authorized it. */
  expiresInMinutes: number;
  candidates: SocialPortalCandidate[];
}

export interface SocialPortalDisconnectResult {
  disconnected: true;
  revocationStatus: 'not_requested' | 'revoked' | 'remove_access_in_platform_settings';
  /** Other connections the same revoked platform login served, now waiting for a reconnect. */
  othersNeedReconnect: number;
  /** Scheduled posts for this account that were cancelled. */
  cancelledScheduledPosts: number;
}
