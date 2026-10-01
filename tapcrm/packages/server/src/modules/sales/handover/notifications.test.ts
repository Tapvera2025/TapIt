import { describe, expect, it, vi } from 'vitest';
import { notify } from '../../notifications/facade.js';
import { notifyHandoverQueued } from './notifications.js';

vi.mock('../../notifications/facade.js', () => ({ notify: vi.fn() }));

describe('team queue notifications', () => {
  it('notifies every eligible target without consulting availability state', async () => {
    await notifyHandoverQueued({} as never, { principal: { id: 'originator' } } as never, 'lead-a', ['supervisor-a', 'team-lead-a', 'originator']);

    expect(vi.mocked(notify)).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      audience: { users: ['supervisor-a', 'team-lead-a'] },
      metadata: expect.objectContaining({ handoverMode: 'team_queue' }),
    }));
  });
});
