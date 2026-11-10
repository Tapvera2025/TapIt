import { z } from 'zod';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

export const createSiteSchema = z.object({
  clientId: uuid.nullable().default(null),
  displayUrl: z.string().url().max(2048).refine(
    (v) => new URL(v).protocol === 'https:' || new URL(v).protocol === 'http:',
    'URL must use http or https',
  ),
  timezone: z.string().min(1).max(64).default('UTC'),
  locale: z.string().min(2).max(10).default('en'),
  businessIntents: z.array(z.string().max(100)).max(20).default([]),
  stackNotes: z.string().max(1000).nullable().default(null),
}).strict();

export const updateSiteSchema = z.object({
  timezone: z.string().min(1).max(64).optional(),
  locale: z.string().min(2).max(10).optional(),
  businessIntents: z.array(z.string().max(100)).max(20).optional(),
  stackNotes: z.string().max(1000).nullable().optional(),
  active: z.boolean().optional(),
}).strict();

export const triggerScanSchema = z.object({
  siteId: uuid,
  configId: uuid.optional(),
}).strict();

export const gscSyncSchema = z.object({
  siteId: uuid,
  propertyUrl: z.string().url(),
  startDate: isoDate,
  endDate: isoDate,
  searchType: z.enum(['web', 'image', 'video', 'news', 'discover', 'googleNews']).default('web'),
}).strict();

export const findingQuerySchema = z.object({
  siteId: uuid,
  status: z.enum(['open', 'dismissed', 'resolved', 'fixed_unverified']).optional(),
  severity: z.enum(['critical', 'high', 'moderate', 'low', 'informational']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

export const findingsTrendQuerySchema = z.object({
  days: z.preprocess(
    value => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
    z.number().int().min(1).max(180).default(30),
  ),
}).strict();

export const updateFindingSchema = z.object({
  status: z.enum(['dismissed', 'resolved']).optional(),
  assignedTo: uuid.nullable().optional(),
}).strict();

export const gscMetricsQuerySchema = z.object({
  siteId: uuid,
  startDate: isoDate,
  endDate: isoDate,
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
}).strict();

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const fixProposalStatusQuery = z.object({
  status: z.enum(['proposed', 'applied', 'rejected', 'superseded']).optional(),
});

export const updateFixProposalSchema = z.object({
  status: z.enum(['executed', 'rejected']),
}).strict();

export const updateRuleSchema = z.object({
  active: z.boolean(),
}).strict();

export const siteIdParam = z.object({ siteId: uuid });
export const scanRunIdParam = z.object({ scanRunId: uuid });
export const findingIdParam = z.object({ findingId: uuid });
export const fixProposalIdParam = z.object({ proposalId: uuid });
export const ruleIdParam = z.object({ ruleId: z.string().min(1).max(64) });
export const alertIdParam = z.object({ alertId: uuid });

const allowance = z.number().int().min(0).max(100_000);

/** Checkup settings and paid-source allowances for one website. */
export const siteSettingsSchema = z.object({
  crawl: z.object({
    maxPages: z.number().int().min(1).max(5000).optional(),
    renderPolicy: z.enum(['never', 'heuristic', 'always']).optional(),
    maxRenderPages: z.number().int().min(0).max(500).optional(),
    respectRobots: z.boolean().optional(),
    followSitemaps: z.boolean().optional(),
    crawlDelayMs: z.number().int().min(0).max(10_000).optional(),
    exclusionPatterns: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
    crawlerIdentity: z.enum(['tapcrm', 'browser']).optional(),
  }).strict().optional(),
  allowances: z.object({
    serpSearches: allowance.optional(),
    perplexity: allowance.optional(),
    moz: allowance.optional(),
  }).strict().optional(),
}).strict();

export const keywordParams = z.object({ siteId: uuid, keywordId: uuid });
export const updateKeywordSchema = z.object({ tracked: z.boolean() }).strict();
