import { describe, expect, it } from 'vitest';
import { routeLead } from './router.js';

const candidate = (agentId: string, openLeadCount: number, active = true, punchedIn = true) => ({ agentId, salesTeamId: 'team', openLeadCount, active, punchedIn });
const base = { source: 'website', geography: 'India', industry: 'SaaS', territories: [], candidates: [] as ReturnType<typeof candidate>[] };

describe('territory routing engine', () => {
  it('keeps creator ownership out of routing', () => expect(routeLead({ ...base, createdByUserId: 'agent' })).toEqual({ type: 'SKIPPED', reason: 'AGENT_CREATED', ownerId: 'agent' }));
  it('uses the global pool when no territories exist', () => expect(routeLead({ ...base, candidates: [candidate('a', 4), candidate('b', 2)] })).toMatchObject({ type: 'ASSIGNED', agentId: 'b', territoryId: null }));
  it('returns no-available-agent for a matched team without eligible candidates', () => expect(routeLead({ ...base, territories: [{ id: 't', organizationId: 'org', name: 'T', description: null, salesTeamId: 'team', salesTeamName: 'Sales', departmentId: 'dept', status: 'active', createdBy: 'u', updatedBy: 'u', createdAt: new Date(), updatedAt: new Date(), rules: [{ id: 'r', dimension: 'industry', value: 'SaaS' }] }], candidates: [candidate('a', 1, true, false)] })).toMatchObject({ type: 'UNROUTED', reason: 'NO_AVAILABLE_AGENT', territoryId: 't' }));
  it('returns no-territory-match when configured territories do not match', () => expect(routeLead({ ...base, territories: [{ id: 't', organizationId: 'org', name: 'T', description: null, salesTeamId: 'team', salesTeamName: 'Sales', departmentId: 'dept', status: 'active', createdBy: 'u', updatedBy: 'u', createdAt: new Date(), updatedAt: new Date(), rules: [{ id: 'r', dimension: 'industry', value: 'Healthcare' }] }] })).toMatchObject({ type: 'UNROUTED', reason: 'NO_TERRITORY_MATCH' }));
});
