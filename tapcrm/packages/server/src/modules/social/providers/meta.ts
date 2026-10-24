import {
  array,
  assertRedirectUri,
  assertValid,
  bearer,
  form,
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
  type PublishInput,
  type SocialContent,
  type SocialProvider,
} from './types.js';

export class MetaProvider implements SocialProvider {
  readonly supportsPkce = false;
  readonly capabilities: ProviderCapabilities;
  private readonly version: string;
  private readonly scopes: string[];

  constructor(
    readonly platform: 'facebook' | 'instagram',
    private readonly config: ProviderConfig,
  ) {
    this.version = config.apiVersion ?? 'v24.0';
    if (!/^v\d+\.0$/.test(this.version))
      throw new ProviderError(
        'CONFIGURATION_INVALID',
        'Configure a supported Meta Graph API version.',
      );
    this.capabilities = {
      publishText: platform === 'facebook',
      publishImages: true,
      publishVideo: platform === 'instagram',
      accountInsights: true,
      postInsights: true,
    };
    this.scopes =
      platform === 'facebook'
        ? ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']
        : [
            'pages_show_list',
            'pages_read_engagement',
            'instagram_basic',
            'instagram_content_publish',
          ];
  }

  private url(path: string): URL {
    return new URL(`https://graph.facebook.com/${this.version}/${path}`);
  }

  getAuthorizationUrl(input: { state: string; redirectUri: string }): string {
    assertRedirectUri(input.redirectUri);
    const url = new URL(`https://www.facebook.com/${this.version}/dialog/oauth`);
    url.search = form({
      client_id: this.config.clientId,
      redirect_uri: input.redirectUri,
      state: input.state,
      response_type: 'code',
      scope: this.scopes.join(','),
      auth_type: 'rerequest',
    }).toString();
    return url.toString();
  }

  async exchangeCode(input: {
    code: string;
    redirectUri: string;
  }): Promise<OAuthCredential> {
    assertRedirectUri(input.redirectUri);
    const short = await request(this.url('oauth/access_token'), {
      method: 'POST',
      body: form({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: input.redirectUri,
        code: input.code,
      }),
    });
    const shortToken = tokenFromResponse(short.data, []);
    const long = await request(this.url('oauth/access_token'), {
      method: 'POST',
      body: form({
        grant_type: 'fb_exchange_token',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        fb_exchange_token: shortToken.accessToken,
      }),
    });
    const credential = tokenFromResponse(long.data, []);
    const granted = await request(this.url('me/permissions'), {
      headers: bearer(credential.accessToken),
    });
    credential.scopes = array(granted.data['data'])
      .filter((item) => item['status'] === 'granted')
      .map((item) => string(item['permission']));
    if (!this.scopes.every((scope) => credential.scopes.includes(scope)))
      throw new ProviderError(
        'OAUTH_PERMISSIONS_MISSING',
        'Required publishing permissions were not granted. Reconnect and grant the requested permissions.',
      );
    return credential;
  }

  async discoverAccounts(credentials: OAuthCredential): Promise<DiscoveredAccount[]> {
    const accounts: DiscoveredAccount[] = [];
    let cursor = '';
    // Fetch cursors, never the untrusted paging.next URL (which can contain access tokens).
    for (let page = 0; page < 50; page += 1) {
      const url = this.url('me/accounts');
      url.search = form({
        fields:
          'id,name,access_token,tasks,picture,instagram_business_account{id,username,name,profile_picture_url}',
        limit: '100',
        ...(cursor ? { after: cursor } : {}),
      }).toString();
      const result = await request(url, { headers: bearer(credentials.accessToken) });
      for (const item of array(result.data['data'])) {
        const token = string(item['access_token']);
        if (!token) continue;
        const tasks = Array.isArray(item['tasks']) ? item['tasks'] : [];
        if (!tasks.includes('CREATE_CONTENT') && !tasks.includes('MANAGE')) continue;
        const pageId = requiredId(item['id']);
        const accountCredentials: OAuthCredential = {
          ...credentials,
          accessToken: token,
          metadata: { userAccessToken: credentials.accessToken, pageId },
        };
        if (this.platform === 'instagram') {
          const ig = object(item['instagram_business_account']);
          const id = string(ig['id']);
          if (id)
            accounts.push({
              platform: 'instagram',
              externalId: id,
              name: string(ig['name']) || string(ig['username']) || string(item['name']),
              ...(string(ig['profile_picture_url'])
                ? { profileImageUrl: string(ig['profile_picture_url']) }
                : {}),
              credentials: accountCredentials,
              capabilities: this.capabilities,
              metadata: {
                pageId,
                username: string(ig['username']),
                accountType: 'professional',
              },
            });
        } else {
          const photo = string(object(object(item['picture'])['data'])['url']);
          accounts.push({
            platform: 'facebook',
            externalId: pageId,
            name: string(item['name']),
            ...(photo ? { profileImageUrl: photo } : {}),
            credentials: accountCredentials,
            capabilities: this.capabilities,
            metadata: { tasks },
          });
        }
      }
      cursor = string(object(object(result.data['paging'])['cursors'])['after']);
      if (!object(result.data['paging'])['next'] || !cursor) return accounts;
    }
    throw new ProviderError(
      'ACCOUNT_DISCOVERY_LIMIT',
      'Too many accounts were returned. Contact support to connect this portfolio.',
    );
  }

