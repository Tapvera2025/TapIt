import { describe, expect, it, vi } from 'vitest';
import {
  closeLeadAsLostInTransaction,
  isTerminalLeadStatus,
  statusAfterCallback,
} from './lifecycle.js';
import { closeLeadLostSchema } from './validators.js';

describe('Lead lifecycle handover boundary', () => {
  it('identifies only converted and closed-lost Leads as terminal', () => {
    expect(isTerminalLeadStatus('converted')).toBe(true);
    expect(isTerminalLeadStatus('closed_lost')).toBe(true);
    expect(isTerminalLeadStatus('follow_up')).toBe(false);
  });

  it('closes an active Lead as lost through the existing owner-preserving lifecycle update', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 'lead-a' }]);
    expect(await closeLeadAsLostInTransaction({ query } as never, 'org-a', 'lead-a', 'unqualified')).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not report a closed Lead as newly closed', async () => {
    const query = vi.fn().mockResolvedValue([]);
    expect(await closeLeadAsLostInTransaction({ query } as never, 'org-a', 'lead-a', 'unqualified')).toBe(false);
  });
});

describe('Lead status after a callback ends', () => {
  it('leaves a lead contacted when the call got through', () => {
    for (const outcome of ['connected', 'not_interested']) {
      expect(statusAfterCallback({ status: 'completed', outcome })).toBe('contacted');
    }
  });

  it('leaves a lead in follow-up when nobody answered or the call needs another try', () => {
    for (const outcome of ['follow_up_required', 'not_reachable']) {
      expect(statusAfterCallback({ status: 'completed', outcome })).toBe('follow_up');
    }
    for (const status of ['not_reachable', 'missed', 'cancelled'] as const) {
      expect(statusAfterCallback({ status, outcome: null })).toBe('follow_up');
    }
  });
});

describe('Mark as lost request', () => {
  it('needs a note when the reason is "other"', () => {
    expect(closeLeadLostSchema.safeParse({ lossReason: 'other' }).success).toBe(false);
    const withNote = closeLeadLostSchema.safeParse({
      lossReason: 'other',
      note: 'Went quiet',
    });
    expect(withNote.success).toBe(true);
    expect(closeLeadLostSchema.safeParse({ lossReason: 'no_budget' }).success).toBe(true);
  });

  it('rejects reasons outside the list', () => {
    expect(closeLeadLostSchema.safeParse({ lossReason: 'bored' }).success).toBe(false);
  });
});
