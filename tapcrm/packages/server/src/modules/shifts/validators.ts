import { z } from 'zod';
import { toDateOnly, toLocalTime } from '../../platform/time.js';

const date = z.string().transform((value, ctx) => {
  try {
    return toDateOnly(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected a date, YYYY-MM-DD' });
    return z.NEVER;
  }
});

const time = z.string().transform((value, ctx) => {
  try {
    return toLocalTime(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected a time, HH:mm' });
    return z.NEVER;
  }
});

const minutes = (max: number) => z.number().int().min(0).max(max);

export const versionSchema = z.object({
  effectiveFrom: date.optional(),
  startTime: time.nullable().default(null),
  endTime: time.nullable().default(null),
  graceMinutes: minutes(240),
  earlyExitGraceMinutes: minutes(240).default(0),
  fullDayMinutes: minutes(1_440),
  halfDayMinutes: minutes(1_440),
  complementaryHalfMinutes: minutes(720).nullable().default(null),
  minOvertimeMinutes: minutes(1_440).nullable().default(null),
  earlyWindowMinutes: minutes(720).default(180),
  maxClosingExtensionMinutes: minutes(720).nullable().default(null),
});

export const createShiftSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['fixed', 'flexible']),
  version: versionSchema,
});

export const reviseShiftSchema = z.union([
  z.object({ status: z.enum(['active', 'inactive']) }).strict(),
  z.object({ version: versionSchema }).strict(),
]);

const reason = z.string().trim().min(1).max(500);
const weekdays = z.object({
  '1': z.string().uuid().nullable(),
  '2': z.string().uuid().nullable(),
  '3': z.string().uuid().nullable(),
  '4': z.string().uuid().nullable(),
  '5': z.string().uuid().nullable(),
  '6': z.string().uuid().nullable(),
  '7': z.string().uuid().nullable(),
});

const period = { effectiveFrom: date, effectiveTo: date.nullable().default(null) };

export const assignmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('template'),
    userId: z.string().uuid(),
    shiftId: z.string().uuid(),
    reason: reason.optional(),
    ...period,
  }),
  z.object({
    kind: z.literal('rotation'),
    userId: z.string().uuid(),
    rotation: z.union([
      z.object({ id: z.string().uuid() }),
      z.object({ name: z.string().trim().min(1).max(120), days: weekdays }),
    ]),
    reason: reason.optional(),
    ...period,
  }),
  z.object({
    kind: z.literal('permanent-flexible'),
    userId: z.string().uuid(),
    reason: reason.optional(),
    ...period,
  }),
  z.object({
    kind: z.literal('override'),
    userId: z.string().uuid(),
    workDate: date,
    override: z.enum(['shift', 'flexible', 'no-shift']),
    shiftId: z.string().uuid().nullable().default(null),
    reason,
  }),
  z.object({
    kind: z.literal('department-default'),
    departmentId: z.string().uuid(),
    shiftId: z.string().uuid(),
    ...period,
  }),
]);

export const explainQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  from: date.optional(),
  to: date.optional(),
});

export const decideSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500).nullable().default(null),
});

export type VersionBody = z.infer<typeof versionSchema>;
export type CreateShiftBody = z.infer<typeof createShiftSchema>;
export type ReviseShiftBody = z.infer<typeof reviseShiftSchema>;
export type AssignmentBody = z.infer<typeof assignmentSchema>;
export type DecideBody = z.infer<typeof decideSchema>;
