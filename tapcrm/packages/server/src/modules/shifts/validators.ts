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

const weekdayList = z
  .array(z.number().int().min(1).max(7))
  .min(1, 'Select at least one working weekday.')
  .max(7)
  .refine((days) => new Set(days).size === days.length, 'Working weekdays cannot repeat.')
  .transform((days) => [...days].sort((a, b) => a - b));

export const createWeekdayScheduleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  workingWeekdays: weekdayList,
});

export const updateWeekdayScheduleSchema = z.object({
  status: z.enum(['active', 'inactive']),
});

export const createWorkingDayExceptionSchema = z.object({
  exceptionDate: date,
  reason: z.string().trim().min(1, 'Enter a reason for the working-day exception.').max(500),
  scope: z.discriminatedUnion('type', [
    z.object({ type: z.literal('organization'), departmentIds: z.array(z.string().uuid()).max(0).default([]) }),
    z.object({ type: z.literal('departments'), departmentIds: z.array(z.string().uuid()).min(1, 'Select at least one department.').max(100) }),
  ]),
});

export const updateWorkingDayExceptionSchema = z.object({
  status: z.enum(['active', 'inactive']),
});

export const workingDayExceptionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

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
export type CreateWeekdayScheduleBody = z.infer<typeof createWeekdayScheduleSchema>;
export type UpdateWeekdayScheduleBody = z.infer<typeof updateWeekdayScheduleSchema>;
export type CreateWorkingDayExceptionBody = z.infer<typeof createWorkingDayExceptionSchema>;
export type UpdateWorkingDayExceptionBody = z.infer<typeof updateWorkingDayExceptionSchema>;
export type WorkingDayExceptionListQuery = z.infer<typeof workingDayExceptionListQuerySchema>;
