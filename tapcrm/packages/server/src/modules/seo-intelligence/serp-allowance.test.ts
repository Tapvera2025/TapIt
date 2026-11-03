import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
const mocks = vi.hoisted(() => ({ one: vi.fn(), maybeOne: vi.fn(), transaction: vi.fn() }));
vi.mock('../../platform/dal/db.js', () => ({ db: { transaction: mocks.transaction } }));
import { reserveSerpSearch } from './serp-allowance.js';
const ctx = { organizationId: 'org-a' } as RequestContext;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (_ctx: RequestContext, callback: (tx: Tx) => Promise<unknown>) => callback({ one: mocks.one, maybeOne: mocks.maybeOne } as unknown as Tx));
});
describe('monthly SERP allowance', () => {
  it('blocks the 101st reservation at a 100-search allowance', async () => {
    mocks.maybeOne.mockResolvedValueOnce({ monthlySearchLimit: 100 });
    mocks.one.mockResolvedValueOnce({ count: 100 });
    await expect(reserveSerpSearch(ctx, 'site-a', 'keyword-a')).rejects.toMatchObject({ code: 'SEO_SERP_LIMIT' });
    expect(mocks.maybeOne).toHaveBeenCalledTimes(1);
  });
  it('does not reserve twice for the same keyword and day', async () => {
    mocks.maybeOne.mockResolvedValueOnce({ monthlySearchLimit: 100 }).mockResolvedValueOnce(null);
    mocks.one.mockResolvedValueOnce({ count: 1 });
    await expect(reserveSerpSearch(ctx, 'site-a', 'keyword-a')).rejects.toMatchObject({ code: 'SEO_SERP_ALREADY_CHECKED' });
  });
  it('allows a reservation below the cap and defaults missing settings to disabled', async () => {
    mocks.maybeOne.mockResolvedValueOnce({ monthlySearchLimit: 100 }).mockResolvedValueOnce({ id: 'request-a' });
    mocks.one.mockResolvedValueOnce({ count: 99 });
    await expect(reserveSerpSearch(ctx, 'site-a', 'keyword-a')).resolves.toBeUndefined();
    mocks.maybeOne.mockResolvedValueOnce(null);
    await expect(reserveSerpSearch(ctx, 'site-b', 'keyword-b')).rejects.toMatchObject({ code: 'SEO_SERP_LIMIT' });
  });
});
