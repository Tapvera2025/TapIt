import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleProvider, SEARCH_CONSOLE_SCOPE } from './google.js';
import { getCompanyProvider } from './index.js';
import { LinkedInProvider } from './linkedin.js';
import { MetaProvider } from './meta.js';
import type { OAuthCredential, PublishInput } from './types.js';

const config = {
  clientId: 'test-client',
  clientSecret: 'test-secret',
  apiVersion: 'v24.0',
};
const redirectUri = 'https://crm.example.com/api/social/oauth/facebook/callback';
const userToken: OAuthCredential = {
  accessToken: 'user-token',
  scopes: [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'instagram_basic',
    'instagram_content_publish',
  ],
  metadata: { tokenType: 'user' },
};
function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}
function mockFetch(...responses: Response[]) {
  const mock = vi.fn<typeof fetch>();
  for (const item of responses) mock.mockResolvedValueOnce(item);
  vi.stubGlobal('fetch', mock);
  return mock;
}
function calledUrl(value: unknown): URL {
  if (value instanceof URL) return value;
  if (typeof value === 'string') return new URL(value);
  throw new Error('Expected a URL');
}
function authorization(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.['Authorization'];
}
function publishTo(
  account: PublishInput['account'],
  credentials: OAuthCredential,
): PublishInput {
  return {
    account,
    credentials,
    content: { caption: 'Smile week', media: [] },
    idempotencyKey: 'destination-1',
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('One Facebook login for Pages and their Instagram accounts', () => {
  it('asks for Page and Instagram permissions but requires only the Page ones', async () => {
    const meta = new MetaProvider('facebook', config, { companyWide: true });
    const scope = new URL(
      meta.getAuthorizationUrl({ state: 's', redirectUri }),
    ).searchParams
      .get('scope')!
      .split(',');
    expect(scope).toEqual(
      expect.arrayContaining(['pages_manage_posts', 'instagram_content_publish']),
    );
    mockFetch(
      response({ access_token: 'short' }),
      response({ access_token: 'long', expires_in: 5_184_000 }),
      response({
        data: [
          { permission: 'pages_show_list', status: 'granted' },
          { permission: 'pages_read_engagement', status: 'granted' },
          { permission: 'pages_manage_posts', status: 'granted' },
          { permission: 'instagram_content_publish', status: 'declined' },
        ],
      }),
    );
    const credential = await meta.exchangeCode({ code: 'code', redirectUri });
    expect(credential.metadata).toEqual({ tokenType: 'user' });
    expect(credential.scopes).not.toContain('instagram_content_publish');
  });

  it('lists each Page and its linked Instagram account with their websites, never a token', async () => {
    const fetch = mockFetch(
      response({
        data: [
          {
            id: '101',
            name: 'Acme Dental',
            access_token: 'page-token-101',
            tasks: ['CREATE_CONTENT', 'MANAGE'],
            website: 'www.acmedental.in https://other.example',
            instagram_business_account: {
              id: '17841',
              username: 'acmedental',
              name: 'Acme Dental',
              website: 'https://acmedental.in/book',
            },
          },
          {
            id: '102',
            name: 'Read only',
            access_token: 'page-token-102',
            tasks: ['ANALYZE'],
          },
        ],
      }),
    );
    const accounts = await new MetaProvider('facebook', config, {
      companyWide: true,
    }).discoverAccounts(userToken);
    expect(calledUrl(fetch.mock.calls[0]![0]).searchParams.get('fields')).toContain(
      'website',
    );
    expect(accounts.map((item) => [item.platform, item.externalId])).toEqual([
      ['facebook', '101'],
      ['instagram', '17841'],
    ]);
    expect(accounts[0]!.metadata).toEqual({
      tasks: ['CREATE_CONTENT', 'MANAGE'],
      websiteUri: 'https://www.acmedental.in/',
    });
    expect(accounts[1]!.metadata).toEqual({
      pageId: '101',
      username: 'acmedental',
      accountType: 'professional',
      websiteUri: 'https://acmedental.in/book',
    });
    expect(accounts[1]!.capabilities).toMatchObject({
      publishText: false,
      publishVideo: true,
    });
    expect(JSON.stringify(accounts.map((item) => item.metadata))).not.toContain('token');
  });

  it('leaves out Instagram accounts when the login declined Instagram access', async () => {
    mockFetch(
      response({
        data: [
          {
            id: '101',
            name: 'Acme Dental',
            access_token: 'page-token-101',
            tasks: ['CREATE_CONTENT'],
            instagram_business_account: { id: '17841', username: 'acmedental' },
          },
        ],
      }),
    );
    const accounts = await new MetaProvider('facebook', config, {
      companyWide: true,
    }).discoverAccounts({
      ...userToken,
      scopes: ['pages_show_list', 'pages_manage_posts'],
    });
    expect(accounts.map((item) => item.platform)).toEqual(['facebook']);
  });

  it('publishes to a Page with the Page token looked up from the company login', async () => {
    const fetch = mockFetch(
      response({ id: '101', access_token: 'page-token-101' }),
      response({ id: '101_9' }),
    );
    const result = await new MetaProvider('facebook', config).publishPost(
      publishTo(
        { platform: 'facebook', externalId: '101', name: 'Acme Dental' },
        userToken,
      ),
    );
    expect(result.externalPostId).toBe('101_9');
    const [lookupUrl, lookupInit] = fetch.mock.calls[0]!;
    expect(calledUrl(lookupUrl).pathname).toBe('/v24.0/101');
    expect(calledUrl(lookupUrl).searchParams.get('fields')).toBe('access_token');
    expect(authorization(lookupInit)).toBe('Bearer user-token');
    expect(calledUrl(fetch.mock.calls[1]![0]).pathname).toBe('/v24.0/101/feed');
    expect(authorization(fetch.mock.calls[1]![1])).toBe('Bearer page-token-101');
  });

  it('reads an Instagram account through the Page it is linked to', async () => {
    const fetch = mockFetch(
      response({ id: '101', access_token: 'page-token-101' }),
      response({ followers_count: 1200, media_count: 40 }),
    );
    const insights = await new MetaProvider('instagram', config).getAccountInsights({
      account: {
        platform: 'instagram',
        externalId: '17841',
        name: 'Acme Dental',
        metadata: { pageId: '101' },
      },
      credentials: userToken,
      since: '2026-11-01',
      until: '2026-11-10',
    });
    expect(insights.metrics).toEqual({ followers_count: 1200, media_count: 40 });
    expect(authorization(fetch.mock.calls[1]![1])).toBe('Bearer page-token-101');
  });

  it('keeps using the Page token a client connection stored', async () => {
    const fetch = mockFetch(response({ id: '101_9' }));
    await new MetaProvider('facebook', config).publishPost(
      publishTo(
        { platform: 'facebook', externalId: '101', name: 'Acme Dental' },
        {
          accessToken: 'page-token-101',
          scopes: [],
          metadata: { userAccessToken: 'user-token', pageId: '101' },
        },
      ),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(authorization(fetch.mock.calls[0]![1])).toBe('Bearer page-token-101');
  });

  it('refuses a Page the company login can no longer manage, before publishing anything', async () => {
    const fetch = mockFetch(response({ id: '101' }));
    await expect(
      new MetaProvider('facebook', config).publishPost(
        publishTo(
          { platform: 'facebook', externalId: '101', name: 'Acme Dental' },
          userToken,
        ),
      ),
    ).rejects.toMatchObject({ code: 'PAGE_ACCESS_MISSING', ambiguous: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('identifies the Facebook user who signed in', async () => {
    mockFetch(response({ id: '5550001', name: 'Riya at Agency A' }));
    await expect(
      new MetaProvider('facebook', config).getAuthorizedIdentity(userToken),
    ).resolves.toEqual({ externalAccountId: '5550001', name: 'Riya at Agency A' });
    mockFetch(response({ name: 'No id' }));
    await expect(
      new MetaProvider('facebook', config).getAuthorizedIdentity(userToken),
    ).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_INVALID' });
  });
});

describe('One Google login for Business Profiles and Search Console', () => {
  const google = () =>
    new GoogleProvider('google_business', config, { searchConsole: true });
  const googleRedirect =
    'https://crm.example.com/api/social/oauth/google_business/callback';

  it('asks to read Search Console but connects the profiles without it', async () => {
    const scope = new URL(
      google().getAuthorizationUrl({
        state: 's',
        redirectUri: googleRedirect,
        codeChallenge: 'c',
      }),
    ).searchParams.get('scope');
    expect(scope).toContain(SEARCH_CONSOLE_SCOPE);
    mockFetch(
      response({
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: 3600,
        scope:
          'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/business.manage',
      }),
    );
    const credentials = await google().exchangeCode({
      code: 'code',
      redirectUri: googleRedirect,
      codeVerifier: 'verifier',
    });
    const fetch = mockFetch();
    await expect(google().listSearchConsoleProperties(credentials)).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lists verified Search Console properties only, once each', async () => {
    mockFetch(
      response({
        siteEntry: [
          { siteUrl: 'sc-domain:acmedental.in', permissionLevel: 'siteOwner' },
          { siteUrl: 'https://www.zenyoga.example/', permissionLevel: 'siteFullUser' },
          { siteUrl: 'https://other.example/', permissionLevel: 'siteUnverifiedUser' },
          { siteUrl: 'javascript:alert(1)', permissionLevel: 'siteOwner' },
          { siteUrl: 'sc-domain:acmedental.in', permissionLevel: 'siteOwner' },
        ],
      }),
    );
    await expect(
      google().listSearchConsoleProperties({
        accessToken: 'access',
        scopes: [SEARCH_CONSOLE_SCOPE],
      }),
    ).resolves.toEqual([
      { siteUrl: 'sc-domain:acmedental.in', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://www.zenyoga.example/', permissionLevel: 'siteFullUser' },
    ]);
  });

  it('identifies a YouTube sign-in by the channel chosen on Google’s screen', async () => {
    mockFetch(
      response({
        items: [{ id: 'UC123abcDEF456ghi789jklm', snippet: { title: 'Acme Dental TV' } }],
      }),
    );
    await expect(
      new GoogleProvider('youtube', config).getAuthorizedIdentity({
        accessToken: 'a',
        scopes: [],
      }),
    ).resolves.toEqual({
      externalAccountId: 'UC123abcDEF456ghi789jklm',
      name: 'Acme Dental TV',
    });
    mockFetch(response({ items: [] }));
    await expect(
      new GoogleProvider('youtube', config).getAuthorizedIdentity({
        accessToken: 'a',
        scopes: [],
      }),
    ).rejects.toMatchObject({ code: 'YOUTUBE_CHANNEL_MISSING' });
  });
});

describe('LinkedIn company login', () => {
  it('identifies the member and keeps each company page’s website', async () => {
    const linkedin = { ...config, apiVersion: '202609' };
    mockFetch(response({ sub: 'member123', name: 'Riya Sharma' }));
    await expect(
      new LinkedInProvider(linkedin).getAuthorizedIdentity({
        accessToken: 'a',
        scopes: [],
      }),
    ).resolves.toEqual({ externalAccountId: 'member123', name: 'Riya Sharma' });
    mockFetch(
      response({ sub: 'member123', name: 'Riya Sharma' }),
      response({
        elements: [{ role: 'ADMINISTRATOR', organization: 'urn:li:organization:42' }],
      }),
      response({ localizedName: 'Acme Dental', localizedWebsite: 'acmedental.in' }),
    );
    const accounts = await new LinkedInProvider({
      ...linkedin,
      organizationEnabled: true,
    }).discoverAccounts({ accessToken: 'a', scopes: [] });
    expect(accounts[1]).toMatchObject({
      externalId: 'urn:li:organization:42',
      metadata: {
        accountType: 'organization',
        role: 'ADMINISTRATOR',
        websiteUri: 'https://acmedental.in/',
      },
    });
  });
});

describe('Company providers', () => {
  it('are built only for configured, approved platforms', () => {
    vi.stubEnv('SOCIAL_META_CLIENT_ID', 'meta-id');
    vi.stubEnv('SOCIAL_META_CLIENT_SECRET', 'meta-secret');
    vi.stubEnv('SOCIAL_META_APPROVED', 'true');
    const scope = new URL(
      getCompanyProvider('facebook').getAuthorizationUrl({ state: 's', redirectUri }),
    ).searchParams.get('scope');
    expect(scope).toContain('instagram_content_publish');
    vi.stubEnv('SOCIAL_LINKEDIN_CLIENT_ID', '');
    let failure: unknown;
    try {
      getCompanyProvider('linkedin');
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'SETUP_REQUIRED' });
  });
});
