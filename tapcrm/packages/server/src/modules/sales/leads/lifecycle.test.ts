import { describe, expect, it, vi } from 'vitest';
import { closeLeadAsLostInTransaction, isTerminalLeadStatus } from './lifecycle.js';

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
