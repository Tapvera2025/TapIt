import { z } from 'zod';
import { toDateOnly } from '../../platform/time.js';

/** Request shapes for the attendance routes (§8.7). */

export const dateSchema = z.string().transform((value, ctx) => {
  try {
    return toDateOnly(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected a date, YYYY-MM-DD' });
    return z.NEVER;
  }
});

/** GET /api/attendance — a range of days, optionally for one person. */
export const listQuerySchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    userId: z.string().uuid().optional(),
  })
  .refine((query) => query.to >= query.from, {
    path: ['to'],
    message: 'The end date must not be before the start date.',
  });

export type ListQuery = z.infer<typeof listQuerySchema>;

/** POST /api/attendance/export — `userIds` can only narrow the caller's scope. */
export const exportSchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    userIds: z.array(z.string().uuid()).min(1).max(10_000).optional(),
  })
  .refine((body) => body.to >= body.from, {
    path: ['to'],
    message: 'The end date must not be before the start date.',
  });

export type ExportBody = z.infer<typeof exportSchema>;

// Payload schemas — each kind has exactly one shape. T-6 is checked before the
// database's whole-second CHECK, so callers get a validation error.
const eventAtSchema = z.string().datetime().refine(
  (value) => new Date(value).getUTCMilliseconds() === 0,
  'Event instant must be a whole second.',
);
const addEventPayload = z.object({
  kind: z.enum(['in', 'out', 'break-start', 'break-end']),
  at:   eventAtSchema,
});

const replaceEventPayload = z.object({
  targetEventId: z.string().uuid(),
  kind: z.enum(['in', 'out', 'break-start', 'break-end']),
  at:   eventAtSchema,
});

const voidEventPayload = z.object({
  targetEventId: z.string().uuid(),
});

const confirmAsIsPayload = z.object({
  reviewItemId: z.string().uuid(),
});

const correctionBodyBase = z.object({
  workDate: dateSchema,
  reason:   z.string().min(20),
});

export const raiseCorrectionSchema = z.discriminatedUnion('kind', [
  correctionBodyBase.extend({ kind: z.literal('add-event'),     userId: z.string().uuid(), payload: addEventPayload }),
  correctionBodyBase.extend({ kind: z.literal('replace-event'), userId: z.string().uuid(), payload: replaceEventPayload }),
  correctionBodyBase.extend({ kind: z.literal('void-event'),    userId: z.string().uuid(), payload: voidEventPayload }),
  correctionBodyBase.extend({ kind: z.literal('confirm-as-is'), userId: z.string().uuid(), payload: confirmAsIsPayload }),
]);

export const requestCorrectionSchema = z.discriminatedUnion('kind', [
  correctionBodyBase.extend({ kind: z.literal('add-event'),     payload: addEventPayload }),
  correctionBodyBase.extend({ kind: z.literal('replace-event'), payload: replaceEventPayload }),
  correctionBodyBase.extend({ kind: z.literal('void-event'),    payload: voidEventPayload }),
  correctionBodyBase.extend({ kind: z.literal('confirm-as-is'), payload: confirmAsIsPayload }),
]);

export const approveSchema = z.object({
  decisionNote: z.string().min(1).optional(),
});

export const rejectSchema = z.object({
  decisionNote: z.string().trim().min(1).max(2000).optional(),
});
export type RejectBody = z.infer<typeof rejectSchema>;

export const correctionListQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'),
  /** Only the caller's own requests, even for an approver. */
  mine: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type CorrectionListQuery = z.infer<typeof correctionListQuerySchema>;

// Grouped creation only. A single targetEventId/reviewItemId cannot belong to
// many employees, so bulk accepts add-event alone until atomic AT-11 approval.
export const bulkCorrectionSchema = correctionBodyBase.extend({
  kind: z.literal('add-event'),
  userIds: z.array(z.string().uuid()).min(1).max(500)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate user IDs.'),
  payload: addEventPayload,
});

export type RaiseCorrectionBody   = z.infer<typeof raiseCorrectionSchema>;
export type RequestCorrectionBody = z.infer<typeof requestCorrectionSchema>;
export type ApproveBody           = z.infer<typeof approveSchema>;
export type BulkCorrectionBody    = z.infer<typeof bulkCorrectionSchema>;
