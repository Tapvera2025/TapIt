import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleProvider } from './google.js';
import { request } from './http.js';
import { getProvider, getProviderReadiness } from './index.js';
import { LinkedInProvider } from './linkedin.js';
import { MetaProvider } from './meta.js';
import { ProviderError, type OAuthCredential, type PublishInput } from './types.js';

const config = { clientId: 'test-client', clientSecret: 'test-secret' };
const credentials: OAuthCredential = {
  accessToken: 'test-access',
  refreshToken: 'test-refresh',
  scopes: [],
};
function textValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (value instanceof URL || value instanceof URLSearchParams) return value.toString();
  if (value instanceof Request) return value.url;
  throw new Error('Expected a string, URL or form body');
}
function input(platform: PublishInput['account']['platform']): PublishInput {
  return {
    account: {
      platform,
      externalId: platform === 'linkedin' ? 'urn:li:person:abc' : 'account-1',
      name: 'Test account',
    },
    credentials,
    content: { caption: 'A real update', media: [] },
    idempotencyKey: 'destination-1',
  };
}
function response(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers,
  });
}
function mockFetch(...responses: Response[]) {
  const mock = vi.fn<typeof fetch>();
  for (const item of responses) mock.mockResolvedValueOnce(item);
  vi.stubGlobal('fetch', mock);
  return mock;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Social provider readiness and OAuth', () => {
  it('does not enable a provider from credentials alone or expose credentials in readiness', () => {
    vi.stubEnv('SOCIAL_META_CLIENT_ID', config.clientId);
    vi.stubEnv('SOCIAL_META_CLIENT_SECRET', config.clientSecret);
    vi.stubEnv('SOCIAL_META_APPROVED', 'false');
    expect(getProviderReadiness('facebook').status).toBe('pending_approval');
    expect(() => getProvider('facebook')).toThrow(ProviderError);
    expect(JSON.stringify(getProviderReadiness('facebook'))).not.toContain(
      config.clientSecret,
    );
    vi.stubEnv('SOCIAL_META_APPROVED', 'true');
    expect(getProviderReadiness('facebook').status).toBe('ready');
  });

  it('requires Google PKCE and sends state with minimum platform scopes', () => {
    const google = new GoogleProvider('google_business', config);
    expect(() =>
      google.getAuthorizationUrl({
        state: 'csrf-state',
        redirectUri: 'https://crm.example.com/callback',
      }),
    ).toThrow('PKCE');
    const url = new URL(
      google.getAuthorizationUrl({
        state: 'csrf-state',
        redirectUri: 'https://crm.example.com/callback',
        codeChallenge: 'challenge',
      }),
    );
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('state')).toBe('csrf-state');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/business.manage',
    );
    expect(url.toString()).not.toContain(config.clientSecret);
  });

  it('rejects an unsafe redirect URI before making an OAuth request', async () => {
    const fetch = mockFetch();
    await expect(
      new MetaProvider('facebook', config).exchangeCode({
        code: 'code',
        redirectUri: 'http://attacker.example.com/callback',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REDIRECT_URI' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('exchanges Meta code then verifies actually granted permissions', async () => {
    const fetch = mockFetch(
      response({ access_token: 'short' }),
      response({ access_token: 'long', expires_in: 3600 }),
      response({
        data: [
          { permission: 'pages_show_list', status: 'granted' },
          { permission: 'pages_read_engagement', status: 'granted' },
          { permission: 'pages_manage_posts', status: 'declined' },
        ],
      }),
    );
    await expect(
      new MetaProvider('facebook', config).exchangeCode({
        code: 'code',
        redirectUri: 'https://crm.example.com/callback',
      }),
    ).rejects.toMatchObject({ code: 'OAUTH_PERMISSIONS_MISSING' });
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [url] of fetch.mock.calls)
      expect(textValue(url)).not.toContain('test-secret');
  });

  it('discovers only Meta Pages with publishing tasks and uses page-specific credentials', async () => {
    mockFetch(
      response({
        data: [
          {
            id: 'p1',
            name: 'Publisher',
            access_token: 'page-token',
            tasks: ['CREATE_CONTENT'],
          },
          { id: 'p2', name: 'Read only', access_token: 'other', tasks: ['ANALYZE'] },
        ],
      }),
    );
    const accounts = await new MetaProvider('facebook', config).discoverAccounts(
      credentials,
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.credentials.accessToken).toBe('page-token');
    expect(accounts[0]?.credentials.metadata?.['userAccessToken']).toBe(
      credentials.accessToken,
    );
  });

  it('preserves Google refresh tokens when refresh only returns an access token', async () => {
    mockFetch(response({ access_token: 'new', expires_in: 3600 }));
    const result = await new GoogleProvider('youtube', config).refreshCredentials(
      credentials,
    );
    expect(result.refreshToken).toBe('test-refresh');
    expect(result.accessToken).toBe('new');
  });

  it('requires reconnect for LinkedIn accounts without an approved refresh grant', async () => {
    const fetch = mockFetch();
    await expect(
      new LinkedInProvider(config).refreshCredentials({
        accessToken: 'token',
        scopes: [],
      }),
    ).rejects.toMatchObject({ code: 'RECONNECT_REQUIRED', reconnectRequired: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Real publishing payloads and limits', () => {
  it('posts Facebook text using the Page bearer token', async () => {
    const fetch = mockFetch(response({ id: 'page_post' }));
    const result = await new MetaProvider('facebook', config).publishPost(
      input('facebook'),
    );
    expect(result.externalPostId).toBe('page_post');
    const [url, options] = fetch.mock.calls[0] ?? [];
    expect(textValue(url)).toBe('https://graph.facebook.com/v24.0/account-1/feed');
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer test-access' });
    expect(textValue(options?.body)).toContain('message=A+real+update');
  });

  it('uploads unpublished Facebook images before a single feed publish', async () => {
    const fetch = mockFetch(
      response({ id: 'image1' }),
      response({ id: 'image2' }),
      response({ id: 'page_post' }),
    );
    const publish = input('facebook');
    publish.content.media = [
      { url: 'https://cdn.example.com/1.jpg', mimeType: 'image/jpeg' },
      { url: 'https://cdn.example.com/2.png', mimeType: 'image/png' },
    ];
    await new MetaProvider('facebook', config).publishPost(publish);
    expect(textValue(fetch.mock.calls[0]?.[1]?.body)).toContain('published=false');
    const body = new URLSearchParams(textValue(fetch.mock.calls[2]?.[1]?.body));
    expect(JSON.parse(body.get('attached_media') ?? '[]')).toEqual([
      { media_fbid: 'image1' },
      { media_fbid: 'image2' },
    ]);
  });

  it('publishes an Instagram container only after successful processing', async () => {
    const fetch = mockFetch(
      response({ id: 'container' }),
      response({ status_code: 'FINISHED' }),
      response({ id: 'ig-post' }),
      response({ permalink: 'https://www.instagram.com/p/example/' }),
    );
    const publish = input('instagram');
    publish.content.media = [
      { url: 'https://cdn.example.com/1.jpg', mimeType: 'image/jpeg' },
    ];
    const result = await new MetaProvider('instagram', config).publishPost(publish);
    expect(result).toMatchObject({
      externalPostId: 'ig-post',
      url: 'https://www.instagram.com/p/example/',
    });
    expect(textValue(fetch.mock.calls[2]?.[1]?.body)).toBe('creation_id=container');
  });

  it('retains successful Instagram publish IDs if optional permalink fetching fails', async () => {
    const fetch = mockFetch(
      response({ id: 'container' }),
      response({ status_code: 'FINISHED' }),
      response({ id: 'ig-post' }),
    );
    fetch.mockRejectedValueOnce(new Error('network failure'));
    const publish = input('instagram');
    publish.content.media = [
      { url: 'https://cdn.example.com/1.jpg', mimeType: 'image/jpeg' },
    ];
    await expect(
      new MetaProvider('instagram', config).publishPost(publish),
    ).resolves.toMatchObject({ externalPostId: 'ig-post' });
  });

  it('publishes an Instagram Story through a STORIES media container', async () => {
    const fetch = mockFetch(
      response({ id: 'story-container' }),
      response({ status_code: 'FINISHED' }),
      response({ id: 'ig-story-post' }),
      response({ permalink: 'https://www.instagram.com/stories/example/' }),
    );
    const publish = input('instagram');
    publish.content.postType = 'story';
    publish.content.media = [
      { url: 'https://cdn.example.com/story.jpg', mimeType: 'image/jpeg' },
    ];
    const result = await new MetaProvider('instagram', config).publishPost(publish);
    expect(result).toMatchObject({ externalPostId: 'ig-story-post' });
    const containerBody = textValue(fetch.mock.calls[0]?.[1]?.body);
    expect(containerBody).toContain('media_type=STORIES');
    expect(containerBody).toContain(
      `image_url=${encodeURIComponent('https://cdn.example.com/story.jpg')}`,
    );
    // Stories don't use a feed caption; the container body must not try to set one.
    expect(containerBody).not.toContain('caption=');
  });

  it('rejects an Instagram Story that bundles multiple media items', async () => {
    const fetch = mockFetch();
    const publish = input('instagram');
    publish.content.postType = 'story';
    publish.content.media = [
      { url: 'https://cdn.example.com/1.jpg', mimeType: 'image/jpeg' },
      { url: 'https://cdn.example.com/2.jpg', mimeType: 'image/jpeg' },
    ];
    await expect(
      new MetaProvider('instagram', config).publishPost(publish),
    ).rejects.toMatchObject({ code: 'POST_INVALID' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a Story on a Facebook destination', () => {
    expect(
      new MetaProvider('facebook', config).validatePost({
        caption: 'ok',
        media: [{ url: 'https://cdn.example.com/1.jpg', mimeType: 'image/jpeg' }],
        postType: 'story',
      }),
    ).toContain('Stories are supported for Instagram destinations only.');
  });

  it('blocks unsupported content before any remote publishing request', async () => {
    const fetch = mockFetch();
    const ig = input('instagram');
    await expect(
      new MetaProvider('instagram', config).publishPost(ig),
    ).rejects.toMatchObject({ code: 'POST_INVALID' });
    const linked = input('linkedin');
    linked.content.media = [
      { url: 'https://cdn.example.com/video.mp4', mimeType: 'video/mp4' },
    ];
    await expect(new LinkedInProvider(config).publishPost(linked)).rejects.toMatchObject({
      code: 'POST_INVALID',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('creates LinkedIn posts with the versioned API and returned restli ID', async () => {
    const fetch = mockFetch(
      response(undefined, 201, { 'x-restli-id': 'urn:li:share:123' }),
    );
    const result = await new LinkedInProvider(config).publishPost(input('linkedin'));
    expect(result.externalPostId).toBe('urn:li:share:123');
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      'Linkedin-Version': '202609',
      'X-Restli-Protocol-Version': '2.0.0',
    });
    expect(JSON.parse(textValue(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      author: 'urn:li:person:abc',
      lifecycleState: 'PUBLISHED',
    });
  });

  it('never uploads bytes or credentials to an unexpected provider-returned upload host', async () => {
    const fetch = mockFetch(
      response({
        value: {
          image: 'urn:li:image:123',
          uploadUrl: 'https://attacker.example.com/upload',
        },
      }),
    );
    const publish = input('linkedin');
    publish.content.media = [
      {
        url: 'https://cdn.example.com/1.jpg',
        mimeType: 'image/jpeg',
        bytes: new Uint8Array([1, 2, 3]),
      },
    ];
    await expect(new LinkedInProvider(config).publishPost(publish)).rejects.toMatchObject(
      { code: 'UPLOAD_URL_INVALID' },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uploads YouTube video with an explicit private default and persists the actual returned ID', async () => {
    const fetch = mockFetch(
      response(undefined, 200, {
        location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=test',
      }),
      response({
        id: 'video1',
        status: { uploadStatus: 'uploaded', privacyStatus: 'private' },
      }),
    );
    const publish = input('youtube');
    publish.content.title = 'Our new service';
    publish.content.media = [
      {
        url: 'https://cdn.example.com/video.mp4',
        mimeType: 'video/mp4',
        bytes: new Uint8Array([1, 2, 3]),
      },
    ];
    const result = await new GoogleProvider('youtube', config).publishPost(publish);
    expect(result.externalPostId).toBe('video1');
    expect(JSON.parse(textValue(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
    });
    expect(fetch.mock.calls[1]?.[1]?.method).toBe('PUT');
  });

  it('uses the discovered GBP account/location parent for standard posts', async () => {
    const fetch = mockFetch(
      response({ name: 'accounts/1/locations/2/localPosts/3', state: 'LIVE' }),
    );
    const publish = input('google_business');
    publish.account.externalId = 'locations/2';
    publish.account.metadata = { accountName: 'accounts/1' };
    await new GoogleProvider('google_business', config).publishPost(publish);
    expect(textValue(fetch.mock.calls[0]?.[0])).toBe(
      'https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts',
    );
    expect(JSON.parse(textValue(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      topicType: 'STANDARD',
      summary: 'A real update',
    });
  });
});

describe('Safe failures and genuine analytics', () => {
  it('treats interrupted publishing as outcome unknown and disallows blind retries', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValue(new Error('token test-access secret should never escape')),
    );
    const error = await new MetaProvider('facebook', config)
      .publishPost(input('facebook'))
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ ambiguous: true, transient: false });
    expect(textValue(error)).not.toContain('test-access');
  });

  it('allows bounded retries for an explicit rate-limit rejection', async () => {
    mockFetch(
      response({ error: { message: 'token test-access' } }, 429, {
        'retry-after': '120',
      }),
    );
    await expect(
      new MetaProvider('facebook', config).publishPost(input('facebook')),
    ).rejects.toMatchObject({
      code: 'PLATFORM_RATE_LIMITED',
      transient: true,
      ambiguous: false,
      retryAfter: 120,
    });
  });

  it('does not retry server errors after a publish request but can retry read errors', async () => {
    mockFetch(response({}, 503), response({}, 503));
    await expect(
      request('https://graph.facebook.com/v24.0/page/feed', { method: 'POST' }, true),
    ).rejects.toMatchObject({ ambiguous: true, transient: false });
    await expect(request('https://graph.facebook.com/v24.0/page')).rejects.toMatchObject({
      ambiguous: false,
      transient: true,
    });
  });

  it('classifies revoked authorization without leaking platform response details', async () => {
    mockFetch(
      response({ error: { code: 190, message: 'secret token in platform body' } }, 400),
    );
    const error = await request('https://graph.facebook.com/v24.0/page').catch(
      (value: unknown) => value,
    );
    expect(error).toMatchObject({ reconnectRequired: true, code: 'CONNECTION_REVOKED' });
    expect(textValue(error)).not.toContain('secret token');
  });

  it('exposes unsupported GBP post analytics and LinkedIn member analytics explicitly', async () => {
    const fetch = mockFetch();
    const params = {
      account: input('google_business').account,
      credentials,
      since: '2026-10-01',
      until: '2026-10-10',
      externalPostId: 'post',
    };
    await expect(
      new GoogleProvider('google_business', config).getPostInsights(params),
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
    await expect(
      new LinkedInProvider(config).getAccountInsights({
        ...params,
        account: input('linkedin').account,
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps Google native metric names and returns no invented follower counts', async () => {
    mockFetch(
      response({
        multiDailyMetricTimeSeries: [
          {
            dailyMetricTimeSeries: [
              {
                dailyMetric: 'WEBSITE_CLICKS',
                timeSeries: {
                  datedValues: [{ date: { year: 2026, month: 10, day: 1 }, value: '7' }],
                },
              },
            ],
          },
        ],
      }),
    );
    const account = { ...input('google_business').account, externalId: 'locations/2' };
    const result = await new GoogleProvider('google_business', config).getAccountInsights(
      { account, credentials, since: '2026-10-01', until: '2026-10-10' },
    );
    expect(result.metrics).toEqual({ WEBSITE_CLICKS: 7 });
    expect(result.series).toEqual([
      { date: '2026-10-01', metric: 'WEBSITE_CLICKS', value: 7 },
    ]);
  });

  it('leaves unavailable YouTube metrics absent for an empty API report', async () => {
    mockFetch(response({ columnHeaders: [{ name: 'day' }, { name: 'views' }] }));
    const result = await new GoogleProvider('youtube', config).getAccountInsights({
      account: input('youtube').account,
      credentials,
      since: '2026-10-01',
      until: '2026-10-10',
    });
    expect(result.metrics).toEqual({});
  });

  it('does not invent an unsupported LinkedIn revocation endpoint', async () => {
    const fetch = mockFetch();
    await expect(new LinkedInProvider(config).revoke(credentials)).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
