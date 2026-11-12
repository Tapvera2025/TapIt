import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../platform/dal/context.js';
const mocks = vi.hoisted(() => ({ query: vi.fn(), one: vi.fn() }));
vi.mock('../../platform/dal/db.js', () => ({ db: mocks }));
import { listFindings } from './repository.js';

describe('SEO findings query', () => {
  it('binds tenant, site and filters instead of interpolating UUIDs into SQL', async () => {
    mocks.query.mockResolvedValue([]);
    mocks.one.mockResolvedValue({ count: '0' });
    const organizationId = '00000000-0000-4000-8000-000000000001';
    const siteId = '00000000-0000-4000-8000-000000000002';
    const result = await listFindings({ organizationId } as RequestContext, siteId, { status: 'open', severity: 'high' });
    expect(result).toEqual({ rows: [], total: 0 });
    const query = mocks.query.mock.calls[0]?.[1] as { sql: string; parameters: unknown[] };
    expect(query.sql).not.toContain(organizationId);
    expect(query.sql).not.toContain(siteId);
    expect(query.parameters).toEqual(expect.arrayContaining([organizationId, siteId, 'open', 'high']));
    expect(query.sql).toContain(' AND ');
  });
});
