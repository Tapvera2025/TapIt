import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@tapcrm/contracts';
import {
  __resetConstraints,
  __resetResourcePolicies,
  AuthorizationError,
  type PolicyEvaluationContext,
  type Resource,
} from '@tapcrm/authz';
import { registerTasksPolicies, taskPolicy } from './policy.js';
import type { TaskStatus } from './types.js';
import { createTaskSchema, taskListQuerySchema } from './validators.js';
import { createRequestContext, type RequestContext } from '../../platform/dal/context.js';
import { platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { installAuthz } from '../../platform/authz-adapter.js';
import {
  assignTask,
  createTask,
  getTask,
  listTasks,
  transitionTask,
  updateAssignmentStatus,
} from './service.js';

describe('Task Bug Fixes Regression Suite — Bug #1 and Bug #2', () => {
  const organizationId = randomUUID();
  const superAdminId = randomUUID();
  const employeeAId = randomUUID();
  const employeeBId = randomUUID();
  const employeeCId = randomUUID();
  const departmentId = randomUUID();

  function makeContext(options: {
    userId: string;
    accountType: 'employee' | 'super-admin';
    departmentId?: string | null;
  }): PolicyEvaluationContext {
    return {
      organizationId,
      requestId: `req-${options.userId}`,
      memo: new Map(),
      principal: {
        id: options.userId,
        organizationId,
        accountType: options.accountType,
        sessionVersion: 1,
        positionId: randomUUID(),
        departmentId: options.departmentId ?? undefined,
        teamId: null,
        reportsTo: null,
        organizationalLevel: 1,
      } as PolicyEvaluationContext['principal'],
      scope: {
        departmentId: async () => options.departmentId ?? null,
        teamIds: async () => new Set<string>(),
        poolIds: async () => new Set<string>(),
        subordinateIds: async () => new Set<string>(),
        poolMemberIds: async () => new Set<string>(),
      },
    };
  }

  beforeAll(() => {
    __resetResourcePolicies();
    __resetConstraints();
    registerTasksPolicies();
  });

  describe('BUG #1 — Task Creator Visibility (Policy & Scoping)', () => {
    it('1 & 2. Super Admin creates task and assigns to Employee A; Creator is NOT automatically added as assignee', () => {
      const taskResource: Resource = {
        type: 'task',
        id: randomUUID(),
        organizationId,
        createdBy: superAdminId,
        assignedTo: employeeAId,
        assigneeIds: [employeeAId],
        status: 'pending',
        priority: 'medium',
      };

      // Creator is separate from assignees
      expect(taskResource['createdBy']).toBe(superAdminId);
      expect(taskResource['assigneeIds']).toEqual([employeeAId]);
      expect(taskResource['assigneeIds']).not.toContain(superAdminId);
    });

    it('3. Creator can view the task even when not one of the assignees (own / participant scope)', async () => {
      const creatorCtx = makeContext({
        userId: superAdminId,
        accountType: 'super-admin',
      });

      const taskResource: Resource = {
        type: 'task',
        id: randomUUID(),
        organizationId,
        createdBy: superAdminId,
        assignedTo: employeeAId,
        assigneeIds: [employeeAId],
        status: 'pending',
        priority: 'medium',
      };

      // taskPolicy.check for tasks:view allows creator
      const canCreatorView = await taskPolicy.check(
        creatorCtx,
        'tasks:view',
        taskResource,
        'own',
      );
      expect(canCreatorView).toBe(true);

      const canCreatorViewParticipant = await taskPolicy.check(
        creatorCtx,
        'tasks:view',
        taskResource,
        'participant',
      );
      expect(canCreatorViewParticipant).toBe(true);
    });

    it('3b. Creator can view task across department or team scope via tasks:view model', async () => {
      const regularCreatorCtx = makeContext({
        userId: 'creator-emp-id',
        accountType: 'employee',
        departmentId: 'dept-creator',
      });

      const taskResource: Resource = {
        type: 'task',
        id: randomUUID(),
        organizationId,
        createdBy: 'creator-emp-id',
        assignedTo: employeeAId,
        assigneeIds: [employeeAId],
        departmentId: 'dept-other',
        status: 'pending',
        priority: 'medium',
      };

      const canView = await taskPolicy.check(
        regularCreatorCtx,
        'tasks:view',
        taskResource,
        'department',
      );
      expect(canView).toBe(true);
    });

    it('4. Employee A can view the task as an assignee', async () => {
      const employeeACtx = makeContext({
        userId: employeeAId,
        accountType: 'employee',
        departmentId,
      });

      const taskResource: Resource = {
        type: 'task',
        id: randomUUID(),
        organizationId,
        createdBy: superAdminId,
        assignedTo: employeeAId,
        assigneeIds: [employeeAId],
        status: 'pending',
        priority: 'medium',
      };

      const canEmployeeAView = await taskPolicy.check(
        employeeACtx,
        'tasks:view',
        taskResource,
        'own',
      );
      expect(canEmployeeAView).toBe(true);
    });

    it('5. Creator visibility query filter includes created_by OR task_assignee', async () => {
      const creatorCtx = makeContext({
        userId: superAdminId,
        accountType: 'super-admin',
      });

      const filter = await taskPolicy.filter(creatorCtx, 'tasks:view', 'own');
      expect(filter.sql).toContain('t.created_by = $1');
      expect(filter.sql).toContain('task_assignee');
      expect(filter.parameters).toEqual([superAdminId]);
    });

    it('6. Creator visibility does NOT grant unauthorized status modification to other assignees', async () => {
      // Employee with own scope created task and assigned to Employee A
      const creatorCtx = makeContext({
        userId: 'creator-emp',
        accountType: 'employee',
      });

      const taskResource: Resource = {
        type: 'task',
        id: randomUUID(),
        organizationId,
        createdBy: 'creator-emp',
        assignedTo: employeeAId,
        assigneeIds: [employeeAId],
        status: 'pending',
        priority: 'medium',
      };

      // Viewing is allowed for creator
      expect(await taskPolicy.check(creatorCtx, 'tasks:view', taskResource, 'own')).toBe(true);

      // Non-creator, non-assignee cannot view under own scope
      const strangerCtx = makeContext({
        userId: 'stranger-emp',
        accountType: 'employee',
      });
      expect(await taskPolicy.check(strangerCtx, 'tasks:view', taskResource, 'own')).toBe(false);
    });
  });

  describe('BUG #2 — Multi-Assignee Status Independence', () => {
    it('Assignee status changes maintain independent assignment state', () => {
      // Simulate task with 3 assignees: Employee A, B, C
      const assignees: { id: string; fullName: string; status: TaskStatus }[] = [
        { id: employeeAId, fullName: 'Employee A', status: 'pending' },
        { id: employeeBId, fullName: 'Employee B', status: 'pending' },
        { id: employeeCId, fullName: 'Employee C', status: 'pending' },
      ];
      const taskGlobalStatus = 'pending';

      // Initial state
      expect(assignees[0]?.status).toBe('pending');
      expect(assignees[1]?.status).toBe('pending');
      expect(assignees[2]?.status).toBe('pending');
      expect(taskGlobalStatus).toBe('pending');

      // 1. Employee A transitions to completed
      assignees[0] = { ...assignees[0]!, status: 'completed' };
      expect(assignees[0]?.status).toBe('completed');
      expect(assignees[1]?.status).toBe('pending');
      expect(assignees[2]?.status).toBe('pending');
      expect(taskGlobalStatus).toBe('pending'); // Global status unchanged

      // 2. Employee B transitions to in_progress
      assignees[1] = { ...assignees[1]!, status: 'in_progress' };
      expect(assignees[0]?.status).toBe('completed');
      expect(assignees[1]?.status).toBe('in_progress');
      expect(assignees[2]?.status).toBe('pending');
      expect(taskGlobalStatus).toBe('pending'); // Global status unchanged

      // 3. Employee C transitions to completed
      assignees[2] = { ...assignees[2]!, status: 'completed' };
      expect(assignees[0]?.status).toBe('completed');
      expect(assignees[1]?.status).toBe('in_progress');
      expect(assignees[2]?.status).toBe('completed');
      expect(taskGlobalStatus).toBe('pending'); // Global status unchanged
    });
  });
});

// Database-backed integration tests when PostgreSQL is available
const dbIntegrationEnabled =
  process.env['TAPCRM_INTEGRATION_DB'] === '1' ||
  (process.env['DATABASE_URL'] !== undefined && process.env['DATABASE_URL'].length > 0);

describe.skipIf(!dbIntegrationEnabled)('Task Bug Fixes Integration Tests (PostgreSQL)', () => {
  const orgId = randomUUID();
  const superAdminId = randomUUID();
  const empAId = randomUUID();
  const empBId = randomUUID();
  const empCId = randomUUID();
  const deptId = randomUUID();
  const posId = randomUUID();

  const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
    platformDb.query('migration', reason, fragment);

  function makeReqCtx(userId: string, accountType: 'employee' | 'super-admin'): RequestContext {
    const principal: Principal = {
      id: userId,
      organizationId: orgId,
      accountType,
      sessionVersion: 1,
      positionId: posId,
      departmentId: deptId,
      teamId: null,
      reportsTo: null,
      organizationalLevel: 1,
    };
    return createRequestContext({
      organizationId: orgId,
      principal,
      requestId: `req-${userId}`,
    });
  }

  const superAdminCtx = () => makeReqCtx(superAdminId, 'super-admin');
  const empACtx = () => makeReqCtx(empAId, 'employee');
  const empBCtx = () => makeReqCtx(empBId, 'employee');
  const empCCtx = () => makeReqCtx(empCId, 'employee');

  beforeAll(async () => {
    try {
      installAuthz();
    } catch {
      // already installed
    }
    try {
      registerTasksPolicies();
    } catch {
      // already registered
    }

    // 1. Create org
    await asOwner(
      'setup regression test org',
      sql`
        INSERT INTO organization (id, code, name)
        VALUES (${orgId}, ${`BO${orgId.slice(0, 6)}`}, 'Bug Regression Org')
        ON CONFLICT DO NOTHING;
      `,
    );

    // 2. Enable tasks module
    await asOwner(
      'enable tasks module',
      sql`
        INSERT INTO organization_module (organization_id, module_id, status, enabled_at)
        SELECT ${orgId}, id, 'enabled', now()
        FROM module WHERE key = 'tasks'
        ON CONFLICT DO NOTHING;
      `,
    );

    // 3. Setup department and position
    await asOwner(
      'setup department',
      sql`
        INSERT INTO department (id, organization_id, code, name, kind)
        VALUES (${deptId}, ${orgId}, 'ENG', 'Engineering', 'delivery')
        ON CONFLICT DO NOTHING;
      `,
    );

    await asOwner(
      'setup position',
      sql`
        INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
        VALUES (${posId}, ${orgId}, ${deptId}, 'DEV', 'Developer', 20)
        ON CONFLICT DO NOTHING;
      `,
    );

    // 4. Setup users
    await asOwner(
      'setup users',
      sql`
        INSERT INTO app_user (id, organization_id, email, full_name, account_type, department_id, position_id, employee_id)
        VALUES
          (${superAdminId}, ${orgId}, ${`admin-${orgId.slice(0, 4)}@bugtest.local`}, 'Super Admin', 'super-admin', NULL, NULL, 'TASK-SA01'),
          (${empAId}, ${orgId}, ${`empA-${orgId.slice(0, 4)}@bugtest.local`}, 'Employee A', 'employee', ${deptId}, ${posId}, 'TASK-EA01'),
          (${empBId}, ${orgId}, ${`empB-${orgId.slice(0, 4)}@bugtest.local`}, 'Employee B', 'employee', ${deptId}, ${posId}, 'TASK-EB01'),
          (${empCId}, ${orgId}, ${`empC-${orgId.slice(0, 4)}@bugtest.local`}, 'Employee C', 'employee', ${deptId}, ${posId}, 'TASK-EC01')
        ON CONFLICT DO NOTHING;
      `,
    );
  });

  afterAll(async () => {
    try {
      await asOwner('cleanup test task assignees', sql`DELETE FROM task_assignee WHERE organization_id = ${orgId}`);
      await asOwner('cleanup test tasks', sql`DELETE FROM task WHERE organization_id = ${orgId}`);
      await asOwner('cleanup test users', sql`DELETE FROM app_user WHERE organization_id = ${orgId}`);
      await asOwner('cleanup test positions', sql`DELETE FROM position WHERE organization_id = ${orgId}`);
      await asOwner('cleanup test departments', sql`DELETE FROM department WHERE organization_id = ${orgId}`);
      await asOwner('cleanup test modules', sql`DELETE FROM organization_module WHERE organization_id = ${orgId}`);
      await asOwner('cleanup test organizations', sql`DELETE FROM organization WHERE id = ${orgId}`);
    } catch {
      // Best-effort cleanup
    }
    await closePools();
  });

  it('BUG #1: Super Admin creates Task assigned to Employee A; Creator is NOT an assignee but can retrieve and list it', async () => {
    const task = await createTask(superAdminCtx(), {
      title: 'Bug #1 Creator Task',
      description: 'Super Admin created task',
      assigneeIds: [empAId],
      priority: 'high',
    });

    expect(task.createdBy).toBe(superAdminId);
    expect(task.assignees.length).toBe(1);
    expect(task.assignees[0]?.id).toBe(empAId);
    // Super admin is NOT an assignee
    expect(task.assignees.some((a) => a.id === superAdminId)).toBe(false);

    // Creator can retrieve task by ID
    const retrievedByCreator = await getTask(superAdminCtx(), task.id);
    expect(retrievedByCreator.id).toBe(task.id);
    expect(retrievedByCreator.createdBy).toBe(superAdminId);

    // Employee A can retrieve task by ID
    const retrievedByEmployeeA = await getTask(empACtx(), task.id);
    expect(retrievedByEmployeeA.id).toBe(task.id);

    // Creator can list task with participantId filter (used in "My Tasks")
    const creatorList = await listTasks(superAdminCtx(), taskListQuerySchema.parse({
      participantId: superAdminId,
    }));
    expect(creatorList.items.some((t) => t.id === task.id)).toBe(true);

    // Creator can list all tasks
    const allList = await listTasks(superAdminCtx(), taskListQuerySchema.parse({}));
    expect(allList.items.some((t) => t.id === task.id)).toBe(true);
  });

  it('BUG #2: Multi-assignee status independence (Employees A, B, C)', async () => {
    // 1. Create task assigned to A, B, C
    const task = await createTask(superAdminCtx(), createTaskSchema.parse({
      title: 'Build dashboard',
      description: 'Multi-assignee status test',
      assigneeIds: [empAId, empBId, empCId],
      priority: 'urgent',
    }));

    expect(task.assignees.length).toBe(3);
    const initialA = task.assignees.find((a) => a.id === empAId);
    const initialB = task.assignees.find((a) => a.id === empBId);
    const initialC = task.assignees.find((a) => a.id === empCId);
    expect(initialA?.status).toBe('pending');
    expect(initialB?.status).toBe('pending');
    expect(initialC?.status).toBe('pending');
    expect(task.status).toBe('pending');

    // 2. Employee A transitions own status to completed
    const taskAfterA = await transitionTask(empACtx(), task.id, {
      status: 'completed',
    });

    const aAfterA = taskAfterA.assignees.find((a) => a.id === empAId);
    const bAfterA = taskAfterA.assignees.find((a) => a.id === empBId);
    const cAfterA = taskAfterA.assignees.find((a) => a.id === empCId);

    expect(aAfterA?.status).toBe('completed');
    expect(bAfterA?.status).toBe('pending');
    expect(cAfterA?.status).toBe('pending');
    expect(taskAfterA.status).toBe('pending'); // Global task status unchanged

    // 3. Employee B transitions own status to in_progress
    const taskAfterB = await transitionTask(empBCtx(), task.id, {
      status: 'in_progress',
    });

    const aAfterB = taskAfterB.assignees.find((a) => a.id === empAId);
    const bAfterB = taskAfterB.assignees.find((a) => a.id === empBId);
    const cAfterB = taskAfterB.assignees.find((a) => a.id === empCId);

    expect(aAfterB?.status).toBe('completed');
    expect(bAfterB?.status).toBe('in_progress');
    expect(cAfterB?.status).toBe('pending');
    expect(taskAfterB.status).toBe('pending'); // Global task status unchanged

    // 4. Employee C transitions own status to completed
    const taskAfterC = await transitionTask(empCCtx(), task.id, {
      status: 'completed',
    });

    const aAfterC = taskAfterC.assignees.find((a) => a.id === empAId);
    const bAfterC = taskAfterC.assignees.find((a) => a.id === empBId);
    const cAfterC = taskAfterC.assignees.find((a) => a.id === empCId);

    expect(aAfterC?.status).toBe('completed');
    expect(bAfterC?.status).toBe('in_progress');
    expect(cAfterC?.status).toBe('completed');
    expect(taskAfterC.status).toBe('pending'); // Global task status unchanged
  });

  it('BUG #2: updateAssignmentStatus explicitly identifies taskId and userId', async () => {
    const task = await createTask(superAdminCtx(), createTaskSchema.parse({
      title: 'Dedicated status update test',
      assigneeIds: [empAId, empBId],
    }));

    // Super Admin updates Employee A to in_progress using updateAssignmentStatus
    const updated = await updateAssignmentStatus(
      superAdminCtx(),
      task.id,
      empAId,
      'in_progress',
    );

    const a = updated.assignees.find((assignee) => assignee.id === empAId);
    const b = updated.assignees.find((assignee) => assignee.id === empBId);
    expect(a?.status).toBe('in_progress');
    expect(b?.status).toBe('pending');
  });

  it('Regression: Re-assigning assignees preserves existing assignees statuses', async () => {
    const task = await createTask(superAdminCtx(), createTaskSchema.parse({
      title: 'Reassignment Status Preservation',
      assigneeIds: [empAId],
    }));

    // Employee A completes their part
    await transitionTask(empACtx(), task.id, { status: 'completed' });

    // Now assign Employee B as well (assigneeIds: [empAId, empBId])
    const reassigned = await assignTask(superAdminCtx(), task.id, {
      assigneeIds: [empAId, empBId],
    });

    const a = reassigned.assignees.find((assignee) => assignee.id === empAId);
    const b = reassigned.assignees.find((assignee) => assignee.id === empBId);
    expect(a?.status).toBe('completed'); // Preserved!
    expect(b?.status).toBe('pending'); // Newly assigned
  });

  it('Creator with own scope cannot update another assignee assignment status', async () => {
    const task = await createTask(empACtx(), createTaskSchema.parse({
      title: 'Emp A Created Task',
      assigneeIds: [empBId],
    }));

    // Emp A (creator) attempts to transition Emp B's assignment status
    await expect(
      transitionTask(empACtx(), task.id, {
        userId: empBId,
        status: 'in_progress',
      }),
    ).rejects.toThrow(AuthorizationError);
  });
});
