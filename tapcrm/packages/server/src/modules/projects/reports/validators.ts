import { z } from 'zod';

const url = z.string().trim().url('Enter a valid URL').max(2000).optional().nullable();
const rank = z.number().int().min(1).max(100000);
const keywordBase = z.object({
  keyword: z.string().trim().min(1, 'Keyword is required').max(200), initialRank: rank,
  targetUrl: url, keywordLink: url, searchEngine: z.enum(['google', 'bing']).default('google'),
  country: z.string().trim().min(1).max(100).default('global'), city: z.string().trim().max(100).optional().nullable(),
  device: z.enum(['desktop', 'mobile']).default('desktop'), autoFetchFrequency: z.enum(['manual', 'daily', 'weekly', 'monthly']).default('manual'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'), category: z.enum(['seo', 'gmb']), notes: z.string().trim().max(2000).optional().nullable(),
});
export const createKeywordSchema = keywordBase;
export const updateKeywordSchema = keywordBase.partial();
export const rankUpdateSchema = z.object({ rank: rank.nullable(), status: z.enum(['available', 'unavailable']).default('available') }).superRefine((value, ctx) => {
  if (value.status === 'available' && value.rank === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rank'], message: 'Enter a rank or choose unavailable' });
  if (value.status === 'unavailable' && value.rank !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rank'], message: 'Unavailable rankings must not include a rank' });
});
export const blogSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(300), url, description: z.string().trim().max(10000).optional().nullable(),
  category: z.enum(['blog-post', 'article', 'news', 'tutorial', 'case-study', 'other']),
  status: z.enum(['draft', 'published', 'archived']), publishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional().nullable(),
  wordCount: z.number().int().min(0).max(1000000).default(0), targetKeywords: z.array(z.string().trim().min(1).max(200)).max(100).default([]), notes: z.string().trim().max(5000).optional().nullable(),
}).superRefine((value, ctx) => { if (value.status === 'published' && !value.publishDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['publishDate'], message: 'Publish date is required for published posts' }); });
export const reportQuerySchema = z.object({ period: z.coerce.number().int().refine((v): v is 7 | 30 | 90 => v === 7 || v === 30 || v === 90).default(30), keywordSearch: z.string().trim().max(200).optional(), keywordCategory: z.enum(['all', 'seo', 'gmb']).default('all'), keywordPriority: z.enum(['all', 'low', 'medium', 'high']).default('all'), keywordDevice: z.enum(['all', 'desktop', 'mobile']).default('all'), keywordTrend: z.enum(['all', 'improving', 'declining', 'stagnant', 'unclassified']).default('all'), keywordPage: z.coerce.number().int().min(1).default(1), blogSearch: z.string().trim().max(200).optional(), blogStatus: z.enum(['all', 'draft', 'published', 'archived']).default('all'), blogPage: z.coerce.number().int().min(1).default(1) });
export const idParamSchema = z.object({ id: z.string().uuid() });
export const nestedIdSchema = z.object({ id: z.string().uuid(), keywordId: z.string().uuid() });
export const blogIdSchema = z.object({ id: z.string().uuid(), blogId: z.string().uuid() });
export type CreateKeywordInput = z.infer<typeof createKeywordSchema>;
export type UpdateKeywordInput = z.infer<typeof updateKeywordSchema>;
export type RankUpdateInput = z.infer<typeof rankUpdateSchema>;
export type BlogInput = z.infer<typeof blogSchema>;
export type ReportQuery = z.infer<typeof reportQuerySchema>;

/**
 * Search Console property forms. A domain property is 'sc-domain:example.com';
 * a URL-prefix one is an ordinary https URL. Nothing else is accepted, because
 * anything else is rejected by the API with an unhelpful error.
 */
export const searchConsoleLinkSchema = z.object({
  propertyUrl: z.string().trim().min(1, 'Choose a Search Console property').max(500).refine(
    (value) => value.startsWith('sc-domain:') || /^https?:\/\/.+/i.test(value),
    'A property is either "sc-domain:example.com" or a URL beginning with https://',
  ),
});
export type SearchConsoleLinkInput = z.infer<typeof searchConsoleLinkSchema>;
