import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authorize,
  configureAuthz,
  registerProtectedConstraints,
  __resetConstraints,
  __resetResourcePolicies,
} from '@tapcrm/authz';
import { createRequestContext } from '../../platform/dal/context.js';

const mocks = vi.hoisted(() => ({ maybeOne: vi.fn() }));
vi.mock('../../platform/dal/db.js', () => ({ db: mocks }));
import { loadSiteResource, registerSeoPolicies } from './policy.js';

const organizationId = '00000000-0000-4000-8000-000000000001';
const siteId = '00000000-0000-4000-8000-000000000002';
const ctx = createRequestContext({
  organizationId,
  requestId: 'seo-trend-policy-test',
  principal: {
    id: 'employee-1', organizationId, accountType: 'employee', sessionVersion: 1,
    departmentId: 'department-1', teamId: null, positionId: 'position-1',
    reportsTo: null, organizationalLevel: 10,
  },
});

describe('SEO trend site authorization', () => {
  beforeEach(() => {
    mocks.maybeOne.mockReset();
    ctx.memo.clear();
    __resetResourcePolicies();
    __resetConstraints();
    registerProtectedConstraints();
    registerSeoPolicies();
    configureAuthz({
      scope: {
        subordinateIds: async () => new Set<string>(),
        teamIds: async () => new Set<string>(),
        poolIds: async () => new Set<string>(),
        poolMemberIds: async () => new Set<string>(),
        teamMemberIds: async () => new Set<string>(),
        departmentMemberIds: async () => new Set<string>(),
        departmentId: async () => 'department-1',
      },
      policies: {
        resolveSet: async () => ({
          policies: {
            'seo:read-findings-trend': {
              action: 'seo:read-findings-trend', allowed: true,
              scope: 'department', source: 'position',
            },
          },
          cacheDeadline: new Date(Date.now() + 60_000),
          resolvedAt: new Date(),
        }),
      },
      audit: {
        sensitiveUse: () => undefined,
        superAdminBypass: () => undefined,
        segregationBlocked: () => undefined,
        defect: () => undefined,
      },
      now: () => new Date(),
    });
  });

  it('authorizes an employee using the camelCase organization returned by the DAL', async () => {
    mocks.maybeOne.mockResolvedValue({ id: siteId, organizationId });
    const resource = await loadSiteResource(ctx, siteId);
    expect(resource).toEqual({ type: 'seo_site', id: siteId, organizationId });
    await expect(authorize(ctx, 'seo:read-findings-trend', resource!)).resolves.toBeUndefined();
    const query = mocks.maybeOne.mock.calls[0]?.[1] as { parameters: unknown[] };
    expect(query.parameters).toEqual([organizationId, siteId]);
  });

  it('refuses a site belonging to another organization', async () => {
    mocks.maybeOne.mockResolvedValue({ id: siteId, organizationId: 'other-organization' });
    const resource = await loadSiteResource(ctx, siteId);
    await expect(authorize(ctx, 'seo:read-findings-trend', resource!)).rejects.toThrow();
  });

  it('returns no resource for a missing site', async () => {
    mocks.maybeOne.mockResolvedValue(null);
    await expect(loadSiteResource(ctx, siteId)).resolves.toBeNull();
  });

  it('rejects malformed site IDs before querying the database', async () => {
    await expect(loadSiteResource(ctx, 'not-a-uuid')).resolves.toBeNull();
    expect(mocks.maybeOne).not.toHaveBeenCalled();
  });
});
