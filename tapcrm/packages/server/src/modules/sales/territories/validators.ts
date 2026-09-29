import { z } from 'zod';
import { TERRITORY_DIMENSIONS } from './types.js';

const ruleSchema = z.object({
  dimension: z.enum(TERRITORY_DIMENSIONS),
  value: z.string().trim().min(1).max(160),
});

export const createTerritorySchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  salesTeamId: z.string().uuid(),
  status: z.enum(['active', 'inactive']).optional().default('active'),
  rules: z.array(ruleSchema).max(100).optional().default([]),
}).superRefine((input, ctx) => {
  const seen = new Set<string>();
  for (const rule of input.rules) {
    const key = `${rule.dimension}:${rule.value.toLocaleLowerCase()}`;
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['rules'], message: 'Duplicate territory rule' });
    seen.add(key);
  }
});

export const updateTerritorySchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  rules: z.array(ruleSchema).max(100).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one territory field is required' });

export const territoryStatusSchema = z.object({ status: z.enum(['active', 'inactive']) });
export const routingConfigurationSchema = z.object({
  enabled: z.boolean().default(true),
  assignmentStrategy: z.literal('fewest_open_leads').default('fewest_open_leads'),
});
export const territoryReassignmentSchema = z.object({ salesTeamId: z.string().uuid(), confirm: z.literal(true) });
export const territoryReportingQuerySchema = z.object({
  territoryId: z.string().uuid().optional(),
  salesTeamId: z.string().uuid().optional(),
  salesPoolId: z.string().uuid().optional(),
  source: z.string().trim().min(1).max(160).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: 'from must be on or before to' });

export type CreateTerritoryInput = z.infer<typeof createTerritorySchema>;
export type UpdateTerritoryInput = z.infer<typeof updateTerritorySchema>;
export type TerritoryStatusInput = z.infer<typeof territoryStatusSchema>;
export type RoutingConfigurationInput = z.infer<typeof routingConfigurationSchema>;
export type TerritoryReassignmentInput = z.infer<typeof territoryReassignmentSchema>;
export type TerritoryReportingQuery = z.infer<typeof territoryReportingQuerySchema>;
