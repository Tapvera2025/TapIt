import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import type * as SearchConsole from '../../platform/integrations/google/search-console.js';

const mocks = vi.hoisted(() => ({ listSites: vi.fn(), query: vi.fn(), upsert: vi.fn(), transaction: vi.fn() }));
vi.mock('../../platform/integrations/google/search-console.js', async (original) => ({
  ...await original<typeof SearchConsole>(),
  listSites: mocks.listSites, querySearchAnalytics: mocks.query,
}));
vi.mock('../../platform/dal/db.js', () => ({ db: { transaction: mocks.transaction } }));
vi.mock('./repository.js', () => ({ upsertGscMetrics: mocks.upsert }));
import { importGscPerformance, resolveGscProperty } from './gsc-sync.js';
import { SearchConsoleConfigurationError } from '../../platform/integrations/google/search-console.js';

const owner = (siteUrl: string) => ({ siteUrl, permissionLevel: 'siteOwner' });
const ctx = { organizationId: 'test-org' } as RequestContext;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (_ctx: RequestContext, callback: (tx: Tx) => Promise<unknown>) => callback({} as Tx));
});

describe('GSC performance import', () => {
  it('uses the exact prefix including its trailing slash, or a matching domain property', () => {
    expect(resolveGscProperty('https://tapvera.io', [owner('sc-domain:tapvera.io'), owner('https://tapvera.io/')])).toBe('https://tapvera.io/');
    expect(resolveGscProperty('https://blog.tapvera.io/', [owner('sc-domain:tapvera.io')])).toBe('sc-domain:tapvera.io');
    expect(() => resolveGscProperty('https://eviltapvera.io', [owner('sc-domain:tapvera.io')])).toThrow(SearchConsoleConfigurationError);
    // www. and the bare host are one website; an exact prefix still wins.
    expect(resolveGscProperty('https://tapvera.io', [owner('https://www.tapvera.io/')])).toBe('https://www.tapvera.io/');
    expect(resolveGscProperty('https://tapvera.io', [owner('https://www.tapvera.io/'), owner('https://tapvera.io/')])).toBe('https://tapvera.io/');
    expect(() => resolveGscProperty('https://tapvera.io', [owner('http://www.tapvera.io/')])).toThrow(SearchConsoleConfigurationError);
  });

  it('requests daily dimensions and stores the date separately from the device', async () => {
    mocks.listSites.mockResolvedValue([owner('https://tapvera.io/')]);
    mocks.query.mockResolvedValue([{ keys: ['2026-10-09', 'seo agency', 'https://tapvera.io/', 'ind', 'MOBILE'], clicks: 2, impressions: 20, ctr: 0.1, position: 3.25 }]);
    const result = await importGscPerformance(ctx, 'site-1', 'https://tapvera.io', '2026-10-01', '2026-10-20');
    expect(mocks.query).toHaveBeenCalledWith('https://tapvera.io/', expect.objectContaining({ dimensions: ['date', 'query', 'page', 'country', 'device'], startRow: 0 }));
    expect(mocks.upsert.mock.calls[0]?.[1]).toEqual([expect.objectContaining({ siteId: 'site-1', organizationId: 'test-org', date: '2026-10-09', device: 'MOBILE', query: 'seo agency', avgPosition: 3.25, dataComplete: false })]);
    expect(result).toMatchObject({ state: 'ok', synced: 1, propertyUrl: 'https://tapvera.io/' });
  });

  it('preserves connection errors and never writes invented empty metrics', async () => {
    mocks.listSites.mockRejectedValue(new SearchConsoleConfigurationError('Property access denied'));
    await expect(importGscPerformance(ctx, 'site-1', 'https://tapvera.io', '2026-10-01', '2026-10-20')).rejects.toThrow('Property access denied');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid dimension layout before changing stored observations', async () => {
    mocks.listSites.mockResolvedValue([owner('https://tapvera.io/')]);
    mocks.query.mockResolvedValue([{ keys: ['MOBILE', 'q', 'https://tapvera.io/', 'ind', 'MOBILE'] }]);
    await expect(importGscPerformance(ctx, 'site-1', 'https://tapvera.io', '2026-10-01', '2026-10-20')).rejects.toThrow('dimension layout');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
