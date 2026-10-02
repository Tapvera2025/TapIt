import { isIP } from 'node:net';
import { z } from 'zod';
import { toDateOnly } from '../../platform/time.js';

const date = z.string().transform((value, ctx) => {
  try {
    return toDateOnly(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected a date, YYYY-MM-DD' });
    return z.NEVER;
  }
});

const direction = z.enum(['entry', 'exit', 'both-trusted', 'alternating', 'undirected']);

/** An address or a network, as `inet` stores it: 203.0.113.7 or 203.0.113.0/24. */
const address = z
  .string()
  .trim()
  .refine((value) => {
    const [ip, bits, ...rest] = value.split('/');
    if (rest.length > 0 || ip === undefined) return false;
    const family = isIP(ip);
    if (family === 0) return false;
    if (bits === undefined) return true;
    const width = Number(bits);
    return /^\d+$/.test(bits) && width <= (family === 4 ? 32 : 128);
  }, 'Expected an IP address or network');

export const serialSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,64}$/, 'Expected a device serial');

/** A PIN as the device spells it: leading zeros are part of it. */
const pin = z
  .string()
  .regex(/^[A-Za-z0-9]{1,32}$/, 'Expected a PIN of letters and digits');

export const createDeviceSchema = z.object({
  serialNumber: serialSchema,
  name: z.string().trim().min(1).max(120),
  locationLabel: z.string().trim().max(120).nullable().default(null),
  /** 5a registers the ADMS adapter only; others arrive with their own machine surface. */
  adapter: z.literal('zk-adms'),
  /** Reuse this connector; without it the tenant's active ADMS connector, or a new one. */
  connectorId: z.string().uuid().optional(),
  /** Defaults to the organization's timezone. */
  timezone: z.string().optional(),
});
export type CreateDeviceBody = z.infer<typeof createDeviceSchema>;

export const patchDeviceSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    locationLabel: z.string().trim().max(120).nullable(),
    status: z.enum(['enabled', 'disabled']),
    dryRun: z.boolean(),
    timezone: z.string(),
    handshakeTimezone: z.union([
      z.enum(['derive', 'omit']),
      z.string().regex(/^[+-]?\d{1,2}$/),
    ]),
    clockOffsetSeconds: z.number().int().min(-86_400).max(86_400),
    readerDirection: direction,
    trustStatusKeys: z.boolean(),
    readers: z
      .array(
        z.object({
          readerKey: z.string().trim().min(1).max(64),
          label: z.string().trim().min(1).max(120),
          direction,
        }),
      )
      .max(32),
    ipAllowlist: z.array(address).max(32),
    backfillHours: z.number().int().min(1).max(8760),
    stampMode: z.enum(['resend-all', 'resume']),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change');
export type PatchDeviceBody = z.infer<typeof patchDeviceSchema>;

export const mappingSchema = z
  .object({
    connectorId: z.string().uuid(),
    /** Null or absent: every device on the connector. */
    deviceId: z.string().uuid().nullable().default(null),
    pin,
    userId: z.string().uuid(),
    effectiveFrom: date,
    /** Exclusive; null: until changed. */
    effectiveTo: date.nullable().default(null),
  })
  .strict();
export type MappingBody = z.infer<typeof mappingSchema>;

export const punchQuerySchema = z.object({
  status: z
    .enum(['received', 'applied', 'duplicate', 'unmapped', 'dry-run', 'rejected', 'held'])
    .optional(),
  deviceId: z.string().uuid().optional(),
  pin: pin.optional(),
  userId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** The `next` of the previous page. */
  after: z.string().max(200).optional(),
});
export type PunchQuery = z.infer<typeof punchQuerySchema>;

export const deviceQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  after: serialSchema.optional(),
});
export type DeviceQuery = z.infer<typeof deviceQuerySchema>;

export const REPLAY_MAX_DAYS = 92;

export const replaySchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
    from: date,
    to: date,
    punchIds: z.array(z.string().uuid()).min(1).max(500).optional(),
    deviceId: z.string().uuid().optional(),
    pin: pin.optional(),
    userId: z.string().uuid().optional(),
    /** An explicit HR replay may release the backfill hold; nothing else. */
    releaseHold: z.boolean().default(false),
  })
  .strict();
export type ReplayBody = z.infer<typeof replaySchema>;
