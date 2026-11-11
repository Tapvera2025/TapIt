import { z } from 'zod';
import { CALL_OUTCOMES, TELEPHONY_PROVIDERS } from './types.js';

const secret = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(8, `${label} looks too short. Copy it again from the platform.`)
    .max(512, `${label} is too long.`)
    .refine((value) => !/\s/.test(value), `${label} cannot contain spaces.`);

export const justCallCredentialsSchema = z.object({
  provider: z.literal('justcall'),
  apiKey: secret('API key'),
  apiSecret: secret('API secret'),
});

export const aircallCredentialsSchema = z.object({
  provider: z.literal('aircall'),
  apiId: secret('API ID'),
  apiToken: secret('API token'),
});

export const credentialsSchema = z.discriminatedUnion('provider', [justCallCredentialsSchema, aircallCredentialsSchema]);

const label = z.string().trim().min(1, 'Give the connection a name').max(120);
const backfillDays = z.coerce.number().int().min(1).max(365);

export const createConnectionSchema = z.object({
  label: label.optional(),
  backfillDays: backfillDays.default(30),
  credentials: credentialsSchema,
});
export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;

export const updateConnectionSchema = z
  .object({
    label: label.optional(),
    backfillDays: backfillDays.optional(),
    status: z.enum(['active', 'paused']).optional(),
    credentials: credentialsSchema.optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), 'Nothing to change');
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;

export const agentMappingSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('employee'), employeeId: z.string().uuid('Choose an employee') }),
  z.object({ mode: z.literal('ignore') }),
  z.object({ mode: z.literal('auto') }),
]);
export type AgentMappingInput = z.infer<typeof agentMappingSchema>;

export const agentListQuerySchema = z.object({
  connectionId: z.string().uuid().optional(),
  status: z.enum(['all', 'matched', 'unmatched', 'ignored']).default('all'),
});
export type AgentListQuery = z.infer<typeof agentListQuerySchema>;

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-01')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Not a real date');

/** Filters shared by the overview and the call log. Dates are days in the company's timezone. */
const filters = {
  from: day.optional(),
  to: day.optional(),
  employeeId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  provider: z.enum(TELEPHONY_PROVIDERS).optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
};

function rangeIsValid(value: { from?: string | undefined; to?: string | undefined }): boolean {
  if (!value.from || !value.to) return true;
  const span = (Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86_400_000;
  return span >= 0 && span <= 366;
}

export const overviewQuerySchema = z
  .object(filters)
  .refine(rangeIsValid, 'Pick a date range of at most a year, with the start before the end');
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

export const callListQuerySchema = z
  .object({
    ...filters,
    outcome: z.enum(CALL_OUTCOMES).optional(),
    search: z.string().trim().max(120).optional(),
    unmatched: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine(rangeIsValid, 'Pick a date range of at most a year, with the start before the end');
export type CallListQuery = z.infer<typeof callListQuerySchema>;

export const runListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