  async refreshCredentials(_credentials: OAuthCredential): Promise<OAuthCredential> {
    throw new ProviderError(
      'RECONNECT_REQUIRED',
      'Meta Page tokens do not support an OAuth refresh-token grant. Reconnect to renew authorization.',
      { reconnectRequired: true },
    );
  }

  validatePost(content: SocialContent, _account?: ProviderAccount): string[] {
    const errors = validateCommon(content, this.platform === 'instagram' ? 2200 : 63_206);
    if (content.media.length > 10)
      errors.push('This integration supports at most 10 images per post.');
    const isStory = content.postType === 'story';
    if (isStory && this.platform !== 'instagram')
      errors.push('Stories are supported for Instagram destinations only.');
    if (this.platform === 'instagram') {
      if (content.media.length === 0)
        errors.push(
          'Instagram requires an image or video; text-only posts are unavailable.',
        );
      if (content.link)
        errors.push(
          'Instagram does not support an attached clickable link. Include it in the caption if desired.',
        );
      const videos = content.media.filter((media) => media.mimeType.startsWith('video/'));
      if (isStory && content.media.length > 1)
        errors.push('Instagram Stories support exactly one image or video.');
      if (!isStory && videos.length && content.media.length !== 1)
        errors.push('Instagram video publishing supports one Reel per post.');
      for (const media of content.media) {
        if (!['image/jpeg', 'video/mp4', 'video/quicktime'].includes(media.mimeType))
          errors.push(
            'Instagram accepts JPEG images or MP4/MOV Reels in this integration.',
          );
        if (
          media.sizeBytes &&
          media.sizeBytes >
            (media.mimeType === 'image/jpeg' ? 8 * 1024 * 1024 : 1024 * 1024 * 1024)
        )
          errors.push('Instagram media exceeds the supported file size.');
      }
    } else {
      if (content.link && content.media.length)
        errors.push('Use an attached link or image gallery for Facebook, not both.');
      if (
        content.media.some(
          (media) => !['image/jpeg', 'image/png'].includes(media.mimeType),
        )
      )
        errors.push(
          'Facebook currently supports JPEG/PNG images here; video publishing is unavailable.',
        );
    }
    return errors;
  }

  async publishPost(input: PublishInput): Promise<PublishedPost> {
    assertValid(this.validatePost(input.content, input.account));
    if (this.platform === 'instagram') return this.publishInstagram(input);
    const fields: Record<string, string> = { message: input.content.caption };
    if (input.content.link) fields['link'] = input.content.link;
    if (input.content.media.length) {
      const attachments: Array<{ media_fbid: string }> = [];
      for (const media of input.content.media) {
        const uploaded = await request(
          this.url(`${encodeURIComponent(input.account.externalId)}/photos`),
          {
            method: 'POST',
            headers: bearer(input.credentials.accessToken),
            body: form({ url: media.url, published: 'false' }),
          },
        );
        attachments.push({ media_fbid: requiredId(uploaded.data['id']) });
      }
      fields['attached_media'] = JSON.stringify(attachments);
    }
    const result = await request(
      this.url(`${encodeURIComponent(input.account.externalId)}/feed`),
      {
        method: 'POST',
        headers: bearer(input.credentials.accessToken),
        body: form(fields),
      },
      true,
    );
    const id = requiredId(result.data['id']);
    return {
      externalPostId: id,
      url: `https://www.facebook.com/${encodeURIComponent(id)}`,
    };
  }

