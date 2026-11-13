import { describe, expect, it } from 'vitest';
import type { SocialAccount, SocialMedia, SocialPostInput } from './types.js';
import { validateSocialPost } from './validation.js';

const account = (id: string, platform: SocialAccount['platform']): SocialAccount => ({
  id,
  clientId: 'client-1',
  platform,
  externalId: id,
  name: id,
  profileImageUrl: null,
  status: 'connected',
  connectionScope: 'company',
  connectionOrigin: 'agency',
  capabilities: [],
  scopes: [],
  connectedAt: '2026-11-01T00:00:00Z',
  lastSyncedAt: null,
  lastError: null,
});
const media = (id: string, mimeType: string): SocialMedia => ({
  id,
  clientId: 'client-1',
  name: id,
  mimeType,
  sizeBytes: 1000,
  width: null,
  height: null,
  durationSeconds: null,
  url: `https://files.example.com/${id}`,
  createdAt: '2026-11-01T00:00:00Z',
});
const accounts = [
  account('fb', 'facebook'),
  account('ig', 'instagram'),
  account('li', 'linkedin'),
  account('gbp', 'google_business'),
  account('yt', 'youtube'),
];
const library = [media('clip', 'video/mp4'), media('photo', 'image/jpeg')];
const post = (
  accountId: string,
  mediaIds: string[],
  override: NonNullable<SocialPostInput['overrides']>[string] = {},
): SocialPostInput => ({
  caption: 'Smile week',
  accountIds: [accountId],
  mediaIds,
  overrides: { [accountId]: override },
  intent: 'draft',
});

describe('Composer video rules', () => {
  it('lets Facebook and LinkedIn publish one video', () => {
    expect(validateSocialPost(post('fb', ['clip']), accounts, library)).toEqual([]);
    expect(validateSocialPost(post('li', ['clip']), accounts, library)).toEqual([]);
    expect(
      validateSocialPost(post('fb', ['clip'], { postType: 'reel' }), accounts, library),
    ).toEqual([]);
    expect(
      validateSocialPost(post('ig', ['clip'], { postType: 'reel' }), accounts, library),
    ).toEqual([]);
  });

  it('keeps a Reel to exactly one video on Facebook or Instagram', () => {
    expect(
      validateSocialPost(post('fb', ['photo'], { postType: 'reel' }), accounts, library),
    ).toContain('Facebook · fb: a Reel is exactly one video.');
    expect(
      validateSocialPost(post('li', ['clip'], { postType: 'reel' }), accounts, library),
    ).toContain('LinkedIn · li: Reels are for Facebook and Instagram only.');
    expect(
      validateSocialPost(post('fb', ['clip', 'photo']), accounts, library),
    ).toContain('Facebook · fb: a video cannot be combined with other media.');
  });

  it('keeps Business Profile posts to images', () => {
    expect(validateSocialPost(post('gbp', ['clip']), accounts, library)).toContain(
      'Google Business Profile · gbp: Business Profile posts take images only.',
    );
  });

  it('still needs a title for YouTube', () => {
    expect(
      validateSocialPost(
        post('yt', ['clip'], { privacyStatus: 'public' }),
        accounts,
        library,
      ),
    ).toContain('YouTube · yt: add a video title of 1–100 characters.');
  });
});
