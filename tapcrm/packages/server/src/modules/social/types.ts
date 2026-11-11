import type {
  SocialAccount,
  SocialCompanyAssetPlatform,
  SocialPlatform,
  SocialPost,
  SocialPostDestination,
  SocialMedia,
  SocialApproval,
} from '@tapcrm/contracts';
import type { ProviderAccount } from './providers/types.js';

export interface AccountRow extends Omit<
  SocialAccount,
  'connectedAt' | 'lastSyncedAt' | 'connectionScope'
> {
  organizationId: string;
  connectionId: string;
  /** The connection's client; null when the account uses a company-wide connection. */
  connectionClientId: string | null;
  /** The connection's platform. A company Meta sign-in (`facebook`) also serves Instagram
   * accounts, and its token is sealed for the connection's platform, not the account's. */
  connectionPlatform: SocialPlatform;
  /** The company location this account was assigned from, if any. */
  locationId: string | null;
  connectedAt: Date;
  lastSyncedAt: Date | null;
  metadata: Record<string, unknown>;
  credentialsEncrypted: string | null;
  expiresAt: Date | null;
}
/** A social_connection row. `clientId` is null for a company-wide connection. */
export interface ConnectionRow {
  id: string;
  organizationId: string;
  clientId: string | null;
  platform: SocialPlatform;
  credentialsEncrypted: string | null;
  scopes: string[];
  expiresAt: Date | null;
  status: SocialAccount['status'];
  externalAccountId: string | null;
  externalAccountEmail: string | null;
  externalAccountName: string | null;
  lastDiscoveredAt: Date | null;
  lastError: string | null;
  createdBy: string;
  createdAt: Date;
}
/** A social_connection_location row: something a company connection can manage. */
export interface LocationRow {
  id: string;
  organizationId: string;
  connectionId: string;
  platform: SocialCompanyAssetPlatform;
  /** Search Console properties only: the client the property is assigned to. */
  clientId: string | null;
  externalId: string;
  name: string;
  profileImageUrl: string | null;
  capabilities: string[];
  metadata: Record<string, unknown>;
  status: 'available' | 'missing';
  firstSeenAt: Date;
  lastSeenAt: Date;
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
