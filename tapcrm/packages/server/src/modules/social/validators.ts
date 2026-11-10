import { z } from 'zod';
import { SOCIAL_PLATFORMS, SOCIAL_POST_STATUSES } from '@tapcrm/contracts';

const ids = z
  .array(z.string().uuid())
  .max(20)
  .refine(
    (values) => new Set(values).size === values.length,
    'Duplicate selections are not allowed',
  );
const link = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Links must use HTTPS');
const timestamp = z.string().datetime({ offset: true });
/** One status, or several separated by commas (`draft,scheduled`); empty means all. */
const statusFilter = z
  .string()
  .max(300)
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(SOCIAL_POST_STATUSES)).max(SOCIAL_POST_STATUSES.length))
  .transform((values) => (values.length ? [...new Set(values)] : undefined));
const filterDate = z.union([timestamp, z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
const override = z
  .object({
    caption: z.string().max(63206).optional(),
    title: z.string().max(500).optional(),
    link: z.union([link, z.literal('')]).optional(),
    mediaIds: ids.optional(),
    postType: z.enum(['feed', 'story', 'reel']).optional(),
    privacyStatus: z.enum(['public', 'unlisted', 'private']).optional(),
  })
  .strict();
export const socialPostSchema = z
  .object({
    caption: z.string().max(63206).default(''),
    accountIds: ids.default([]),
    mediaIds: ids.default([]),
    overrides: z.record(z.string().uuid(), override).optional(),
    title: z.string().max(500).optional(),
    link: link.optional(),
    scheduledAt: timestamp.optional(),
    intent: z.enum(['draft', 'publish', 'schedule', 'submit']).default('draft'),
  })
  .strict();
export const socialPostActionSchema = z
  .object({
    action: z.enum([
      'publish',
      'schedule',
      'cancel',
      'duplicate',
      'submit',
      'approve',
      'request_changes',
    ]),
    scheduledAt: timestamp.optional(),
    comment: z.string().trim().max(4000).optional(),
  })
  .strict();
export const socialPostQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: statusFilter.optional(),
  platform: z.enum(SOCIAL_PLATFORMS).optional(),
  from: filterDate.optional(),
  to: filterDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['newest', 'oldest']).default('newest'),
});
export const socialSettingsSchema = z
  .object({
    timezone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Choose an IANA timezone'),
    approvalRequired: z.boolean(),
    clientReviewEnabled: z.boolean().default(false),
  })
  .strict();
export const socialMediaSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']),
    base64: z
      .string()
      .min(1)
      .max(70 * 1024 * 1024),
  })
  .strict();
export const socialAnalyticsQuerySchema = z.object({
  from: filterDate.optional(),
  to: filterDate.optional(),
});
