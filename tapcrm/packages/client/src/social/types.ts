import type { SocialPlatform, SocialPostStatus } from '@tapcrm/contracts';
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
  SocialSettings,
} from '@tapcrm/contracts';

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
