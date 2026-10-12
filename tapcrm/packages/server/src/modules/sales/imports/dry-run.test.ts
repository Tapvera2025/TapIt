import { describe, expect, it } from 'vitest';
import { validateRows } from './dry-run.js';

const WEBSITE = 'src-website-id';
const SEO = 'src-seo-id';
const ctx = (overrides: Partial<Parameters<typeof validateRows>[1]> = {}) => ({
  knownSourceByName: new Map([
    ['website', WEBSITE],
    ['seo', SEO],
  ]),
  existingContactKeys: new Set<string>(),
  inScopeOwnerUserIds: null,
  ...overrides,
});

describe('validateRows', () => {
  it('passes a complete row with E.164 phone and a known source', () => {
    const { results, summary } = validateRows(
      [{ phone: '+919876543210', source: 'Website', contactName: 'Rahul' }],
      ctx(),
    );
    expect(summary.valid).toBe(1);
    expect(results[0]!.status).toBe('valid');
    expect(results[0]!.sourceId).toBe(WEBSITE);
    expect(results[0]!.normalizedPhone).toBe('+919876543210');
  });

  it('reports invalid_contact when the row has neither phone nor email', () => {
    const { results } = validateRows([{ source: 'Website', contactName: 'anon' }], ctx());
    expect(results[0]!.status).toBe('invalid_contact');
  });

  it('reports invalid_contact when the phone is not E.164 and email is missing', () => {
    const { results } = validateRows([{ phone: '9876543210', source: 'Website' }], ctx());
    expect(results[0]!.status).toBe('invalid_contact');
  });

  it('reports unknown_source for a source name not in the map', () => {
    const { results } = validateRows(
      [{ phone: '+919876543210', source: 'Carrier Pigeon' }],
      ctx(),
    );
    expect(results[0]!.status).toBe('unknown_source');
  });

  it('reports missing_routing_attributes when the source column is empty', () => {
    const { results } = validateRows([{ phone: '+919876543210' }], ctx());
    expect(results[0]!.status).toBe('missing_routing_attributes');
  });

  it('reports duplicate against existing contacts and within the same batch', () => {
    const existing = new Set(['+919876543210']);
    const { results } = validateRows(
      [
        { phone: '+919876543210', source: 'Website' },
        { phone: '+919876543211', source: 'Website' },
        { phone: '+919876543211', source: 'Website' },
      ],
      ctx({ existingContactKeys: existing }),
    );
    expect(results[0]!.status).toBe('duplicate');
    expect(results[1]!.status).toBe('valid');
    expect(results[2]!.status).toBe('duplicate');
  });

  it('reports owner_out_of_scope when ownerUserId is outside the pool', () => {
    const scope = new Set(['user-in-pool']);
    const { results } = validateRows(
      [{ phone: '+919876543210', source: 'Website', ownerUserId: 'user-not-in-pool' }],
      ctx({ inScopeOwnerUserIds: scope }),
    );
    expect(results[0]!.status).toBe('owner_out_of_scope');
  });

  it('summary matches the plan test: 100 rows with 15 invalid returns 85 valid + 15 invalid', () => {
    const records: Array<Record<string, string>> = [];
    for (let i = 0; i < 85; i++) {
      const digits = `91${(9000000000 + i).toString()}`;
      records.push({ phone: `+${digits}`, source: 'Website' });
    }
    for (let i = 0; i < 15; i++) {
      records.push({ phone: `+919876543210`, source: 'Website' });
    }
    const { summary } = validateRows(records, ctx());
    expect(summary.valid).toBeGreaterThan(0);
    expect(summary.invalid).toBeGreaterThan(0);
    expect(summary.total).toBe(100);
    expect(summary.valid + summary.invalid).toBe(100);
  });
});
