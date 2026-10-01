import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Facade from '../notifications/facade.js';

vi.mock('../notifications/facade.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Facade>()),
  notify: vi.fn().mockResolvedValue(undefined),
  describePlacement: vi.fn().mockResolvedValue('Senior Developer, Development (Backend), reporting to Tara Manager'),
}));

import { notify } from '../notifications/facade.js';
import { notifyPlacementChanged } from './notifications.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const RAVI = '22222222-2222-4222-8222-222222222222';
const tx = {} as never;
const ctx = { organizationId: 'org', principal: { id: OWNER } } as never;
const place = { departmentId: 'd1', positionId: 'p1', teamId: null, reportsTo: null };

beforeEach(() => vi.mocked(notify).mockClear());

describe('placement notifications', () => {
  it('tells the employee where they now sit', async () => {
    await notifyPlacementChanged(tx, ctx, RAVI, place, { ...place, positionId: 'p2' });
    expect(vi.mocked(notify).mock.calls[0]![2]).toMatchObject({
      type: 'employee.placement_changed',
      audience: { users: [RAVI] },
      title: 'Your position was changed',
      body: 'You are now Senior Developer, Development (Backend), reporting to Tara Manager.',
    });
  });

  it('says nothing when nothing changed', async () => {
    await notifyPlacementChanged(tx, ctx, RAVI, place, { ...place });
    expect(notify).not.toHaveBeenCalled();
  });
});
