import { describe, expect, it } from 'vitest';
import { declineHandoverSchema, handoverDispositionSchema } from './validators.js';

describe('lead handover validators', () => {
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
