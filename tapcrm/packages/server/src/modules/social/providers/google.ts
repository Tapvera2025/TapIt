import {
  array,
  assertRedirectUri,
  assertUploadUrl,
  assertValid,
  bearer,
  form,
  jsonBody,
  number,
  object,
  request,
  requiredId,
  string,
  tokenFromResponse,
  unsupported,
  validateCommon,
} from './http.js';
import {
  ProviderError,
  type DiscoveredAccount,
  type InsightInput,
  type OAuthCredential,
  type ProviderAccount,
  type ProviderCapabilities,
  type ProviderConfig,
  type ProviderInsights,
  type PublishedPost,
  type ProviderIdentity,
  type PublishInput,
  type SocialContent,
  type SocialProvider,
} from './types.js';

const BUSINESS_SCOPE = 'https://www.googleapis.com/auth/business.manage';
/** `openid` + email identify WHICH Google account signed in, so reconnecting the same
 * account updates one stored token instead of minting another. Google keeps at most
 * 100 refresh tokens per account per OAuth client and silently cancels the oldest. */
const BUSINESS_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  BUSINESS_SCOPE,
];
const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

export class GoogleProvider implements SocialProvider {
  readonly supportsPkce = true;
  readonly capabilities: ProviderCapabilities;
  private readonly scopes: string[];

  constructor(
    readonly platform: 'google_business' | 'youtube',
    private readonly config: ProviderConfig,
  ) {
    this.scopes = platform === 'youtube' ? YOUTUBE_SCOPES : BUSINESS_SCOPES;
    this.capabilities = {
      publishText: platform === 'google_business',
      publishImages: platform === 'google_business',
      publishVideo: platform === 'youtube',
      accountInsights: true,
      postInsights: platform === 'youtube',
    };
  }

