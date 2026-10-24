import { ApplicationError } from '../../../errors.js';
export const SOCIAL_PLATFORMS = [
  'facebook',
  'instagram',
  'linkedin',
  'google_business',
  'youtube',
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export interface ProviderCapabilities {
  publishText: boolean;
  publishImages: boolean;
  publishVideo: boolean;
  accountInsights: boolean;
  postInsights: boolean;
}

/** Server-only. Encrypt the whole value before persistence; never serialize to API responses. */
export interface OAuthCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scopes: string[];
  metadata?: Record<string, unknown>;
}

export interface ProviderAccount {
  platform: SocialPlatform;
  externalId: string;
  name: string;
  profileImageUrl?: string;
  capabilities?: ProviderCapabilities;
  metadata?: Record<string, unknown>;
}

export interface DiscoveredAccount extends ProviderAccount {
  credentials: OAuthCredential;
  capabilities: ProviderCapabilities;
}

export interface SocialMedia {
  url: string;
  mimeType: string;
  sizeBytes?: number;
  /** Loaded by trusted CRM storage, never downloaded from a user-supplied URL by adapters. */
  bytes?: Uint8Array;
}

export interface SocialContent {
  caption: string;
  link?: string;
  title?: string;
  media: SocialMedia[];
  privacyStatus?: 'public' | 'private' | 'unlisted';
  madeForKids?: boolean;
  /** 'story' routes to the platform's ephemeral story primitive when available. */
  postType?: 'feed' | 'story';
}

export interface PublishInput {
  account: ProviderAccount;
  credentials: OAuthCredential;
  content: SocialContent;
  /** Most APIs do not support an idempotency header: caller must persist destination claims. */
  idempotencyKey: string;
}

export interface PublishedPost {
  externalPostId: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface InsightInput {
  account: ProviderAccount;
  credentials: OAuthCredential;
  since: string;
  until: string;
}

/** Native metric names and reporting periods are retained instead of inventing comparable totals. */
export interface ProviderInsights {
  source: SocialPlatform;
  since: string;
  until: string;
  metrics: Record<string, number>;
  series?: Array<{ date: string; metric: string; value: number }>;
  note?: string;
}

export interface SocialProvider {
  readonly platform: SocialPlatform;
  readonly capabilities: ProviderCapabilities;
  readonly supportsPkce: boolean;
  getAuthorizationUrl(input: {
    state: string;
    redirectUri: string;
    codeChallenge?: string;
  }): string;
  exchangeCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<OAuthCredential>;
  discoverAccounts(credentials: OAuthCredential): Promise<DiscoveredAccount[]>;
  refreshCredentials(credentials: OAuthCredential): Promise<OAuthCredential>;
  validatePost(content: SocialContent, account?: ProviderAccount): string[];
  publishPost(input: PublishInput): Promise<PublishedPost>;
  getPostStatus(input: {
    account: ProviderAccount;
    credentials: OAuthCredential;
    externalPostId: string;
  }): Promise<{ status: string; url?: string }>;
  getAccountInsights(input: InsightInput): Promise<ProviderInsights>;
  getPostInsights(
    input: InsightInput & { externalPostId: string },
  ): Promise<ProviderInsights>;
  revoke(credentials: OAuthCredential): Promise<void>;
}

export interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  apiVersion?: string;
  organizationEnabled?: boolean;
  insightsEnabled?: boolean;
}

export interface ProviderReadiness {
  platform: SocialPlatform;
  name: string;
  status: 'ready' | 'setup_required' | 'pending_approval';
  message: string;
  capabilities: ProviderCapabilities;
}

export class ProviderError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    public override readonly details: {
      transient?: boolean;
      retryAfter?: number;
      reconnectRequired?: boolean;
      ambiguous?: boolean;
      status?: number;
    } = {},
  ) {
    super(
      message,
      details.status === 429 ? 429 : details.transient ? 503 : 422,
      code,
      details,
    );
    this.name = 'ProviderError';
  }

  get transient(): boolean {
    return this.details.transient === true;
  }
  get retryAfter(): number | undefined {
    return this.details.retryAfter;
  }
  get reconnectRequired(): boolean {
    return this.details.reconnectRequired === true;
  }
  get ambiguous(): boolean {
    return this.details.ambiguous === true;
  }
}
