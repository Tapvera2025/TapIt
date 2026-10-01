import { describe, expect, it } from 'vitest';
import { createHandoverSchema, declineHandoverSchema, handoverDispositionSchema } from './validators.js';

describe('lead handover validators', () => {
  it('supports a team queue without a direct receiver', () => {
    expect(createHandoverSchema.parse({ leadId: '00000000-0000-0000-0000-000000000001', handoverMode: 'team_queue' }).toUserId).toBeUndefined();
    expect(() => createHandoverSchema.parse({ leadId: '00000000-0000-0000-0000-000000000001' })).toThrow();
    expect(() => createHandoverSchema.parse({ leadId: '00000000-0000-0000-0000-000000000001', handoverMode: 'team_queue', toUserId: '00000000-0000-0000-0000-000000000002' })).toThrow();
  });

  it('requires a structured decline reason', () => {
    expect(() => declineHandoverSchema.parse({ reason: '' })).toThrow();
    expect(declineHandoverSchema.parse({ reason: 'Customer requested another representative' }).reason).toContain('Customer');
  });

  it('requires a structured loss reason for rejected disposition', () => {
    expect(() => handoverDispositionSchema.parse({ disposition: 'rejected' })).toThrow();
    expect(handoverDispositionSchema.parse({ disposition: 'callback', scheduledAt: new Date(Date.now() + 3600000) }).disposition).toBe('callback');
    expect(handoverDispositionSchema.parse({ disposition: 'rejected', reason: 'Not qualified', lossReason: 'unqualified' }).lossReason).toBe('unqualified');
  });
});
