import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@tapcrm/contracts';
import { createRequestContext, type RequestContext } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { dispatchOrganization } from '../notifications/dispatcher.js';
import { sql } from '../../platform/dal/sql.js';
import { installAuthz } from '../../platform/authz-adapter.js';
import { registerTasksPolicies } from './policy.js';
import {
  assignTask,
  createTask,
  getTask,
  listTasks,
  transitionTask,
  updateTask,
} from './service.js';
import { TaskNotFoundError, TaskValidationError } from './errors.js';
import { createTaskSchema, taskListQuerySchema } from './validators.js';

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';

describe.skipIf(!enabled)('Global Task Integration (PostgreSQL)', () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA1 = randomUUID();
  const userA2 = randomUUID();
  const userA3 = randomUUID();
  const userB1 = randomUUID();

  const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
    platformDb.query('migration', reason, fragment);

  function ctxFor(organizationId: string, userId: string): RequestContext {
    const principal: Principal = {
      id: userId,
      organizationId,
      accountType: 'employee',
      sessionVersion: 1,
      positionId: randomUUID(),
      departmentId: randomUUID(),
      teamId: null,
      reportsTo: null,
      organizationalLevel: 1,
    };
    return createRequestContext({
      organizationId,
      principal,
      requestId: `test-${userId}`,
    });
  }

  const ctxA1 = () => ctxFor(orgA, userA1);
  const _ctxA2 = () => ctxFor(orgA, userA2);
  const ctxB1 = () => ctxFor(orgB, userB1);

  const deptA = randomUUID();
  const deptB = randomUUID();
  const posA = randomUUID();
  const posB = randomUUID();

  beforeAll(async () => {
    installAuthz();
    registerTasksPolicies();

    // 1. Create orgA and orgB
    await asOwner(
      'create test organizations',
      sql`
        INSERT INTO organization (id, code, name) VALUES
        (${orgA}, ${`TA${orgA.slice(0, 6)}`}, 'Task Org A'),
        (${orgB}, ${`TB${orgB.slice(0, 6)}`}, 'Task Org B')
      `,
    );

    // 2. Enable tasks module
    await asOwner(
      'enable tasks module',
      sql`
        INSERT INTO organization_module (organization_id, module_id, status, enabled_at)
        SELECT o.id, m.id, 'enabled', now()
        FROM organization o
        CROSS JOIN module m
        WHERE o.id = ANY(${[orgA, orgB]}::uuid[]) AND m.key = 'tasks'
        ON CONFLICT (organization_id, module_id) DO NOTHING
      `,
    );

    // 3. Create departments and positions
    await asOwner(
      'create test departments',
      sql`
        INSERT INTO department (id, organization_id, code, name, kind) VALUES
        (${deptA}, ${orgA}, 'ENG', 'Engineering', 'delivery'),
        (${deptB}, ${orgB}, 'ENG', 'Engineering', 'delivery')
      `,
    );

    await asOwner(
      'create test positions',
      sql`
        INSERT INTO position (id, organization_id, department_id, code, name, organizational_level) VALUES
        (${posA}, ${orgA}, ${deptA}, 'DEV', 'Developer', 20),
        (${posB}, ${orgB}, ${deptB}, 'DEV', 'Developer', 20)
      `,
    );

    // 4. Create app users
    await asOwner(
      'create test users',
      sql`
        INSERT INTO app_user (id, organization_id, email, full_name, account_type, department_id, position_id, employee_id) VALUES
        (${userA1}, ${orgA}, ${`userA1-${orgA.slice(0, 4)}@example.com`}, 'User A1', 'employee', ${deptA}, ${posA}, 'TASK-A1'),
        (${userA2}, ${orgA}, ${`userA2-${orgA.slice(0, 4)}@example.com`}, 'User A2', 'employee', ${deptA}, ${posA}, 'TASK-A2'),
        (${userA3}, ${orgA}, ${`userA3-${orgA.slice(0, 4)}@example.com`}, 'User A3', 'employee', ${deptA}, ${posA}, 'TASK-A3'),
        (${userB1}, ${orgB}, ${`userB1-${orgB.slice(0, 4)}@example.com`}, 'User B1', 'employee', ${deptB}, ${posB}, 'TASK-B1')
      `,
    );
  });

  afterAll(async () => {
    await asOwner('delete test notification deliveries', sql`DELETE FROM notification_delivery WHERE organization_id = ANY(${[orgA, orgB]}::uuid[])`);
    await asOwner('delete test notifications', sql`DELETE FROM notification WHERE organization_id = ANY(${[orgA, orgB]}::uuid[])`);
    await asOwner('delete test notification outbox', sql`DELETE FROM notification_outbox WHERE organization_id = ANY(${[orgA, orgB]}::uuid[])`);
    await asOwner('delete test task assignees', sql`DELETE FROM task_assignee WHERE organization_id = ANY(${[orgA, orgB]}::uuid[])`);
    await asOwner('delete test tasks', sql`DELETE FROM task WHERE organization_id = ANY(${[orgA, orgB]}::uuid[])`);
    await asOwner('delete test audit entries', sql`DELETE FROM audit_outbox WHERE organization_id = ANY(${[orgA, orgB]}::uuid[])`);
    await asOwner('delete identity directory', sql`DELETE FROM identity_email_directory WHERE organization_id = ANY(${[orgA, orgB]}::uuid[])`);
    await asOwner('delete test users', sql`DELETE FROM app_user WHERE organization_id = ANY(${[orgA, orgB]}::uuid[])`);
    await asOwner('delete test positions', sql`DELETE FROM position WHERE organization_id = ANY(${[orgA, orgB]}::uuid[])`);
    await asOwner('delete test departments', sql`DELETE FROM department WHERE organization_id = ANY(${[orgA, orgB]}::uuid[])`);
    await asOwner('delete test module entitlements', sql`DELETE FROM organization_module WHERE organization_id = ANY(${[orgA, orgB]}::uuid[])`);
    await asOwner('delete test organizations', sql`DELETE FROM organization WHERE id = ANY(${[orgA, orgB]}::uuid[])`);
    await closePools();
  });

  it('creates a task with assignees and emits audit record', async () => {
    const ctx = ctxA1();
    const task = await createTask(ctx, createTaskSchema.parse({
      title: 'Database migration verification',
      description: 'Ensure all tables have RLS applied.',
      priority: 'high',
      assigneeIds: [userA2],
      dueDate: new Date(Date.now() + 86400000),
    }));

    expect(task.id).toBeDefined();
    expect(task.title).toBe('Database migration verification');
    expect(task.status).toBe('pending');
    expect(task.priority).toBe('high');
    expect(task.createdBy).toBe(userA1);
    expect(task.assignees).toHaveLength(1);
    expect(task.assignees[0]?.id).toBe(userA2);

    // Verify audit outbox
    const auditRows = await db.query<{ payload: { action: string; targetId: string } }>(
      ctx,
      sql`SELECT payload FROM audit_outbox WHERE organization_id = ${orgA} AND stream = 'activity'`,
    );
    expect(auditRows.some((r) => r.payload.action === 'task.created' && r.payload.targetId === task.id)).toBe(true);
  });

  it('retrieves a task by ID', async () => {
    const ctx = ctxA1();
    const created = await createTask(ctx, createTaskSchema.parse({
      title: 'Task for retrieval test',
      priority: 'low',
    }));

    const retrieved = await getTask(ctx, created.id);
    expect(retrieved.id).toBe(created.id);
    expect(retrieved.title).toBe('Task for retrieval test');
  });

  it('updates task properties and emits audit record', async () => {
    const ctx = ctxA1();
    const created = await createTask(ctx, createTaskSchema.parse({
      title: 'Initial Title',
      priority: 'low',
    }));

    const updated = await updateTask(ctx, created.id, {
      title: 'Updated Title',
      priority: 'urgent',
    });

    expect(updated.title).toBe('Updated Title');
    expect(updated.priority).toBe('urgent');

    const auditRows = await db.query<{ payload: { action: string } }>(
      ctx,
      sql`SELECT payload FROM audit_outbox WHERE organization_id = ${orgA} AND stream = 'activity'`,
    );
    expect(auditRows.some((r) => r.payload.action === 'task.updated')).toBe(true);
  });

  it('transitions status following the state machine', async () => {
    const ctx = ctxA1();
    const created = await createTask(ctx, createTaskSchema.parse({
      title: 'Status Transition Test',
      priority: 'medium',
    }));

    // pending -> in_progress
    const inProgress = await transitionTask(ctx, created.id, {
      status: 'in_progress',
      notes: 'Starting work',
    });
    expect(inProgress.status).toBe('in_progress');

    // in_progress -> completed
    const completed = await transitionTask(ctx, created.id, {
      status: 'completed',
      notes: 'All done',
    });
    expect(completed.status).toBe('completed');

    // completed -> cancelled is disallowed
    await expect(
      transitionTask(ctx, created.id, { status: 'cancelled' }),
    ).rejects.toThrow(TaskValidationError);
  });

  it('assigns and re-assigns assignees', async () => {
    const ctx = ctxA1();
    const created = await createTask(ctx, createTaskSchema.parse({
      title: 'Assignment test',
      assigneeIds: [userA1],
    }));
    expect(created.assignees).toHaveLength(1);
    expect(created.assignees[0]?.id).toBe(userA1);

    // Reassign to userA2
    const reassigned = await assignTask(ctx, created.id, {
      assigneeIds: [userA2],
    });
    expect(reassigned.assignees).toHaveLength(1);
    expect(reassigned.assignees[0]?.id).toBe(userA2);
  });

  it('rejects assigning a user from a different organization', async () => {
    const ctx = ctxA1();
    const created = await createTask(ctx, createTaskSchema.parse({
      title: 'Cross-tenant assignment test',
    }));

    await expect(
      assignTask(ctx, created.id, { assigneeIds: [userB1] }),
    ).rejects.toThrow(TaskValidationError);
  });

  it('enforces multi-tenant isolation through RLS and context', async () => {
    const ctxA = ctxA1();
    const ctxB = ctxB1();

    const taskInA = await createTask(ctxA, createTaskSchema.parse({
      title: 'Secret Org A Task',
      priority: 'high',
    }));

    // User in Org B cannot retrieve task from Org A
    await expect(getTask(ctxB, taskInA.id)).rejects.toThrow(TaskNotFoundError);

    // User in Org B listing tasks sees 0 tasks
    const listB = await listTasks(ctxB, taskListQuerySchema.parse({}));
    expect(listB.items.every((t) => t.id !== taskInA.id)).toBe(true);
  });

  /**
   * Notifications on task operations. The reference for how a module's
   * notifications are tested end to end: do the business action, run the
   * dispatcher, then look at who actually received what.
   */
  describe('notifications', () => {
    const ctxA2 = () => ctxFor(orgA, userA2);

    /** Dispatch everything pending, then list what a user received for one task. */
    async function received(userId: string, taskId: string): Promise<string[]> {
      await dispatchOrganization(orgA);
      const rows = await asOwner(
        'read notifications',
        sql`SELECT type FROM notification
            WHERE recipient_id = ${userId} AND metadata->>'taskId' = ${taskId}
            ORDER BY created_at, type`,
      );
      return (rows as unknown as Array<{ type: string }>).map((r) => r.type);
    }

    const outboxCount = async (): Promise<number> => {
      const [row] = (await asOwner(
        'count outbox',
        sql`SELECT count(*)::int AS n FROM notification_outbox WHERE organization_id = ${orgA}`,
      )) as unknown as Array<{ n: number }>;
      return row!.n;
    };

    it('create: notifies the assignees, not the creator', async () => {
      const task = await createTask(ctxA1(), createTaskSchema.parse({
        title: 'Notify on create',
        priority: 'high',
        assigneeIds: [userA1, userA2],
      }));
      expect(await received(userA2, task.id)).toEqual(['task.assigned']);
      expect(await received(userA1, task.id)).toEqual([]); // the actor
    });

    it('create: assigning only yourself queues nothing at all', async () => {
      const before = await outboxCount();
      await createTask(ctxA1(), createTaskSchema.parse({ title: 'Self task', assigneeIds: [userA1] }));
      await createTask(ctxA1(), createTaskSchema.parse({ title: 'No assignees' }));
      expect(await outboxCount()).toBe(before);
    });

    it('update: tells assignees only when something really changed', async () => {
      const task = await createTask(ctxA1(), createTaskSchema.parse({
        title: 'Notify on update',
        priority: 'low',
        assigneeIds: [userA2],
      }));
      await received(userA2, task.id); // flush the "assigned" notification

      await updateTask(ctxA1(), task.id, { title: 'Notify on update', priority: 'low' }); // no change
      expect(await received(userA2, task.id)).toEqual(['task.assigned']);

      await updateTask(ctxA1(), task.id, { priority: 'urgent' });
      expect(await received(userA2, task.id)).toEqual(['task.assigned', 'task.updated']);
    });

    it('transition: tells the creator and assignees but never the actor; completion has its own type', async () => {
      const task = await createTask(ctxA1(), createTaskSchema.parse({
        title: 'Notify on status',
        assigneeIds: [userA2],
      }));
      await received(userA2, task.id);

      // The assignee starts the work: the creator (A1) hears, the actor (A2) does not.
      await transitionTask(ctxA2(), task.id, { status: 'in_progress' });
      expect(await received(userA1, task.id)).toEqual(['task.status_changed']);
      expect(await received(userA2, task.id)).toEqual(['task.assigned']);

      await transitionTask(ctxA2(), task.id, { status: 'completed' });
      expect(await received(userA1, task.id)).toEqual(['task.status_changed', 'task.completed']);
    });

    it('assign: only the difference is news', async () => {
      const task = await createTask(ctxA1(), createTaskSchema.parse({
        title: 'Notify on reassign',
        assigneeIds: [userA2],
      }));
      await received(userA2, task.id);

      // A2 -> A3: A3 is newly assigned, A2 is removed.
      await assignTask(ctxA1(), task.id, { assigneeIds: [userA3] });
      expect(await received(userA3, task.id)).toEqual(['task.assigned']);
      expect(await received(userA2, task.id)).toEqual(['task.assigned', 'task.unassigned']);

      // Saving the same list again tells nobody anything.
      await assignTask(ctxA1(), task.id, { assigneeIds: [userA3] });
      expect(await received(userA3, task.id)).toEqual(['task.assigned']);
    });

    it('a failed operation leaves no notification behind (same transaction)', async () => {
      const task = await createTask(ctxA1(), createTaskSchema.parse({ title: 'Rollback check' }));
      const before = await outboxCount();
      // userB1 belongs to another organization, so validation throws mid-transaction.
      await expect(assignTask(ctxA1(), task.id, { assigneeIds: [userA2, userB1] })).rejects.toThrow(TaskValidationError);
      expect(await outboxCount()).toBe(before);
      expect(await received(userA2, task.id)).toEqual([]);
    });
  });
});
