import type { SocialAccount, SocialMedia, SocialPostInput } from './types.js';
import { PLATFORM_LABELS } from './types.js';

const limits = {
  facebook: 63_206,
  instagram: 2_200,
  linkedin: 3_000,
  google_business: 1_500,
  youtube: 5_000,
};
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export function validateSocialFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!['image/jpeg', 'image/png', 'video/mp4'].includes(file.type))
    return 'Choose a JPEG, PNG or MP4 file.';
  const max = file.type.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size === 0 || file.size > max)
    return `File must be between 1 byte and ${max / 1024 / 1024} MB.`;
  return null;
}
export function validateSocialPost(
  input: SocialPostInput,
  accounts: SocialAccount[],
  media: SocialMedia[],
): string[] {
  const messages: string[] = [];
  if (!input.accountIds.length) messages.push('Select at least one connected account.');
  for (const accountId of input.accountIds) {
    const account = accounts.find((item) => item.id === accountId);
    if (!account || account.status !== 'connected') {
      messages.push('A selected account needs to be reconnected.');
      continue;
    }
    const platform = account.platform;
    const label = `${PLATFORM_LABELS[platform]} · ${account.name}`;
    const override = input.overrides?.[accountId];
    const caption = override?.caption ?? input.caption;
    const title = override?.title ?? input.title ?? '';
    const ids = override?.mediaIds ?? input.mediaIds;
    const postType = override?.postType ?? 'feed';
    const selectedMedia = media.filter((item) => ids.includes(item.id));
    const videos = selectedMedia.filter((item) => item.mimeType.startsWith('video/'));
    const images = selectedMedia.filter((item) => item.mimeType.startsWith('image/'));
    if (postType === 'story' && platform !== 'instagram')
      messages.push(`${label}: Stories are supported for Instagram destinations only.`);
    if (platform === 'instagram' && postType === 'story' && selectedMedia.length !== 1)
      messages.push(`${label}: Instagram Stories need exactly one image or video.`);
    if (caption.length > limits[platform])
      messages.push(
        `${label}: caption exceeds ${limits[platform].toLocaleString()} characters.`,
      );
    if (!caption.trim() && selectedMedia.length === 0 && postType !== 'story')
      messages.push(`${label}: add a caption or media.`);
    if (platform === 'instagram' && !selectedMedia.length)
      messages.push(`${label}: an image or Reel video is required.`);
    if (platform === 'youtube' && (videos.length !== 1 || images.length > 0))
      messages.push(`${label}: select one MP4 video and no images.`);
    if (platform === 'youtube' && (!title.trim() || title.length > 100))
      messages.push(`${label}: add a video title of 1–100 characters.`);
    if (platform !== 'instagram' && platform !== 'youtube' && videos.length)
      messages.push(`${label}: video publishing is unavailable in this integration.`);
    if (videos.length > 1 || (videos.length && images.length))
      messages.push(`${label}: a video cannot be combined with other media.`);
    const maxMedia = platform === 'facebook' || platform === 'instagram' ? 10 : 1;
    if (selectedMedia.length > maxMedia)
      messages.push(
        `${label}: supports up to ${maxMedia} media item${maxMedia === 1 ? '' : 's'}.`,
      );
    if (platform === 'instagram' && images.some((item) => item.mimeType !== 'image/jpeg'))
      messages.push(`${label}: Instagram images must be JPEG.`);
    if (platform === 'youtube' && /[<>]/.test(title + caption))
      messages.push(`${label}: titles and descriptions cannot contain angle brackets.`);
    if (ids.some((id) => !media.some((item) => item.id === id)))
      messages.push(`${label}: selected media is unavailable.`);
    const link = override?.link ?? input.link;
    if (link && ['instagram', 'youtube'].includes(platform))
      messages.push(
        `${label}: include links in the caption instead of attaching a link.`,
      );
    if (platform === 'facebook' && link && selectedMedia.length)
      messages.push(`${label}: choose an attached link or images.`);
    if (link) {
      try {
        if (new URL(link).protocol !== 'https:')
          messages.push(`${label}: links must use HTTPS.`);
      } catch {
        messages.push(`${label}: enter a valid HTTPS link.`);
      }
    }
  }
  return [...new Set(messages)];
}
