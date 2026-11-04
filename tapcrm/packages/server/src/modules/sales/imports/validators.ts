import { z } from 'zod';
import { IMPORT_FIELDS } from './mapping.js';

const uuid = z.string().uuid('Not a valid id');
const page = z.coerce.number().int().min(1).max(100_000).default(1);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** ~10 MB of file bytes, base64-encoded. */
const MAX_BASE64 = 14_000_000;

export const createImportSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('file'),
    fileName: z.string().trim().min(1).max(255),
    fileBase64: z.string().min(1).max(MAX_BASE64, 'The file is larger than 10 MB.'),
    sheet: optionalText(255),
    name: optionalText(160),
  }),
  z.object({
    kind: z.literal('google_sheet'),
    url: z.string().trim().min(1).max(2048),
    name: optionalText(160),
  }),
  z.object({
    kind: z.literal('paste'),
    text: z.string().min(1).max(MAX_BASE64, 'That is more text than one import can take.'),
    name: optionalText(160),
  }),
]);
export type CreateImportInput = z.infer<typeof createImportSchema>;

export const importSettingsSchema = z.object({
  name: z.string().trim().min(1, 'Give the import a name').max(160),
  columnMapping: z.record(z.string().regex(/^\d{1,3}$/), z.enum(IMPORT_FIELDS)).default({}),
  leadSourceId: uuid.nullable().default(null),
  campaignId: uuid.nullable().default(null),
  defaultCountryCode: z
    .string()
    .trim()
    .regex(/^\+?[1-9]\d{0,2}$/, 'Enter a country code such as 91 or +1')
    .transform((value) => value.replace(/^\+/, ''))
    .nullable()
    .default(null),
  extraColumnsToNotes: z.boolean().default(true),
  assigneeMapping: z.record(z.string().max(300), uuid.nullable()).default({}),
});
export type ImportSettingsInput = z.infer<typeof importSettingsSchema>;

export const listImportsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const importRowsQuerySchema = z.object({
  status: z.enum(['all', 'problems', 'pending', 'created', 'existing', 'duplicate', 'invalid', 'failed']).default('all'),
  page,
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ImportRowsQuery = z.infer<typeof importRowsQuerySchema>;

const callStatus = z.enum(['not_called', 'no_answer', 'connected', 'other', 'no_phone']);

const importedLeadsFilter = z.object({
  importId: uuid.optional(),
  assignment: z.enum(['all', 'unassigned', 'assigned']).default('all'),
  ownerId: uuid.optional(),
  callStatus: callStatus.optional(),
  search: optionalText(200),
});
export type ImportedLeadsFilter = z.infer<typeof importedLeadsFilter>;

export const importedLeadsQuerySchema = importedLeadsFilter.extend({
  page,
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ImportedLeadsQuery = z.infer<typeof importedLeadsQuerySchema>;

export const ASSIGN_LIMIT = 10_000;

export const assignSchema = z
  .object({
    leadIds: z.array(uuid).max(ASSIGN_LIMIT).optional(),
    /** Every lead matching the Imported leads filters, instead of a list. */
    filter: importedLeadsFilter.optional(),
    employeeIds: z.array(uuid).min(1, 'Pick at least one person').max(200),
    /** Also move leads that already have an owner. */
    includeAssigned: z.boolean().default(false),
  })
  .refine((value) => (value.leadIds?.length ?? 0) > 0 || value.filter !== undefined, {
    message: 'Pick the leads to assign',
    path: ['leadIds'],
  });
export type AssignInput = z.infer<typeof assignSchema>;

export const callTrackingQuerySchema = z.object({
  importId: uuid.optional(),
  ownerId: uuid.optional(),
  assignedBy: z.enum(['anyone', 'me']).default('anyone'),
  from: day.optional(),
  to: day.optional(),
  status: callStatus.or(z.literal('all')).default('all'),
  search: optionalText(200),
  sort: z.enum(['assigned_desc', 'assigned_asc', 'last_call_desc', 'waiting_longest']).default('assigned_desc'),
  page,
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type CallTrackingQuery = z.infer<typeof callTrackingQuerySchema>;
