import {
  array,
  assertRedirectUri,
  assertUploadUrl,
  assertValid,
  bearer,
  form,
  jsonBody,
  mediaBytes,
  number,
  object,
  request,
  requiredId,
  string,
  tokenFromResponse,
  unsupported,
  uploadSignal,
  validateCommon,
  websiteUrl,
} from './http.js';
import {
  ProviderError,
  type DiscoveredAccount,
  type InsightInput,
  type OAuthCredential,
  type ProviderAccount,
  type ProviderCapabilities,
  type ProviderConfig,
  type ProviderIdentity,
  type ProviderInsights,
  type PublishedPost,
  type PublishInput,
  type SocialContent,
  type SocialMedia,
  type SocialProvider,
} from './types.js';

/** LinkedIn's accepted video sizes. */
const VIDEO_MIN_BYTES = 75 * 1024;
const VIDEO_MAX_BYTES = 500 * 1024 * 1024;

export class LinkedInProvider implements SocialProvider {
  readonly platform = 'linkedin' as const;
  // The confidential web application flow documents a client secret, not PKCE.
  readonly supportsPkce = false;
  readonly capabilities: ProviderCapabilities;
  private readonly version: string;
  private readonly scopes: string[];

  constructor(private readonly config: ProviderConfig) {
    this.version = config.apiVersion ?? '202609';
    if (!/^20\d{4}$/.test(this.version))
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        'Configure a supported LinkedIn API version in YYYYMM format.',
      );
    this.scopes = ['openid', 'profile', 'w_member_social'];
    if (config.organizationEnabled)
      this.scopes.push('w_organization_social', 'r_organization_admin');
    if (config.insightsEnabled && config.organizationEnabled)
      this.scopes.push('r_organization_social');
    this.capabilities = {
      publishText: true,
      publishImages: true,
      publishVideo: true,
      accountInsights: Boolean(config.organizationEnabled && config.insightsEnabled),
      postInsights: Boolean(config.organizationEnabled && config.insightsEnabled),
    };
  }

  private headers(credentials: OAuthCredential): Record<string, string> {
    return {
      ...bearer(credentials.accessToken),
      'Linkedin-Version': this.version,
      'X-Restli-Protocol-Version': '2.0.0',
    };
  }

  getAuthorizationUrl(input: { state: string; redirectUri: string }): string {
    assertRedirectUri(input.redirectUri);
    const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
    url.search = form({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: input.redirectUri,
      state: input.state,
      scope: this.scopes.join(' '),
    }).toString();
    return url.toString();
  }

  async exchangeCode(input: {
    code: string;
    redirectUri: string;
  }): Promise<OAuthCredential> {
    assertRedirectUri(input.redirectUri);
    const result = await request('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      body: form({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });
    const credentials = tokenFromResponse(result.data, this.scopes);
    if (!this.scopes.every((scope) => credentials.scopes.includes(scope)))
      throw new ProviderError(
        'OAUTH_PERMISSIONS_MISSING',
        'Required LinkedIn permissions were not granted. Check the enabled products and reconnect.',
      );
    return credentials;
  }

  async refreshCredentials(credentials: OAuthCredential): Promise<OAuthCredential> {
    if (!credentials.refreshToken)
      throw new ProviderError(
        'RECONNECT_REQUIRED',
        'LinkedIn refresh tokens are available only to approved partners. Reconnect this account.',
        { reconnectRequired: true },
      );
    const result = await request('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      body: form({
        grant_type: 'refresh_token',
        refresh_token: credentials.refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });
    return tokenFromResponse(result.data, credentials.scopes, credentials);
  }

  async getAuthorizedIdentity(credentials: OAuthCredential): Promise<ProviderIdentity> {
    const user = await request('https://api.linkedin.com/v2/userinfo', {
      headers: bearer(credentials.accessToken),
    });
    const externalAccountId = string(user.data['sub']);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(externalAccountId))
      throw new ProviderError(
        'PROVIDER_RESPONSE_INVALID',
        'LinkedIn did not identify the signed-in member. Connect again.',
      );
    const name = string(user.data['name']).trim().slice(0, 200);
    return { externalAccountId, ...(name ? { name } : {}) };
  }

  async discoverAccounts(credentials: OAuthCredential): Promise<DiscoveredAccount[]> {
    const user = await request('https://api.linkedin.com/v2/userinfo', {
      headers: bearer(credentials.accessToken),
    });
    const sub = requiredId(user.data['sub']);
    const photo = string(user.data['picture']);
    const accounts: DiscoveredAccount[] = [
      {
        platform: 'linkedin',
        externalId: `urn:li:person:${sub}`,
        name: string(user.data['name']) || 'LinkedIn member',
        credentials,
        capabilities: {
          ...this.capabilities,
          accountInsights: false,
          postInsights: false,
        },
        metadata: { accountType: 'member' },
        ...(photo ? { profileImageUrl: photo } : {}),
      },
    ];
    if (!this.config.organizationEnabled) return accounts;
    const seen = new Set<string>();
    for (let page = 0; page < 50; page += 1) {
      const url = new URL('https://api.linkedin.com/rest/organizationAcls');
      url.search = form({
        q: 'roleAssignee',
        state: 'APPROVED',
        start: String(page * 100),
        count: '100',
      }).toString();
      const result = await request(url, { headers: this.headers(credentials) });
      const elements = array(result.data['elements']);
      for (const acl of elements) {
        if (
          ![
            'ADMINISTRATOR',
            'CONTENT_ADMIN',
            'CONTENT_ADMINISTRATOR',
            'DIRECT_SPONSORED_CONTENT_POSTER',
          ].includes(string(acl['role']))
        )
          continue;
        const urn = string(acl['organization']) || string(acl['organizationTarget']);
        if (!/^urn:li:organization:\d+$/.test(urn) || seen.has(urn)) continue;
        seen.add(urn);
        const organization = await request(
          `https://api.linkedin.com/rest/organizations/${urn.split(':').at(-1)}`,
          { headers: this.headers(credentials) },
        );
        const website = websiteUrl(organization.data['localizedWebsite']);
        accounts.push({
          platform: 'linkedin',
          externalId: urn,
          name:
            string(organization.data['localizedName']) ||
            string(organization.data['vanityName']) ||
            urn,
          credentials,
          capabilities: this.capabilities,
          metadata: {
            accountType: 'organization',
            role: string(acl['role']),
            ...(website ? { websiteUri: website } : {}),
          },
        });
      }
      const next = array(object(result.data['paging'])['links']).some(
        (link) => link['rel'] === 'next',
      );
      if (!next && elements.length < 100) return accounts;
    }
    throw new ProviderError(
      'ACCOUNT_DISCOVERY_LIMIT',
      'Too many LinkedIn organizations were returned. Contact support.',
    );
  }

  validatePost(content: SocialContent, account?: ProviderAccount): string[] {
    const errors = validateCommon(content, 3000);
    if (content.media.length > 1)
      errors.push(
        'LinkedIn currently supports one image or video per post in this integration.',
      );
    if (
      content.media.some(
        (media) => !['image/jpeg', 'image/png', 'video/mp4'].includes(media.mimeType),
      )
    )
      errors.push(
        'LinkedIn accepts one JPEG/PNG image or one MP4 video here. Documents and multi-image publishing are unavailable.',
      );
    if (
      content.media.some(
        (media) =>
          media.mimeType === 'video/mp4' &&
          media.sizeBytes !== undefined &&
          (media.sizeBytes < VIDEO_MIN_BYTES || media.sizeBytes > VIDEO_MAX_BYTES),
      )
    )
      errors.push('LinkedIn videos must be between 75 KB and 500 MB.');
    if (content.link && content.media.length)
      errors.push('Choose a LinkedIn article link or a media attachment.');
    if (
      account?.externalId.startsWith('urn:li:organization:') &&
      !this.config.organizationEnabled
    )
      errors.push(
        'LinkedIn organization publishing requires approved Community Management access.',
      );
    return errors;
  }

  async publishPost(input: PublishInput): Promise<PublishedPost> {
    assertValid(this.validatePost(input.content, input.account));
    if (
      !/^urn:li:(person:[A-Za-z0-9_-]+|organization:\d+)$/.test(input.account.externalId)
    )
      throw new ProviderError(
        'ACCOUNT_METADATA_INVALID',
        'Reconnect this LinkedIn account.',
      );
    const post: Record<string, unknown> = {
      author: input.account.externalId,
      commentary: input.content.caption,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    const media = input.content.media[0];
    if (media?.mimeType.startsWith('video/')) {
      post['content'] = {
        media: {
          id: await this.uploadVideo(input, media),
          ...(input.content.title ? { title: input.content.title } : {}),
        },
      };
    } else if (media) {
      if (!media.bytes?.length)
        throw new ProviderError(
          'MEDIA_BYTES_REQUIRED',
          'The image must be loaded from CRM storage before publishing.',
        );
      const body = jsonBody({
        initializeUploadRequest: { owner: input.account.externalId },
      });
      const init = await request(
        'https://api.linkedin.com/rest/images?action=initializeUpload',
        {
          method: 'POST',
          ...body,
          headers: { ...body.headers, ...this.headers(input.credentials) },
        },
      );
      const value = object(init.data['value']);
      const uploadUrl = string(value['uploadUrl']);
      assertUploadUrl(uploadUrl, ['linkedin.com', 'licdn.com']);
      await request(uploadUrl, {
        method: 'PUT',
        headers: {
          ...bearer(input.credentials.accessToken),
          'Content-Type': media.mimeType,
        },
        body: Buffer.from(media.bytes),
      });
      post['content'] = {
        media: {
          id: requiredId(value['image']),
          ...(input.content.title ? { title: input.content.title } : {}),
        },
      };
    } else if (input.content.link) {
      post['content'] = {
        article: {
          source: input.content.link,
          title:
            input.content.title || input.content.caption.slice(0, 100) || 'Read more',
        },
      };
    }
    const body = jsonBody(post);
    const result = await request(
      'https://api.linkedin.com/rest/posts',
      {
        method: 'POST',
        ...body,
        headers: { ...body.headers, ...this.headers(input.credentials) },
      },
      true,
    );
    const id = requiredId(result.response.headers.get('x-restli-id'));
    return {
      externalPostId: id,
      url: `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/`,
    };
  }

  /** LinkedIn's Videos API: initialize, upload each part it asks for, finalize, then
   * wait until the video is AVAILABLE — a post cannot use it before. Nothing is
   * published until the post itself is created, so a retry here is always safe. */
  private async uploadVideo(input: PublishInput, media: SocialMedia): Promise<string> {
    const bytes = mediaBytes(media);
    const headers = this.headers(input.credentials);
    const start = jsonBody({
      initializeUploadRequest: {
        owner: input.account.externalId,
        fileSizeBytes: bytes.byteLength,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    });
    const started = await request(
      'https://api.linkedin.com/rest/videos?action=initializeUpload',
      { method: 'POST', ...start, headers: { ...start.headers, ...headers } },
    );
    const value = object(started.data['value']);
    const video = string(value['video']);
    if (!/^urn:li:video:[A-Za-z0-9_-]+$/.test(video))
      throw new ProviderError(
        'PROVIDER_RESPONSE_INVALID',
        'LinkedIn did not start the video upload. Try again.',
      );
    const parts: string[] = [];
    for (const instruction of array(value['uploadInstructions'])) {
      const uploadUrl = string(instruction['uploadUrl']);
      assertUploadUrl(uploadUrl, ['linkedin.com', 'licdn.com']);
      const first = number(instruction['firstByte']);
      const last = number(instruction['lastByte']);
      if (
        !Number.isInteger(first) ||
        !Number.isInteger(last) ||
        first < 0 ||
        last < first ||
        last >= bytes.byteLength
      )
        throw new ProviderError(
          'PROVIDER_RESPONSE_INVALID',
          'LinkedIn returned an invalid upload range. Try again.',
        );
      // Upload URLs are pre-signed; the API token is not sent to them.
      const part = await request(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(bytes.subarray(first, last + 1)),
        signal: uploadSignal(),
      });
      const etag = part.response.headers.get('etag');
      if (!etag)
        throw new ProviderError(
          'UPLOAD_FAILED',
          'LinkedIn did not confirm a video part. Publishing will retry.',
          { transient: true, retryAfter: 60 },
        );
      parts.push(etag);
    }
    if (!parts.length)
      throw new ProviderError(
        'PROVIDER_RESPONSE_INVALID',
        'LinkedIn did not say where to upload the video. Try again.',
      );
    const finish = jsonBody({
      finalizeUploadRequest: {
        video,
        uploadToken: string(value['uploadToken']),
        uploadedPartIds: parts,
      },
    });
    await request('https://api.linkedin.com/rest/videos?action=finalizeUpload', {
      method: 'POST',
      ...finish,
      headers: { ...finish.headers, ...headers },
    });
    for (let attempt = 0; attempt < 15; attempt += 1) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 2000));
      const status = await request(
        `https://api.linkedin.com/rest/videos/${encodeURIComponent(video)}`,
        { headers },
      );
      const state = string(status.data['status']);
      if (state === 'AVAILABLE') return video;
      if (state === 'PROCESSING_FAILED')
        throw new ProviderError(
          'MEDIA_PROCESSING_FAILED',
          'LinkedIn could not process the video. Use an MP4 of 3 seconds to 30 minutes.',
        );
    }
    throw new ProviderError(
      'MEDIA_PROCESSING_PENDING',
      'LinkedIn is still processing the video. Publishing will retry.',
      { transient: true, retryAfter: 120 },
    );
  }

  async getPostStatus(input: {
    account: ProviderAccount;
    credentials: OAuthCredential;
    externalPostId: string;
  }): Promise<{ status: string; url?: string }> {
    if (
      !input.account.externalId.startsWith('urn:li:organization:') ||
      !input.credentials.scopes.includes('r_organization_social')
    )
      return unsupported(
        'Reading LinkedIn member posts is restricted. The returned publish ID remains the authoritative publishing result.',
      );
    const result = await request(
      `https://api.linkedin.com/rest/posts/${encodeURIComponent(input.externalPostId)}?viewContext=AUTHOR`,
      { headers: this.headers(input.credentials) },
    );
    return {
      status: string(result.data['lifecycleState']),
      url: `https://www.linkedin.com/feed/update/${encodeURIComponent(input.externalPostId)}/`,
    };
  }

  async getAccountInsights(input: InsightInput): Promise<ProviderInsights> {
    return this.insights(input);
  }
  async getPostInsights(
    input: InsightInput & { externalPostId: string },
  ): Promise<ProviderInsights> {
    return this.insights(input, input.externalPostId);
  }

  private async insights(
    input: InsightInput,
    postId?: string,
  ): Promise<ProviderInsights> {
    if (
      !this.capabilities.accountInsights ||
      !input.account.externalId.startsWith('urn:li:organization:')
    )
      return unsupported(
        'LinkedIn analytics requires approved organization reporting access. Member analytics is unavailable in this integration.',
      );
    const url = new URL(
      'https://api.linkedin.com/rest/organizationalEntityShareStatistics',
    );
    url.searchParams.set('q', 'organizationalEntity');
    url.searchParams.set('organizationalEntity', input.account.externalId);
    if (postId) {
      if (postId.startsWith('urn:li:ugcPost:'))
        url.searchParams.set('ugcPosts', `List(${postId})`);
      else if (postId.startsWith('urn:li:share:'))
        url.searchParams.set('shares', `List(${postId})`);
      else
        throw new ProviderError(
          'POST_ID_INVALID',
          'LinkedIn analytics requires the returned share or UGC post ID.',
        );
    } else {
      const start = Date.parse(input.since);
      const end = Date.parse(input.until);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        throw new ProviderError(
          'DATE_RANGE_INVALID',
          'Choose a valid analytics date range.',
        );
      url.searchParams.set(
        'timeIntervals',
        `(timeRange:(start:${start},end:${end}),timeGranularityType:DAY)`,
      );
    }
    const result = await request(url, { headers: this.headers(input.credentials) });
    const metrics: Record<string, number> = {};
    const series: Array<{ date: string; metric: string; value: number }> = [];
    for (const item of array(result.data['elements'])) {
      const stats = object(item['totalShareStatistics']);
      const start = number(object(item['timeRange'])['start']);
      for (const [metric, raw] of Object.entries(stats)) {
        const value = number(raw);
        // Ratios and daily unique counts cannot be summed across dates.
        if (
          postId ||
          !['engagement', 'uniqueImpressionsCount', 'uniqueImpressionsCounts'].includes(
            metric,
          )
        )
          metrics[metric] = (metrics[metric] ?? 0) + value;
        if (start)
          series.push({
            date: new Date(start).toISOString().slice(0, 10),
            metric,
            value,
          });
      }
    }
    const now = new Date().toISOString();
    return {
      source: 'linkedin',
      since: postId ? now : input.since,
      until: postId ? now : input.until,
      metrics,
      series,
      note: postId
        ? 'LinkedIn cumulative organic share statistics. Post reports do not support date ranges.'
        : 'LinkedIn organic share statistics. Sponsored activity is excluded. Daily unique counts and engagement ratios are retained only in the series.',
    };
  }

  async revoke(_credentials: OAuthCredential): Promise<void> {
    return unsupported(
      'LinkedIn does not document a general token revocation API. Remove the CRM from LinkedIn Settings → Data privacy → Permitted services after disconnecting locally.',
    );
  }
}
