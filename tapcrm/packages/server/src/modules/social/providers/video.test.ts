import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleProvider } from './google.js';
import { LinkedInProvider } from './linkedin.js';
import { MetaProvider } from './meta.js';
import type { OAuthCredential, PublishInput, SocialMedia } from './types.js';

const meta = {
  clientId: 'test-client',
  clientSecret: 'test-secret',
  apiVersion: 'v24.0',
};
const linkedin = {
  clientId: 'test-client',
  clientSecret: 'test-secret',
  apiVersion: '202609',
};
const pageToken: OAuthCredential = {
  accessToken: 'page-token',
  scopes: [],
  metadata: { userAccessToken: 'user-token', pageId: '101' },
};
const video: SocialMedia = {
  url: 'https://files.example.com/clip.mp4',
  mimeType: 'video/mp4',
  bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
};
const image: SocialMedia = {
  url: 'https://files.example.com/photo.jpg',
  mimeType: 'image/jpeg',
};
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
function url(value: unknown): string {
  if (value instanceof URL) return value.href;
  if (typeof value === 'string') return value;
  throw new Error('Expected a URL');
}
function headers(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}
function jsonOf(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON body');
  return JSON.parse(init.body);
}
function formOf(init: RequestInit | undefined): URLSearchParams {
  if (!(init?.body instanceof URLSearchParams)) throw new Error('Expected a form body');
  return init.body;
}
function publish(
  platform: PublishInput['account']['platform'],
  media: SocialMedia[],
  extra: Partial<PublishInput['content']> = {},
  account: Partial<PublishInput['account']> = {},
  credentials: OAuthCredential = pageToken,
): PublishInput {
  return {
    account: {
      platform,
      externalId: platform === 'linkedin' ? 'urn:li:organization:42' : '101',
      name: 'Acme Dental',
      ...account,
    },
    credentials,
    content: { caption: 'Smile week', media, ...extra },
    idempotencyKey: 'destination-1',
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Facebook video and Reels', () => {
  it('uploads a feed video from CRM storage in one request', async () => {
    const fetch = mockFetch(response({ id: '9001' }));
    const result = await new MetaProvider('facebook', meta).publishPost(
      publish('facebook', [video], { title: 'Smile week' }),
    );
    expect(result).toEqual({
      externalPostId: '9001',
      url: 'https://www.facebook.com/101/videos/9001/',
    });
    const [target, init] = fetch.mock.calls[0]!;
    expect(url(target)).toBe('https://graph-video.facebook.com/v24.0/101/videos');
    expect(headers(init)['Authorization']).toBe('Bearer page-token');
    const body = init?.body as FormData;
    expect(body.get('description')).toBe('Smile week');
    expect(body.get('title')).toBe('Smile week');
    expect((body.get('source') as Blob).size).toBe(10);
  });

  it('publishes a Reel through the Reels API: start, upload, finish', async () => {
    const fetch = mockFetch(
      response({
        video_id: '777',
        upload_url: 'https://rupload.facebook.com/video-upload/v24.0/777',
      }),
      response({ success: true }),
      response({ success: true }),
      response({
        status: { video_status: 'ready', publishing_phase: { status: 'complete' } },
      }),
    );
    const result = await new MetaProvider('facebook', meta).publishPost(
      publish('facebook', [video], { postType: 'reel' }),
    );
    expect(result).toEqual({
      externalPostId: '777',
      url: 'https://www.facebook.com/reel/777',
      metadata: { platformState: 'published' },
    });
    const [start, upload, finish] = fetch.mock.calls;
    expect(url(start![0])).toBe('https://graph.facebook.com/v24.0/101/video_reels');
    expect(formOf(start![1]).get('upload_phase')).toBe('start');
    expect(url(upload![0])).toBe('https://rupload.facebook.com/video-upload/v24.0/777');
    expect(headers(upload![1])).toMatchObject({
      Authorization: 'OAuth page-token',
      offset: '0',
      file_size: '10',
    });
    expect(Buffer.from(upload![1]!.body as Uint8Array)).toEqual(
      Buffer.from(video.bytes!),
    );
    expect(Object.fromEntries(formOf(finish![1]))).toEqual({
      upload_phase: 'finish',
      video_id: '777',
      video_state: 'PUBLISHED',
      description: 'Smile week',
    });
  });

  it('never sends a Reel to an upload host that is not Meta’s', async () => {
    const fetch = mockFetch(
      response({ video_id: '777', upload_url: 'https://attacker.example.com/upload' }),
    );
    await expect(
      new MetaProvider('facebook', meta).publishPost(
        publish('facebook', [video], { postType: 'reel' }),
      ),
    ).rejects.toMatchObject({ code: 'UPLOAD_URL_INVALID' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a Reel Meta could not process as failed, and an unconfirmed finish as unknown', async () => {
    mockFetch(
      response({ video_id: '777' }),
      response({ success: true }),
      response({ success: true }),
      response({ status: { video_status: 'error' } }),
    );
    await expect(
      new MetaProvider('facebook', meta).publishPost(
        publish('facebook', [video], { postType: 'reel' }),
      ),
    ).rejects.toMatchObject({ code: 'MEDIA_PROCESSING_FAILED', ambiguous: false });
    mockFetch(response({ video_id: '778' }), response({ success: true }), response({}));
    await expect(
      new MetaProvider('facebook', meta).publishPost(
        publish('facebook', [video], { postType: 'reel' }),
      ),
    ).rejects.toMatchObject({ code: 'PUBLISH_OUTCOME_UNKNOWN', ambiguous: true });
  });

  it('checks video placements before any request', () => {
    const facebook = new MetaProvider('facebook', meta);
    expect(
      facebook.validatePost({ caption: 'x', media: [image], postType: 'reel' }),
    ).toContain('A Reel is exactly one video.');
    expect(facebook.validatePost({ caption: 'x', media: [video, image] })).toContain(
      'A Facebook video is posted on its own, without images.',
    );
    expect(facebook.validatePost({ caption: 'x', media: [video] })).toEqual([]);
    expect(
      new MetaProvider('instagram', meta).validatePost({
        caption: 'x',
        media: [video],
        postType: 'reel',
      }),
    ).toEqual([]);
  });

  it('publishes an Instagram Reel as a REELS container', async () => {
    const fetch = mockFetch(
      response({ id: 'container-1' }),
      response({ status_code: 'FINISHED' }),
      response({ id: 'ig-media-1' }),
      response({ permalink: 'https://www.instagram.com/reel/x' }),
    );
    const result = await new MetaProvider('instagram', meta).publishPost(
      publish(
        'instagram',
        [video],
        { postType: 'reel' },
        { externalId: '17841', metadata: { pageId: '101' } },
      ),
    );
    expect(result.externalPostId).toBe('ig-media-1');
    expect(formOf(fetch.mock.calls[0]![1]).get('media_type')).toBe('REELS');
  });
});

describe('LinkedIn video', () => {
  const uploadInstructions = [
    {
      uploadUrl: 'https://www.linkedin.com/dms-uploads/part-1',
      firstByte: 0,
      lastByte: 3,
    },
    {
      uploadUrl: 'https://www.linkedin.com/dms-uploads/part-2',
      firstByte: 4,
      lastByte: 9,
    },
  ];

  it('uploads every part, finalizes, waits for AVAILABLE, then posts the video', async () => {
    const fetch = mockFetch(
      response({
        value: {
          video: 'urn:li:video:C1',
          uploadToken: 'upload-token',
          uploadInstructions,
        },
      }),
      response(undefined, 200, { etag: 'etag-1' }),
      response(undefined, 200, { etag: 'etag-2' }),
      response(undefined, 200),
      response({ status: 'AVAILABLE' }),
      response(undefined, 201, { 'x-restli-id': 'urn:li:share:555' }),
    );
    const result = await new LinkedInProvider({
      ...linkedin,
      organizationEnabled: true,
    }).publishPost(publish('linkedin', [video]));
    expect(result.externalPostId).toBe('urn:li:share:555');
    const calls = fetch.mock.calls;
    expect(jsonOf(calls[0]![1])).toEqual({
      initializeUploadRequest: {
        owner: 'urn:li:organization:42',
        fileSizeBytes: 10,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    });
    expect([...(calls[1]![1]!.body as Uint8Array)]).toEqual([1, 2, 3, 4]);
    expect([...(calls[2]![1]!.body as Uint8Array)]).toEqual([5, 6, 7, 8, 9, 10]);
    // Pre-signed upload URLs never receive the API token.
    expect(headers(calls[1]![1])['Authorization']).toBeUndefined();
    expect(jsonOf(calls[3]![1])).toEqual({
      finalizeUploadRequest: {
        video: 'urn:li:video:C1',
        uploadToken: 'upload-token',
        uploadedPartIds: ['etag-1', 'etag-2'],
      },
    });
    expect(url(calls[4]![0])).toBe(
      'https://api.linkedin.com/rest/videos/urn%3Ali%3Avideo%3AC1',
    );
    expect(jsonOf(calls[5]![1])).toMatchObject({
      author: 'urn:li:organization:42',
      content: { media: { id: 'urn:li:video:C1' } },
    });
  });

  it('creates no post when LinkedIn cannot process the video', async () => {
    const fetch = mockFetch(
      response({
        value: {
          video: 'urn:li:video:C1',
          uploadToken: '',
          uploadInstructions: [uploadInstructions[0]!],
        },
      }),
      response(undefined, 200, { etag: 'etag-1' }),
      response(undefined, 200),
      response({ status: 'PROCESSING_FAILED' }),
    );
    await expect(
      new LinkedInProvider({ ...linkedin, organizationEnabled: true }).publishPost(
        publish('linkedin', [{ ...video, bytes: video.bytes!.subarray(0, 4) }]),
      ),
    ).rejects.toMatchObject({ code: 'MEDIA_PROCESSING_FAILED', ambiguous: false });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('refuses an upload range outside the file before sending anything', async () => {
    const fetch = mockFetch(
      response({
        value: {
          video: 'urn:li:video:C1',
          uploadInstructions: [
            {
              uploadUrl: 'https://www.linkedin.com/dms-uploads/x',
              firstByte: 0,
              lastByte: 99,
            },
          ],
        },
      }),
    );
    await expect(
      new LinkedInProvider({ ...linkedin, organizationEnabled: true }).publishPost(
        publish('linkedin', [video]),
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_INVALID' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('YouTube visibility', () => {
  it('uploads with the visibility chosen in the composer', async () => {
    const fetch = mockFetch(
      response(undefined, 200, {
        location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=1',
      }),
      response({
        id: 'yt-1',
        status: { uploadStatus: 'uploaded', privacyStatus: 'public' },
      }),
    );
    const result = await new GoogleProvider('youtube', meta).publishPost(
      publish(
        'youtube',
        [video],
        { title: 'Smile week', privacyStatus: 'public' },
        { externalId: 'UC1' },
      ),
    );
    expect(result.metadata).toMatchObject({ privacyStatus: 'public' });
    expect(jsonOf(fetch.mock.calls[0]![1])).toMatchObject({
      status: { privacyStatus: 'public' },
    });
  });
});
