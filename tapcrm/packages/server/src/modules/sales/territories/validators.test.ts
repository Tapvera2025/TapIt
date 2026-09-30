import { describe, expect, it } from 'vitest';
import { createTerritorySchema } from './validators.js';

const team = '00000000-0000-0000-0000-000000000001';

describe('territory validators', () => {
  it('accepts zero or more flexible rules', () => {
    expect(createTerritorySchema.parse({ name: 'Unsegmented', salesTeamId: team }).rules).toEqual([]);
    expect(createTerritorySchema.parse({ name: 'East SaaS', salesTeamId: team, rules: [{ dimension: 'geography', value: 'West Bengal' }, { dimension: 'product', value: 'CRM' }] }).rules).toHaveLength(2);
  });

  it('rejects invalid status, dimensions, and empty values', () => {
    expect(() => createTerritorySchema.parse({ name: '', salesTeamId: team })).toThrow();
    expect(() => createTerritorySchema.parse({ name: 'A', salesTeamId: team, status: 'paused' })).toThrow();
    expect(() => createTerritorySchema.parse({ name: 'A', salesTeamId: team, rules: [{ dimension: 'region', value: 'East' }] })).toThrow();
    expect(() => createTerritorySchema.parse({ name: 'A', salesTeamId: team, rules: [{ dimension: 'geography', value: ' ' }] })).toThrow();
  });

  it('does not allow generic updates to carry a Sales Team change', async () => {
    const { updateTerritorySchema } = await import('./validators.js');
    expect(updateTerritorySchema.safeParse({ salesTeamId: team }).success).toBe(false);
  });

  it('rejects routing strategies that are not implemented yet', async () => {
    const { routingConfigurationSchema } = await import('./validators.js');
    expect(routingConfigurationSchema.parse({ enabled: true }).assignmentStrategy).toBe('fewest_open_leads');
    expect(routingConfigurationSchema.safeParse({ enabled: true, assignmentStrategy: 'round_robin' }).success).toBe(false);
    expect(routingConfigurationSchema.safeParse({ enabled: true, assignmentStrategy: 'manual_queue' }).success).toBe(false);
  });
});
