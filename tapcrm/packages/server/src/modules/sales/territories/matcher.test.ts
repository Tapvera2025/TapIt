import { describe, expect, it } from 'vitest';
import { isInboundLead, matchTerritories } from './matcher.js';

const territory = (id: string, rules: Array<{ dimension: 'geography' | 'industry' | 'product' | 'lead_source'; value: string }>) => ({ id, organizationId: 'org', name: id, description: null, salesTeamId: 'team', salesTeamName: 'Sales', departmentId: 'dept', status: 'active' as const, createdBy: 'u', updatedBy: 'u', createdAt: new Date(), updatedAt: new Date(), rules: rules.map((rule, index) => ({ ...rule, id: `${id}-${index}` })) });

describe('territory matcher', () => {
  it('routes inbound sources and skips creator-owned outbound leads', () => {
    expect(isInboundLead({ source: 'website' })).toBe(true);
    expect(isInboundLead({ source: 'cold_call', createdByUserId: 'agent' })).toBe(false);
    expect(isInboundLead({ source: 'linkedin', createdByUserId: 'agent' })).toBe(false);
  });

  it('requires all rules and prefers specificity with stable ties', () => {
    const broad = territory('broad', [{ dimension: 'industry', value: 'SaaS' }]);
    const specific = territory('specific', [{ dimension: 'geography', value: 'India' }, { dimension: 'industry', value: 'SaaS' }]);
    const lead = { source: 'website', industry: 'SaaS', geography: 'India' };
    expect(matchTerritories([broad, specific], lead)?.id).toBe('specific');
    expect(matchTerritories([territory('z', [{ dimension: 'industry', value: 'Retail' }])], lead)).toBeNull();
    expect(matchTerritories([territory('b', [{ dimension: 'industry', value: 'SaaS' }]), territory('a', [{ dimension: 'industry', value: 'SaaS' }])], lead)?.id).toBe('a');
  });
});
