import { describe, expect, it } from 'vitest';
import type { RequestContext } from '../../../platform/dal/context.js';
import type { Tx } from '../../../platform/dal/db.js';
import { assignOne, UnimplementedRoutingStrategyError } from './direct-router.js';

const stubCtx = {} as RequestContext;
const stubTx = {
  query: async () => [],
  one: async () => ({}),
  maybeOne: async () => null,
} as unknown as Tx;

describe('assignOne', () => {
  it('throws UnimplementedRoutingStrategyError when round-robin is requested', async () => {
    await expect(() =>
      assignOne(
        stubCtx,
        stubTx,
        { id: 'lead', organizationId: 'org', salesPoolId: 'pool', salesTeamId: 'team' },
        { strategy: 'round_robin' },
      ),
    ).rejects.toBeInstanceOf(UnimplementedRoutingStrategyError);
  });

  it('returns null when the lead has no sales_pool_id', async () => {
    const result = await assignOne(stubCtx, stubTx, {
      id: 'lead',
      organizationId: 'org',
      salesPoolId: null,
      salesTeamId: null,
    });
    expect(result).toBeNull();
  });
});
