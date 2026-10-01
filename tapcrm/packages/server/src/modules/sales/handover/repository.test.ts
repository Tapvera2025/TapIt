import { describe, expect, it, vi } from 'vitest';
import { acceptHandover, claimQueuedHandover, declineHandover, loadSelectableHandoverTargetTx, recordHandoverDisposition } from './repository.js';

describe('team queue repository guards', () => {
  it('allows one conditional claim and makes a second claim a no-op', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ id: 'handover-a' }]).mockResolvedValueOnce([]);
    const tx = { query } as never;

    expect(await claimQueuedHandover(tx, 'org-a', 'handover-a', 'receiver-a')).toBe(true);
    expect(await claimQueuedHandover(tx, 'org-a', 'handover-a', 'receiver-b')).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not treat an unavailable target as claimable', async () => {
    const tx = { query: vi.fn().mockResolvedValue([]) } as never;
    expect(await loadSelectableHandoverTargetTx(tx, 'org-a', 'inactive-or-not-available')).toBeNull();
  });

  it('makes final disposition conditional and prevents a second finalization', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ id: 'handover-a' }]).mockResolvedValueOnce([]);
    const tx = { query } as never;

    expect(await recordHandoverDisposition(tx, 'org-a', 'handover-a', 'callback', null, {})).toBe(true);
    expect(await recordHandoverDisposition(tx, 'org-a', 'handover-a', 'accepted', null, {})).toBe(false);
  });

  it('makes direct acceptance conditional on the pending state', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ id: 'handover-a' }]).mockResolvedValueOnce([]);
    const tx = { query } as never;

    expect(await acceptHandover(tx, 'org-a', 'handover-a')).toBe(true);
    expect(await acceptHandover(tx, 'org-a', 'handover-a')).toBe(false);
  });

  it('makes decline conditional on the pending state', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ id: 'handover-a' }]).mockResolvedValueOnce([]);
    const tx = { query } as never;

    expect(await declineHandover(tx, 'org-a', 'handover-a', 'not available')).toBe(true);
    expect(await declineHandover(tx, 'org-a', 'handover-a', 'duplicate attempt')).toBe(false);
  });
});
