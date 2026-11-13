import { z } from 'zod';
import { MEETING_DURATIONS, MEETING_STATUSES } from './types.js';

const uuid = z.string().uuid();
const instant = z.coerce.date();
const duration = z.coerce.number().int().refine((value) => (MEETING_DURATIONS as readonly number[]).includes(value), {
  message: `Pick a length of ${MEETING_DURATIONS.join(', ')} minutes`,
});
const meetUrl = z.string().trim().url().max(500).refine((value) => value.startsWith('https://'), { message: 'Use an https:// meeting link' });

export const meetingListQuerySchema = z.object({
  from: instant.optional(),
  to: instant.optional(),
  status: z.enum(MEETING_STATUSES).optional(),
  hostId: uuid.optional(),
  clientId: uuid.optional(),
});
export type MeetingListQuery = z.infer<typeof meetingListQuerySchema>;

export const availabilityQuerySchema = z.object({
  userIds: z.union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : value.split(',')).map((id) => id.trim()).filter(Boolean))
    .pipe(z.array(uuid).min(1).max(8)),
  durationMinutes: duration.default(30),
  days: z.coerce.number().int().min(1).max(30).default(14),
});

export const scheduleMeetingSchema = z.object({
  clientId: uuid,
  projectId: uuid.nullable().optional(),
  title: z.string().trim().min(1).max(200),
  agenda: z.string().trim().max(2000).nullable().optional(),
  startsAt: instant,
  durationMinutes: duration,
  staffIds: z.array(uuid).max(7).default([]),
  meetUrl: meetUrl.nullable().optional(),
});
export type ScheduleMeetingInput = z.infer<typeof scheduleMeetingSchema>;

export const acceptMeetingSchema = z.object({ meetUrl: meetUrl.nullable().optional() }).default({});

export const proposeTimesSchema = z.object({
  times: z.array(instant).min(1).max(3),
  note: z.string().trim().max(500).nullable().optional(),
});

export const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Say why, in a few words').max(500) });
export const optionalReasonSchema = z.object({ reason: z.string().trim().max(500).nullable().optional() }).default({});

export const completeMeetingSchema = z.object({
  outcome: z.enum(['completed', 'no_show']),
  note: z.string().trim().max(2000).nullable().optional(),
});

export const meetingLinkSchema = z.object({ meetUrl });

export const calendarCompleteSchema = z.object({
  code: z.string().min(1).max(4096),
  state: z.string().min(1).max(512),
});

/* Client portal */

export const portalSlotsQuerySchema = z.object({
  hostId: uuid.optional(),
  durationMinutes: duration.default(30),
});

export const portalRequestSchema = z.object({
  projectId: uuid,
  hostId: uuid.nullable().optional(),
  startsAt: instant,
  durationMinutes: duration,
  agenda: z.string().trim().min(3, 'Say what you would like to talk about').max(2000),
});
export type PortalRequestInput = z.infer<typeof portalRequestSchema>;

export const portalChooseSchema = z.object({ proposalId: uuid });