  private async publishInstagram(input: PublishInput): Promise<PublishedPost> {
    const media = input.content.media[0];
    if (!media) return unsupported('Instagram requires media.');
    const headers = bearer(input.credentials.accessToken);
    const endpoint = this.url(`${encodeURIComponent(input.account.externalId)}/media`);
    const isStory = input.content.postType === 'story';
    let containerId: string;
    if (isStory) {
      const video = media.mimeType.startsWith('video/');
      const container = await request(endpoint, {
        method: 'POST',
        headers,
        body: form({
          media_type: 'STORIES',
          ...(video ? { video_url: media.url } : { image_url: media.url }),
        }),
      });
      containerId = requiredId(container.data['id']);
    } else if (input.content.media.length > 1) {
      const children: string[] = [];
      for (const image of input.content.media) {
        const child = await request(endpoint, {
          method: 'POST',
          headers,
          body: form({ image_url: image.url, is_carousel_item: 'true' }),
        });
        children.push(requiredId(child.data['id']));
      }
      const container = await request(endpoint, {
        method: 'POST',
        headers,
        body: form({
          media_type: 'CAROUSEL',
          children: children.join(','),
          caption: input.content.caption,
        }),
      });
      containerId = requiredId(container.data['id']);
    } else {
      const video = media.mimeType.startsWith('video/');
      const container = await request(endpoint, {
        method: 'POST',
        headers,
        body: form({
          ...(video
            ? { media_type: 'REELS', video_url: media.url }
            : { image_url: media.url }),
          caption: input.content.caption,
        }),
      });
      containerId = requiredId(container.data['id']);
    }
    // Poll only an unpublished container. No automatic repeat of media_publish is safe.
    let finished = false;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const url = this.url(encodeURIComponent(containerId));
      url.searchParams.set('fields', 'status_code');
      const state = await request(url, { headers });
      if (state.data['status_code'] === 'FINISHED') {
        finished = true;
        break;
      }
      if (
        state.data['status_code'] === 'ERROR' ||
        state.data['status_code'] === 'EXPIRED'
      )
        throw new ProviderError(
          'MEDIA_PROCESSING_FAILED',
          'Instagram could not process the media. Check its format, duration, and dimensions.',
        );
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (!finished)
      throw new ProviderError(
        'MEDIA_PROCESSING_PENDING',
        'Instagram is still processing the media. Retry later.',
        { transient: true, retryAfter: 120 },
      );
    const published = await request(
      this.url(`${encodeURIComponent(input.account.externalId)}/media_publish`),
      { method: 'POST', headers, body: form({ creation_id: containerId }) },
      true,
    );
    const id = requiredId(published.data['id']);
    let permalink = '';
    try {
      const url = this.url(encodeURIComponent(id));
      url.searchParams.set('fields', 'permalink');
      permalink = string((await request(url, { headers })).data['permalink']);
    } catch {
      /* The publish ID is authoritative even if the optional permalink read fails. */
    }
    return {
      externalPostId: id,
      ...(permalink ? { url: permalink } : {}),
      metadata: { containerId },
    };
  }

  async getPostStatus(input: {
    account: ProviderAccount;
    credentials: OAuthCredential;
    externalPostId: string;
  }): Promise<{ status: string; url?: string }> {
    const url = this.url(encodeURIComponent(input.externalPostId));
    url.searchParams.set(
      'fields',
      this.platform === 'instagram' ? 'id,permalink' : 'id,permalink_url,is_published',
    );
    const result = await request(url, { headers: bearer(input.credentials.accessToken) });
    const link = string(
      result.data[this.platform === 'instagram' ? 'permalink' : 'permalink_url'],
    );
    return {
      status: result.data['is_published'] === false ? 'unpublished' : 'published',
      ...(link ? { url: link } : {}),
    };
  }

  async getAccountInsights(input: InsightInput): Promise<ProviderInsights> {
    const url = this.url(encodeURIComponent(input.account.externalId));
    url.searchParams.set(
      'fields',
      this.platform === 'instagram' ? 'followers_count,media_count' : 'followers_count',
    );
    const result = await request(url, { headers: bearer(input.credentials.accessToken) });
    const metrics: Record<string, number> = {};
    for (const key of this.platform === 'instagram'
      ? ['followers_count', 'media_count']
      : ['followers_count'])
      if (result.data[key] !== undefined) metrics[key] = number(result.data[key]);
    const now = new Date().toISOString();
    return {
      source: this.platform,
      since: now,
      until: now,
      metrics,
      note: 'Current account counters from Meta, not historical totals for the selected date range.',
    };
  }

  async getPostInsights(
    input: InsightInput & { externalPostId: string },
  ): Promise<ProviderInsights> {
    const url = this.url(encodeURIComponent(input.externalPostId));
    url.searchParams.set(
      'fields',
      this.platform === 'instagram'
        ? 'like_count,comments_count'
        : 'reactions.limit(0).summary(true),comments.limit(0).summary(true),shares',
    );
    const result = await request(url, { headers: bearer(input.credentials.accessToken) });
    const metrics: Record<string, number> = {};
    if (this.platform === 'instagram') {
      for (const key of ['like_count', 'comments_count'])
        if (result.data[key] !== undefined) metrics[key] = number(result.data[key]);
    } else {
      for (const key of ['reactions', 'comments']) {
        const total = object(object(result.data[key])['summary'])['total_count'];
        if (total !== undefined) metrics[key] = number(total);
      }
      if (object(result.data['shares'])['count'] !== undefined)
        metrics['shares'] = number(object(result.data['shares'])['count']);
    }
    const now = new Date().toISOString();
    return {
      source: this.platform,
      since: now,
      until: now,
      metrics,
      note: 'Current cumulative post counters from Meta; unavailable counters are omitted.',
    };
  }

  async revoke(credentials: OAuthCredential): Promise<void> {
    const token =
      string(credentials.metadata?.['userAccessToken']) || credentials.accessToken;
    await request(this.url('me/permissions'), {
      method: 'DELETE',
      headers: bearer(token),
    });
  }
}
