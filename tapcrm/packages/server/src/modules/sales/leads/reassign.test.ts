import { describe, expect, it } from 'vitest';
import { reassignBodySchema } from './reassign.js';

describe('reassignBodySchema', () => {
  it('requires newOwnerId to be a UUID and reason to be at least 5 characters', () => {
    const bad = reassignBodySchema.safeParse({ newOwnerId: 'not-a-uuid', reason: '???' });
    expect(bad.success).toBe(false);
  });

  it('defaults transferPendingCallbacks + transferScheduledActivities to true and transferSourcingCredit to false', () => {
    const parsed = reassignBodySchema.parse({
      newOwnerId: '11111111-1111-7111-8111-111111111111',
      reason: 'rebalancing load across the pool',
    });
    expect(parsed).toMatchObject({
      transferPendingCallbacks: true,
      transferScheduledActivities: true,
      transferSourcingCredit: false,
    });
  });
});
