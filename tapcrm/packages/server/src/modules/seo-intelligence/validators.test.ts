import { describe, expect, it } from 'vitest';
import {
  createSiteSchema,
  updateSiteSchema,
  findingQuerySchema,
  findingsTrendQuerySchema,
  updateFindingSchema,
  gscSyncSchema,
  gscMetricsQuerySchema,
  updateFixProposalSchema,
  updateRuleSchema,
} from './validators.js';

const CLIENT_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';
const SITE_ID = '00000000-0000-0000-0000-000000000003';

describe('createSiteSchema', () => {
  const base = { clientId: CLIENT_ID, displayUrl: 'https://example.com' };

  it('accepts a standalone URL without a client', () => {
    expect(createSiteSchema.parse({ displayUrl: base.displayUrl }).clientId).toBeNull();
    expect(createSiteSchema.parse({ ...base, clientId: null }).clientId).toBeNull();
  });

  it('accepts a minimal valid site', () => {
    const result = createSiteSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timezone).toBe('UTC');
      expect(result.data.locale).toBe('en');
      expect(result.data.businessIntents).toEqual([]);
      expect(result.data.stackNotes).toBeNull();
    }
  });

  it('accepts http URLs', () => {
    expect(createSiteSchema.safeParse({ ...base, displayUrl: 'http://example.com' }).success).toBe(true);
  });

  it('rejects non-http(s) protocols', () => {
    expect(createSiteSchema.safeParse({ ...base, displayUrl: 'ftp://example.com' }).success).toBe(false);
  });

  it('rejects a non-UUID clientId', () => {
    expect(createSiteSchema.safeParse({ ...base, clientId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects extraneous keys (strict)', () => {
    expect(createSiteSchema.safeParse({ ...base, extra: 'x' }).success).toBe(false);
  });

  it('rejects more than 20 business intents', () => {
    const businessIntents = Array.from({ length: 21 }, (_, i) => `intent-${i}`);
    expect(createSiteSchema.safeParse({ ...base, businessIntents }).success).toBe(false);
  });
});

describe('updateSiteSchema', () => {
  it('accepts a partial update', () => {
    expect(updateSiteSchema.safeParse({ timezone: 'Asia/Kolkata' }).success).toBe(true);
  });

  it('accepts nullable stackNotes', () => {
    expect(updateSiteSchema.safeParse({ stackNotes: null }).success).toBe(true);
  });

  it('rejects unknown fields', () => {
    expect(updateSiteSchema.safeParse({ displayUrl: 'https://x.com' }).success).toBe(false);
  });
});

describe('findingQuerySchema', () => {
  it('coerces limit and offset strings', () => {
    const result = findingQuerySchema.safeParse({ siteId: SITE_ID, limit: '25', offset: '10' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
      expect(result.data.offset).toBe(10);
    }
  });

  it('rejects a limit above 200', () => {
    expect(findingQuerySchema.safeParse({ siteId: SITE_ID, limit: 500 }).success).toBe(false);
  });

  it('rejects an invalid severity', () => {
    expect(findingQuerySchema.safeParse({ siteId: SITE_ID, severity: 'blocker' }).success).toBe(false);
  });

  it('accepts valid severity and status', () => {
    expect(findingQuerySchema.safeParse({ siteId: SITE_ID, severity: 'critical', status: 'open' }).success).toBe(true);
  });
});

describe('findingsTrendQuerySchema', () => {
  it('defaults to 30 days and accepts bounded whole-day ranges', () => {
    expect(findingsTrendQuerySchema.parse({})).toEqual({ days: 30 });
    expect(findingsTrendQuerySchema.parse({ days: '1' })).toEqual({ days: 1 });
    expect(findingsTrendQuerySchema.parse({ days: '180' })).toEqual({ days: 180 });
  });

  it.each(['0', '181', '1.5', '30garbage', 'NaN', '', ['30'], ['30', '60'], true])('rejects invalid day ranges: %s', (days) => {
    expect(findingsTrendQuerySchema.safeParse({ days }).success).toBe(false);
  });
});

describe('updateFindingSchema', () => {
  it('accepts dismissal with assignee cleared', () => {
    expect(updateFindingSchema.safeParse({ status: 'dismissed', assignedTo: null }).success).toBe(true);
  });

  it('accepts resolve with no assignee change', () => {
    expect(updateFindingSchema.safeParse({ status: 'resolved' }).success).toBe(true);
  });

  it('rejects assigning a non-UUID', () => {
    expect(updateFindingSchema.safeParse({ assignedTo: 'bob' }).success).toBe(false);
  });

  it('accepts assigning a valid UUID', () => {
    expect(updateFindingSchema.safeParse({ assignedTo: USER_ID }).success).toBe(true);
  });

  it('rejects statuses that are not dismiss/resolve', () => {
    expect(updateFindingSchema.safeParse({ status: 'open' }).success).toBe(false);
  });
});

describe('gscSyncSchema', () => {
  const base = {
    siteId: SITE_ID,
    propertyUrl: 'https://example.com',
    startDate: '2026-01-01',
    endDate: '2026-01-31',
  };

  it('accepts a valid sync payload with default search type', () => {
    const result = gscSyncSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.searchType).toBe('web');
  });

  it('rejects date formats other than YYYY-MM-DD', () => {
    expect(gscSyncSchema.safeParse({ ...base, startDate: '01/01/2026' }).success).toBe(false);
  });

  it('rejects unknown searchType', () => {
    expect(gscSyncSchema.safeParse({ ...base, searchType: 'podcast' }).success).toBe(false);
  });
});

describe('gscMetricsQuerySchema', () => {
  it('coerces string limit', () => {
    const result = gscMetricsQuerySchema.safeParse({
      siteId: SITE_ID,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      limit: '250',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(250);
  });

  it('rejects a limit above 5000', () => {
    expect(gscMetricsQuerySchema.safeParse({
      siteId: SITE_ID,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      limit: 10000,
    }).success).toBe(false);
  });
});

describe('updateFixProposalSchema', () => {
  it('accepts executed', () => {
    expect(updateFixProposalSchema.safeParse({ status: 'executed' }).success).toBe(true);
  });

  it('accepts rejected', () => {
    expect(updateFixProposalSchema.safeParse({ status: 'rejected' }).success).toBe(true);
  });

  it('rejects statuses outside the terminal set', () => {
    expect(updateFixProposalSchema.safeParse({ status: 'applied' }).success).toBe(false);
  });
});

describe('updateRuleSchema', () => {
  it('accepts a boolean active toggle', () => {
    expect(updateRuleSchema.safeParse({ active: true }).success).toBe(true);
    expect(updateRuleSchema.safeParse({ active: false }).success).toBe(true);
  });

  it('rejects non-boolean values', () => {
    expect(updateRuleSchema.safeParse({ active: 'yes' }).success).toBe(false);
  });

  it('rejects extraneous fields (strict)', () => {
    expect(updateRuleSchema.safeParse({ active: true, extra: 1 }).success).toBe(false);
  });
});