  getAuthorizationUrl(input: {
    state: string;
    redirectUri: string;
    codeChallenge?: string;
  }): string {
    assertRedirectUri(input.redirectUri);
    if (!input.codeChallenge)
      throw new ProviderError(
        'PKCE_REQUIRED',
        'A PKCE challenge is required for this connection.',
      );
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = form({
      client_id: this.config.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: this.scopes.join(' '),
      state: input.state,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  async exchangeCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<OAuthCredential> {
    assertRedirectUri(input.redirectUri);
    if (!input.codeVerifier)
      throw new ProviderError(
        'PKCE_REQUIRED',
        'The PKCE verifier is missing. Start the connection again.',
      );
    const result = await request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: form({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: input.codeVerifier,
      }),
    });
    const credentials = tokenFromResponse(result.data, this.scopes);
    if (!this.scopes.every((scope) => credentials.scopes.includes(scope)))
      throw new ProviderError(
        'OAUTH_PERMISSIONS_MISSING',
        'Required Google permissions were not granted. Reconnect and grant all required permissions.',
      );
    return credentials;
  }

  async refreshCredentials(credentials: OAuthCredential): Promise<OAuthCredential> {
    if (!credentials.refreshToken)
      throw new ProviderError(
        'RECONNECT_REQUIRED',
        'Google did not grant offline access. Reconnect this account.',
        { reconnectRequired: true },
      );
    const result = await request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: form({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    return tokenFromResponse(result.data, credentials.scopes, credentials);
  }

  async getAuthorizedIdentity(credentials: OAuthCredential): Promise<ProviderIdentity> {
    const result = await request('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: bearer(credentials.accessToken),
    });
    const externalAccountId = string(result.data['sub']);
    if (!/^[A-Za-z0-9_-]{1,255}$/.test(externalAccountId))
      throw new ProviderError(
        'PROVIDER_RESPONSE_INVALID',
        'Google did not identify the signed-in account. Connect again.',
      );
    const email = string(result.data['email']).slice(0, 320);
    return { externalAccountId, ...(email ? { email } : {}) };
  }

  async discoverAccounts(credentials: OAuthCredential): Promise<DiscoveredAccount[]> {
    if (this.platform === 'youtube') {
      const url = new URL('https://www.googleapis.com/youtube/v3/channels');
      url.search = form({
        mine: 'true',
        part: 'id,snippet',
        maxResults: '50',
      }).toString();
      const result = await request(url, { headers: bearer(credentials.accessToken) });
      return array(result.data['items']).map((item) => {
        const snippet = object(item['snippet']);
        const image = string(object(object(snippet['thumbnails'])['default'])['url']);
        return {
          platform: 'youtube',
          externalId: requiredId(item['id']),
          name: string(snippet['title']),
          credentials,
          capabilities: this.capabilities,
          ...(image ? { profileImageUrl: image } : {}),
        };
      });
    }
    const accounts: Record<string, unknown>[] = [];
    let pageToken = '';
    for (let page = 0; page < 50; page += 1) {
      const url = new URL(
        'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      );
      url.search = form({
        pageSize: '20',
        ...(pageToken ? { pageToken } : {}),
      }).toString();
      const result = await request(url, { headers: bearer(credentials.accessToken) });
      accounts.push(...array(result.data['accounts']));
      pageToken = string(result.data['nextPageToken']);
      if (!pageToken) break;
      if (page === 49)
        throw new ProviderError(
          'ACCOUNT_DISCOVERY_LIMIT',
          'Too many business accounts were returned. Contact support.',
        );
    }
    const discovered: DiscoveredAccount[] = [];
    const seen = new Set<string>();
    for (const account of accounts) {
      const accountName = string(account['name']);
      if (!/^accounts\/[^/]+$/.test(accountName)) continue;
      pageToken = '';
      for (let page = 0; page < 50; page += 1) {
        const url = new URL(
          `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`,
        );
        url.search = form({
          readMask: 'name,title,metadata,storefrontAddress,websiteUri',
          pageSize: '100',
          ...(pageToken ? { pageToken } : {}),
        }).toString();
        const result = await request(url, { headers: bearer(credentials.accessToken) });
        for (const location of array(result.data['locations'])) {
          const name = string(location['name']);
          if (!/^locations\/[^/]+$/.test(name) || seen.has(name)) continue;
          seen.add(name);
          const address = postalAddress(location['storefrontAddress']);
          const websiteUri = string(location['websiteUri']);
          discovered.push({
            platform: 'google_business',
            externalId: name,
            name: string(location['title']),
            credentials,
            capabilities: this.capabilities,
            metadata: {
              accountName,
              locationName: name,
              placeId: string(object(location['metadata'])['placeId']),
              mapsUri: string(object(location['metadata'])['mapsUri']),
              ...(address ? { address } : {}),
              ...(websiteUri ? { websiteUri } : {}),
            },
          });
        }
        pageToken = string(result.data['nextPageToken']);
        if (!pageToken) break;
        if (page === 49)
          throw new ProviderError(
            'ACCOUNT_DISCOVERY_LIMIT',
            'Too many business locations were returned. Contact support.',
          );
      }
    }
    return discovered;
  }

  validatePost(content: SocialContent, _account?: ProviderAccount): string[] {
    const errors = validateCommon(content, this.platform === 'youtube' ? 5000 : 1500);
    if (this.platform === 'youtube') {
      if (content.media.length !== 1 || !content.media[0]?.mimeType.startsWith('video/'))
        errors.push(
          'YouTube requires exactly one video. Text, images, and community posts are unavailable.',
        );
      if (!content.title?.trim() || content.title.length > 100)
        errors.push('YouTube requires a title containing 1–100 characters.');
      if (
        content.title?.includes('<') ||
        content.title?.includes('>') ||
        /[<>]/.test(content.caption)
      )
        errors.push('YouTube titles and descriptions cannot contain angle brackets.');
      if (content.link)
        errors.push(
          'Include links in the YouTube description instead of attaching a link.',
        );
    } else {
      if (!content.caption.trim())
        errors.push('Google Business Profile requires a post summary.');
      if (content.media.length > 1)
        errors.push(
          'Google Business Profile currently supports one image per post here.',
        );
      if (
        content.media.some(
          (media) => !['image/jpeg', 'image/png'].includes(media.mimeType),
        )
      )
        errors.push(
          'Google Business Profile posts support JPEG/PNG images here; video posts are unavailable.',
        );
    }
    return errors;
  }

  async publishPost(input: PublishInput): Promise<PublishedPost> {
    assertValid(this.validatePost(input.content, input.account));
    if (this.platform === 'youtube') return this.publishYoutube(input);
    const parent = this.businessParent(input.account);
    const body = jsonBody({
      languageCode: 'en',
      summary: input.content.caption,
      topicType: 'STANDARD',
      ...(input.content.link
        ? { callToAction: { actionType: 'LEARN_MORE', url: input.content.link } }
        : {}),
      ...(input.content.media.length
        ? {
            media: input.content.media.map((media) => ({
              mediaFormat: 'PHOTO',
              sourceUrl: media.url,
            })),
          }
        : {}),
    });
    const result = await request(
      `https://mybusiness.googleapis.com/v4/${parent}/localPosts`,
      {
        method: 'POST',
        ...body,
        headers: { ...body.headers, ...bearer(input.credentials.accessToken) },
      },
      true,
    );
    const id = requiredId(result.data['name']);
    const url = string(result.data['searchUrl']);
    return {
      externalPostId: id,
      ...(url ? { url } : {}),
      metadata: { platformState: string(result.data['state']) },
    };
  }

  private businessParent(account: ProviderAccount): string {
    const accountName = string(account.metadata?.['accountName']);
    if (
      !/^accounts\/[A-Za-z0-9_-]+$/.test(accountName) ||
      !/^locations\/[A-Za-z0-9_-]+$/.test(account.externalId)
    )
      throw new ProviderError(
        'ACCOUNT_METADATA_INVALID',
        'Reconnect this business location to restore account metadata.',
      );
    return `${accountName}/${account.externalId}`;
  }

  private async publishYoutube(input: PublishInput): Promise<PublishedPost> {
    const media = input.content.media[0];
    if (!media?.bytes?.length)
      throw new ProviderError(
        'MEDIA_BYTES_REQUIRED',
        'The video must be loaded from CRM storage before publishing.',
      );
    // Explicit privacy avoids the platform default changing publication intent.
    const body = jsonBody({
      snippet: {
        title: input.content.title,
        description: input.content.caption,
        categoryId: '22',
      },
      status: {
        privacyStatus: input.content.privacyStatus ?? 'private',
        selfDeclaredMadeForKids: input.content.madeForKids ?? false,
      },
    });
    const init = await request(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        ...body,
        headers: {
          ...body.headers,
          ...bearer(input.credentials.accessToken),
          'X-Upload-Content-Type': media.mimeType,
          'X-Upload-Content-Length': String(media.bytes.byteLength),
        },
      },
    );
    const uploadUrl = init.response.headers.get('location') ?? '';
    assertUploadUrl(uploadUrl, ['googleapis.com']);
    const uploaded = await request(
      uploadUrl,
      {
        method: 'PUT',
        headers: {
          ...bearer(input.credentials.accessToken),
          'Content-Type': media.mimeType,
          'Content-Length': String(media.bytes.byteLength),
        },
        body: Buffer.from(media.bytes),
        signal: AbortSignal.timeout(120_000),
      },
      true,
    );
    const id = requiredId(uploaded.data['id']);
    return {
      externalPostId: id,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
      metadata: {
        platformState: string(object(uploaded.data['status'])['uploadStatus']),
        privacyStatus: string(object(uploaded.data['status'])['privacyStatus']),
      },
    };
  }

  async getPostStatus(input: {
    account: ProviderAccount;
    credentials: OAuthCredential;
    externalPostId: string;
  }): Promise<{ status: string; url?: string }> {
    if (this.platform === 'google_business') {
      if (
        !input.externalPostId.startsWith(
          `${this.businessParent(input.account)}/localPosts/`,
        )
      )
        throw new ProviderError(
          'POST_ID_INVALID',
          'The post does not belong to this location.',
        );
      const result = await request(
        `https://mybusiness.googleapis.com/v4/${input.externalPostId}`,
        { headers: bearer(input.credentials.accessToken) },
      );
      const url = string(result.data['searchUrl']);
      return { status: string(result.data['state']), ...(url ? { url } : {}) };
    }
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.search = form({
      id: input.externalPostId,
      part: 'status,processingDetails',
    }).toString();
    const result = await request(url, { headers: bearer(input.credentials.accessToken) });
    const video = array(result.data['items'])[0];
    if (!video)
      throw new ProviderError('POST_NOT_FOUND', 'YouTube no longer returns this video.');
    return {
      status:
        string(object(video['processingDetails'])['processingStatus']) ||
        string(object(video['status'])['uploadStatus']),
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(input.externalPostId)}`,
    };
  }

  async getAccountInsights(input: InsightInput): Promise<ProviderInsights> {
    if (this.platform === 'youtube') return this.youtubeInsights(input);
    if (!/^locations\/[A-Za-z0-9_-]+$/.test(input.account.externalId))
      throw new ProviderError(
        'ACCOUNT_METADATA_INVALID',
        'Reconnect this business location.',
      );
    const url = new URL(
      `https://businessprofileperformance.googleapis.com/v1/${input.account.externalId}:fetchMultiDailyMetricsTimeSeries`,
    );
    for (const metric of [
      'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
      'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
      'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
      'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
      'WEBSITE_CLICKS',
      'CALL_CLICKS',
      'BUSINESS_DIRECTION_REQUESTS',
    ])
      url.searchParams.append('dailyMetrics', metric);
    for (const [side, value] of [
      ['start_date', input.since],
      ['end_date', input.until],
    ] as const) {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime()))
        throw new ProviderError(
          'DATE_RANGE_INVALID',
          'Choose a valid analytics date range.',
        );
      url.searchParams.set(`dailyRange.${side}.year`, String(date.getUTCFullYear()));
      url.searchParams.set(`dailyRange.${side}.month`, String(date.getUTCMonth() + 1));
      url.searchParams.set(`dailyRange.${side}.day`, String(date.getUTCDate()));
    }
    const result = await request(url, { headers: bearer(input.credentials.accessToken) });
    const metrics: Record<string, number> = {};
    const series: Array<{ date: string; metric: string; value: number }> = [];
    for (const group of array(result.data['multiDailyMetricTimeSeries']))
      for (const item of array(group['dailyMetricTimeSeries'])) {
        const metric = string(item['dailyMetric']);
        for (const datum of array(object(item['timeSeries'])['datedValues'])) {
          const date = object(datum['date']);
          const value = number(datum['value']);
          metrics[metric] = (metrics[metric] ?? 0) + value;
          series.push({
            date: `${number(date['year'])}-${String(number(date['month'])).padStart(2, '0')}-${String(number(date['day'])).padStart(2, '0')}`,
            metric,
            value,
          });
        }
      }
    return {
      source: this.platform,
      since: input.since,
      until: input.until,
      metrics,
      series,
      note: 'Native Google Business Profile daily metrics; impressions and interactions use Google definitions.',
    };
  }

  async getPostInsights(
    input: InsightInput & { externalPostId: string },
  ): Promise<ProviderInsights> {
    if (this.platform === 'google_business')
      return unsupported(
        'Google removed the local-post insights endpoint. Location performance is available instead.',
      );
    return this.youtubeInsights(input, input.externalPostId);
  }

  private async youtubeInsights(
    input: InsightInput,
    videoId?: string,
  ): Promise<ProviderInsights> {
    const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
    const metricNames = [
      'views',
      'estimatedMinutesWatched',
      'likes',
      'comments',
      'shares',
      'subscribersGained',
      'subscribersLost',
    ];
    url.search = form({
      ids: `channel==${input.account.externalId}`,
      startDate: input.since.slice(0, 10),
      endDate: input.until.slice(0, 10),
      metrics: metricNames.join(','),
      dimensions: 'day',
      sort: 'day',
      ...(videoId ? { filters: `video==${videoId}` } : {}),
    }).toString();
    const result = await request(url, { headers: bearer(input.credentials.accessToken) });
    const headers = array(result.data['columnHeaders']).map((header) =>
      string(header['name']),
    );
    const rows = Array.isArray(result.data['rows']) ? result.data['rows'] : [];
    const metrics: Record<string, number> = {};
    const series: Array<{ date: string; metric: string; value: number }> = [];
    for (const row of rows)
      if (Array.isArray(row))
        for (let i = 0; i < headers.length; i += 1) {
          const metric = headers[i];
          if (!metric || metric === 'day') continue;
          const value = number(row[i]);
          metrics[metric] = (metrics[metric] ?? 0) + value;
          series.push({ date: string(row[0]), metric, value });
        }
    return {
      source: this.platform,
      since: input.since,
      until: input.until,
      metrics,
      series,
      note: 'YouTube Analytics daily reporting; recent dates may be delayed. Empty reports do not imply a zero audience.',
    };
  }

  async revoke(credentials: OAuthCredential): Promise<void> {
    await request('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      body: form({ token: credentials.refreshToken ?? credentials.accessToken }),
    });
  }
}

/** One readable line from a Google PostalAddress, so staff can tell branches apart.
 * Service-area businesses that hide their address return nothing. */
function postalAddress(value: unknown): string {
  const address = object(value);
  const lines = Array.isArray(address['addressLines'])
    ? address['addressLines'].map(string)
    : [];
  return [
    ...lines,
    string(address['locality']),
    string(address['administrativeArea']),
    string(address['postalCode']),
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ')
    .slice(0, 300);
}
