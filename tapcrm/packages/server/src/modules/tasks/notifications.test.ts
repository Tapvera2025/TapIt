import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Facade from '../notifications/facade.js';

vi.mock('../notifications/facade.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Facade>()),
  notify: vi.fn().mockResolvedValue(undefined),
}));

import { notify } from '../notifications/facade.js';
import {
  changedTaskFields,
  notifyTaskAssigned,
  notifyTaskStatusChanged,
  notifyTaskUnassigned,
  notifyTaskUpdated,
} from './notifications.js';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CAROL = '33333333-3333-4333-8333-333333333333';
const CREATOR = '44444444-4444-4444-8444-444444444444';

const tx = {} as never;
const ctx = { organizationId: 'org', principal: { id: ACTOR } } as never;
const call = (): Record<string, unknown> => vi.mocked(notify).mock.calls[0]![2] as never;

const assignee = (id: string) => ({ id, fullName: id, assignedAt: new Date() });
const baseTask = {
  id: 'task-1',
  title: 'Prepare Q4 report',
  status: 'pending' as const,
  createdBy: CREATOR,
  assignees: [assignee(BOB), assignee(CAROL)],
};

beforeEach(() => vi.mocked(notify).mockClear());

describe('notifyTaskAssigned', () => {
  it('tells the new assignees, operationally, with the due date', async () => {
    await notifyTaskAssigned(
      tx,
      ctx,
      { id: 'task-1', title: 'Prepare Q4 report', priority: 'high', dueDate: new Date('2026-10-01T10:00:00Z') },
      [BOB, CAROL],
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(call()).toMatchObject({
      type: 'task.assigned',
      priority: 'operational',
      audience: { users: [BOB, CAROL] },
      body: 'Prepare Q4 report — due 2026-10-01',
      link: '/company/tasks',
      metadata: { taskId: 'task-1', priority: 'high' },
    });
  });

  it('never notifies the actor about their own action, and skips when nobody is left', async () => {
    await notifyTaskAssigned(tx, ctx, { id: 't', title: 'x', priority: 'low' }, [ACTOR]);
    expect(notify).not.toHaveBeenCalled();

    await notifyTaskAssigned(tx, ctx, { id: 't', title: 'x', priority: 'low' }, [ACTOR, BOB, BOB]);
    expect(call()['audience']).toEqual({ users: [BOB] });
  });

  it('does nothing for an empty list', async () => {
    await notifyTaskAssigned(tx, ctx, { id: 't', title: 'x', priority: 'low' }, []);
    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps a very long title within the notification body limit', async () => {
    await notifyTaskAssigned(tx, ctx, { id: 't', title: 'x'.repeat(255), priority: 'low', dueDate: new Date('2026-10-01') }, [BOB]);
    expect((call()['body'] as string).length).toBeLessThanOrEqual(500);
  });
});

describe('notifyTaskUnassigned', () => {
  it('is informational', async () => {
    await notifyTaskUnassigned(tx, ctx, { id: 'task-1', title: 'T' }, [BOB]);
    expect(call()).toMatchObject({ type: 'task.unassigned', audience: { users: [BOB] } });
    expect(call()['priority']).toBeUndefined(); // informational is the default
  });
});

describe('changedTaskFields', () => {
  const existing = {
    title: 'Old',
    description: 'desc',
    priority: 'low' as const,
    dueDate: new Date('2026-10-01T00:00:00Z'),
    projectId: null,
  };

  it('reports only what really changed', () => {
    expect(changedTaskFields(existing, { title: 'New', priority: 'low' })).toEqual(['title']);
    expect(changedTaskFields(existing, { priority: 'urgent', dueDate: new Date('2026-10-02T00:00:00Z') })).toEqual([
      'priority',
      'due date',
    ]);
  });

  it('treats a re-saved form (same values) as no change', () => {
    expect(
      changedTaskFields(existing, {
        title: 'Old',
        description: 'desc',
        priority: 'low',
        dueDate: new Date('2026-10-01T00:00:00Z'),
        projectId: null,
      }),
    ).toEqual([]);
    expect(changedTaskFields(existing, {})).toEqual([]);
  });

  it('detects clearing a value', () => {
    expect(changedTaskFields(existing, { dueDate: null, description: null })).toEqual(['description', 'due date']);
  });
});

describe('notifyTaskUpdated', () => {
  it('tells current assignees which fields changed, not the actor', async () => {
    await notifyTaskUpdated(tx, ctx, { ...baseTask, assignees: [assignee(BOB), assignee(ACTOR)] }, ['priority', 'due date']);
    expect(call()).toMatchObject({
      type: 'task.updated',
      audience: { users: [BOB] },
      body: 'Prepare Q4 report — changed: priority, due date',
    });
  });

  it('does nothing when nothing changed, or there are no assignees', async () => {
    await notifyTaskUpdated(tx, ctx, baseTask, []);
    await notifyTaskUpdated(tx, ctx, { ...baseTask, assignees: [] }, ['title']);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('notifyTaskStatusChanged', () => {
  it('tells the creator and the assignees, but not the actor', async () => {
    await notifyTaskStatusChanged(tx, ctx, { ...baseTask, assignees: [assignee(BOB), assignee(ACTOR)] }, 'in_progress');
    expect(call()).toMatchObject({
      type: 'task.status_changed',
      title: 'Task status changed',
      audience: { users: [CREATOR, BOB] },
      body: 'Prepare Q4 report — Pending → In progress',
      metadata: { taskId: 'task-1', from: 'pending', to: 'in_progress' },
    });
  });

  it('uses its own type and title for completed and cancelled', async () => {
    await notifyTaskStatusChanged(tx, ctx, baseTask, 'completed');
    expect(call()).toMatchObject({ type: 'task.completed', title: 'Task completed' });

    vi.mocked(notify).mockClear();
    await notifyTaskStatusChanged(tx, ctx, baseTask, 'cancelled');
    expect(call()).toMatchObject({ type: 'task.status_changed', title: 'Task cancelled' });
  });

  it('does nothing when the status did not move', async () => {
    await notifyTaskStatusChanged(tx, ctx, baseTask, 'pending');
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not notify a creator who is also the actor and has no assignees', async () => {
    await notifyTaskStatusChanged(tx, { organizationId: 'org', principal: { id: CREATOR } } as never, { ...baseTask, assignees: [] }, 'completed');
    expect(notify).not.toHaveBeenCalled();
  });
});
