import { z } from 'zod';
const short = z.string().max(2000);
const url = z
  .string()
  .max(2000)
  .refine((value) => {
    if (!value) return true;
    try {
      return ['https:', 'http:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, 'Use a complete http or https URL.');
export const contentSnapshotSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().max(500000),
    audience: short,
    purpose: short,
    keywords: short,
    outline: z.string().max(10000),
    sources: z.string().max(10000),
    targetUrl: url,
    metaDescription: short,
    dueDate: z.union([z.literal(''), z.string().date()]),
    brandVersion: z.number().int().positive().nullable(),
  })
  .strict();
export const contentCreateSchema = z
  .object({
    snapshot: contentSnapshotSchema,
    ownerId: z.string().uuid().optional(),
    reviewerId: z.string().uuid().nullable().default(null),
  })
  .strict();
export const contentSaveSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    snapshot: contentSnapshotSchema,
    reviewerId: z.string().uuid().nullable(),
  })
  .strict();
export const contentBodySaveSchema = z.object({ body: z.string().max(500000) }).strict();
export const contentCheckpointSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();
export const contentCommentCreateSchema = z
  .object({
    kind: z.enum(['comment', 'suggestion']),
    anchorFrom: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9_-]+$/),
    anchorTo: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9_-]+$/),
    quotedText: z.string().trim().min(1).max(2000),
    body: z.string().trim().min(1).max(5000),
    suggestedText: z.string().max(500000).nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'suggestion' && !value.suggestedText?.trim())
      ctx.addIssue({
        code: 'custom',
        path: ['suggestedText'],
        message: 'Add the suggested replacement.',
      });
    if (value.kind === 'comment' && value.suggestedText)
      ctx.addIssue({
        code: 'custom',
        path: ['suggestedText'],
        message: 'Comments do not have replacement text.',
      });
  });
export const contentCommentStatusSchema = z
  .object({ status: z.enum(['open', 'resolved', 'accepted', 'rejected']) })
  .strict();
export const contentTransitionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    transition: z.enum(['submit', 'approve', 'request_changes', 'archive', 'reopen']),
    note: z.string().trim().max(2000).default(''),
  })
  .strict();
export const contentRestoreSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    version: z.number().int().positive(),
  })
  .strict();
export const contentBrandSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    guidance: z.string().max(20000),
  })
  .strict();
export const contentParams = z.object({
  siteId: z.string().uuid(),
  documentId: z.string().uuid().optional(),
});
export const contentPage = z.object({
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
