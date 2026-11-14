import { z } from 'zod';

const date = z.string().date();
const currency = z.string().regex(/^[A-Z]{3}$/);
const reason = z.string().trim().min(3).max(1000);

export const forecastSchema = z.object({
  asOfDate: date,
  baseCurrency: currency,
  horizonWeeks: z.number().int().min(1).max(52).default(13),
  minimumCash: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0'),
  reason,
});
export const scenarioSchema = z.object({
  name: z.string().trim().min(2).max(160),
  snapshotId: z.string().uuid(),
  baseCurrency: currency,
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  adjustments: z.array(z.object({
    bucketNumber: z.number().int().positive(),
    inflowDelta: z.string().regex(/^-?\d+(\.\d{1,2})?$/).default('0'),
    outflowDelta: z.string().regex(/^-?\d+(\.\d{1,2})?$/).default('0'),
    note: z.string().trim().min(2).max(300),
  })).max(52).default([]),
  reason,
});
export const snapshotIdSchema = z.object({ id: z.string().uuid() });

export type ForecastInput = z.infer<typeof forecastSchema>;
export type ScenarioInput = z.infer<typeof scenarioSchema>;
