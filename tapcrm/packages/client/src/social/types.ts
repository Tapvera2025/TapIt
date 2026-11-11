import type {
  SocialCompanyAssetPlatform,
  SocialCompanyPlatform,
  SocialPlatform,
  SocialPostStatus,
} from '@tapcrm/contracts';
export type {
  SocialAccount,
  SocialAnalytics,
  SocialAnalyticsSnapshot,
  SocialApproval,
  SocialMedia,
  SocialPlatform,
  SocialPost,
  SocialPostAction,
  SocialPostInput,
  SocialPostList as SocialPostPage,
  SocialPostStatus,
  SocialGoogleIndexInspection,
  SocialSearchConsoleDimensionRow,
  SocialSearchConsoleDailyMetric,
  SocialSearchConsoleMetricSet,
  SocialSearchConsolePerformance,
  SocialSearchConsoleProperty,
  SocialSettings,
  SocialCompanyAssetPlatform,
  SocialCompanyConnection,
  SocialCompanyLocation,
  SocialCompanyLocationSuggestion,
  SocialCompanyPlatform,
  SocialPostType,
  SocialPrivacyStatus,
} from '@tapcrm/contracts';
export { SOCIAL_COMPANY_PLATFORMS } from '@tapcrm/contracts';

export interface SocialProvider {
  platform: SocialPlatform;
  name: string;
  status: string;
  message: string;
  capabilities: {
    publishText: boolean;
    publishImages: boolean;
    publishVideo: boolean;
    accountInsights: boolean;
    postInsights: boolean;
  };
}
export interface SocialClient {
  id: string;
  clientName: string;
  businessName: string;
  timezone: string;
  status: string;
}
export interface SocialClientPage {
  items: SocialClient[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  google_business: 'Google Business Profile',
  youtube: 'YouTube',
};
/** Everything a company login can list, including Search Console properties. */
export const ASSET_LABELS: Record<SocialCompanyAssetPlatform, string> = {
  ...PLATFORM_LABELS,
  search_console: 'Search Console',
};
/** How each company login is named. A Facebook login also brings Instagram. */
export const COMPANY_LOGIN_LABELS: Record<
  SocialCompanyPlatform,
  { connect: string; account: string; lists: string }
> = {
  google_business: {
    connect: 'Google',
    account: 'Google account',
    lists: 'Business Profiles and Search Console properties',
  },
  facebook: {
    connect: 'Facebook + Instagram',
    account: 'Facebook login',
    lists: 'Facebook Pages and their Instagram accounts',
  },
  linkedin: {
    connect: 'LinkedIn',
    account: 'LinkedIn login',
    lists: 'LinkedIn pages it administers',
  },
  youtube: {
    connect: 'YouTube channel',
    account: 'YouTube channel',
    lists: 'the YouTube channel chosen when signing in',
  },
};
export const STATUS_LABELS: Record<SocialPostStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  scheduled: 'Scheduled',
  publishing: 'Publishing',
  published: 'Published',
  partially_published: 'Partially published',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
