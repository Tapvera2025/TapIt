import type {
  SocialAccount,
  SocialPlatform,
  SocialPost,
  SocialPostDestination,
  SocialMedia,
  SocialApproval,
} from '@tapcrm/contracts';
import type { ProviderAccount } from './providers/types.js';

export interface AccountRow extends Omit<SocialAccount, 'connectedAt' | 'lastSyncedAt'> {
  organizationId: string;
  connectionId: string;
  connectedAt: Date;
  lastSyncedAt: Date | null;
  metadata: Record<string, unknown>;
  credentialsEncrypted: string | null;
  expiresAt: Date | null;
}
export interface MediaRow extends Omit<
  SocialMedia,
  'url' | 'createdAt' | 'sizeBytes' | 'durationSeconds'
> {
  objectKey: string;
  checksumSha256: string;
  sizeBytes: string;
  durationSeconds: string | null;
  createdAt: Date;
}
export interface PostRow extends Omit<
  SocialPost,
  | 'media'
  | 'destinations'
  | 'approvals'
  | 'scheduledAt'
  | 'publishedAt'
  | 'createdAt'
  | 'updatedAt'
  | 'approvedAt'
> {
  organizationId: string;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  approvedAt: Date | null;
  publishingActorId: string | null;
}
export interface DestinationRow extends Omit<
  SocialPostDestination,
  'publishedAt' | 'nextAttemptAt'
> {
  clientId: string;
  postId: string;
  idempotencyKey: string;
  leaseId: string | null;
  publishedAt: Date | null;
  nextAttemptAt: Date | null;
}
export interface ApprovalRow extends Omit<SocialApproval, 'createdAt'> {
  createdAt: Date;
}
export function providerAccount(row: AccountRow): ProviderAccount {
  return {
    platform: row.platform,
    externalId: row.externalId,
    name: row.name,
    metadata: row.metadata,
  };
}
export interface ConnectionInput {
  platform: SocialPlatform;
  credentialsEncrypted: string;
  scopes: string[];
  expiresAt: string | null;
}
