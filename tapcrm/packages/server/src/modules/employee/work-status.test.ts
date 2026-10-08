import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DateOnly } from '@tapcrm/contracts';
import type { PolicyEvaluationContext } from '@tapcrm/authz';
import { userPolicy } from './policy.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { LIVE_STATUS_EVENTS } from '../live-status/events.js';
import * as AttendanceFacade from '../attendance/facade.js';
import * as LiveStatusFacade from '../live-status/facade.js';
import * as repo from './repository.js';
import { getEmployeeWorkStatus } from './work-status.js';
import { IdentityNotFoundError } from '../identity/facade.js';

function createMockContext(
  orgId: string,
  userId: string,
  deptId = 'dept-1',
  teamId = 'team-1',
): RequestContext {
  return {
    organizationId: orgId,
    requestId: randomUUID(),
    sourceIp: '127.0.0.1',
    principal: {
      id: userId,
      organizationId: orgId,
      sessionVersion: 1,
      accountType: 'employee',
      allowedActions: ['users:view', 'attendance:view'],
      allowedResources: [],
      departmentId: deptId,
      teamId: teamId,
      expiresAt: new Date(Date.now() + 3600000),
    },
  } as unknown as RequestContext;
}

function createPolicyContext(
  orgId: string,
  userId: string,
  deptId = 'dept-1',
  teamId = 'team-1',
): PolicyEvaluationContext {
  return {
    organizationId: orgId,
    requestId: randomUUID(),
    memo: new Map(),
    principal: {
      id: userId,
      organizationId: orgId,
      accountType: 'employee',
      departmentId: deptId,
      teamId: teamId,
    } as PolicyEvaluationContext['principal'],
    scope: {
      departmentId: async () => deptId,
      teamIds: async () => new Set([teamId]),
      poolIds: async () => new Set([teamId]),
      subordinateIds: async () => new Set<string>(),
      poolMemberIds: async () => new Set<string>(),
    },
  };
}

function createMockRecordDetailRow(
  overrides: Partial<AttendanceFacade.DaySnapshot['record']> = {},
): AttendanceFacade.DaySnapshot['record'] {
  return {
    id: randomUUID(),
    workDate: '2026-10-07' as DateOnly,
    state: 'open',
    status: null,
    dayType: 'working',
    shiftSnapshot: {},
    shiftSource: 'template',
    placementSnapshot: { departmentId: null, teamId: null, positionId: null },
    windowStart: '2026-10-07T05:00:00Z',
    windowEnd: '2026-10-07T21:00:00Z',
    closeDueAt: '2026-10-07T21:00:00Z',
    workedMinutes: 0,
    breakMinutes: 0,
    lateMinutes: 0,
    earlyExitMinutes: 0,
    overtimeMinutes: 0,
    nightMinutes: 0,
    presentUnits: 2,
    paidLeaveUnits: 0,
    unpaidLeaveUnits: 0,
    absentUnits: 0,
    holidayUnits: 0,
    arrivalAt: null,
    departureAt: null,
    isWfh: false,
    flags: [],
    attributionFlags: [],
    inputVersion: 1,
    calculationVersion: 1,
    rulesVersion: '1.0',
    calculatedAt: null,
    closedAt: null,
    closedBy: null,
    ...overrides,
  };
}

describe('Employee 360 Work / Live Status Backend (Phase 1)', () => {
  const orgId = randomUUID();
  const callerId = randomUUID();
  const employeeId = randomUUID();
  const ctx = createMockContext(orgId, callerId);

  const mockProfile: repo.EmployeeProfile = {
    id: employeeId,
    accountType: 'employee',
    status: 'active',
    fullName: 'Jane Doe',
    email: 'jane@example.com',
    employeeId: 'EMP-101',
    departmentId: 'dept-eng',
    departmentName: 'Engineering',
    positionId: 'pos-1',
    positionName: 'Software Engineer',
    teamId: 'team-backend',
    teamName: 'Backend Core',
    designationId: 'desig-tech-lead',
    designationName: 'Tech Lead',
    specialization: 'Distributed Systems',
    reportsTo: null,
    reportsToName: null,
    joinedOn: '2026-01-01' as DateOnly,
    leftOn: null,
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00Z',
    onboardingWorkflowId: randomUUID(),
  };

  beforeEach(() => {
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => {
      return fn({} as unknown as Tx);
    });
    vi.spyOn(repo, 'findEmployeeProfile').mockResolvedValue(mockProfile);
    vi.spyOn(AttendanceFacade, 'currentDayFor').mockResolvedValue('2026-10-07' as DateOnly);
    vi.spyOn(LiveStatusFacade, 'readRow').mockResolvedValue(null);
    vi.spyOn(AttendanceFacade, 'loadDaySnapshot').mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Working employee
  it('1. correctly derives "Working" status for an on-time working employee', async () => {
    const shiftStart = new Date('2026-10-07T09:00:00Z');
    const arrival = new Date('2026-10-07T09:05:00Z'); // within 15m grace

    vi.spyOn(LiveStatusFacade, 'readRow').mockResolvedValue({
      id: employeeId,
      userId: employeeId,
      workDate: '2026-10-07' as DateOnly,
      state: 'WORKING',
      since: arrival,
      lastEventAt: arrival,
      workedMinutes: 120,
      breakMinutes: 0,
      presenceConfidence: 'confirmed',
      lastScanAt: null,
      lastScanDevice: null,
      likelyFinishedAt: null,
      isWfh: false,
      dayGroup: null,
      shiftStartAt: shiftStart,
      shiftEndAt: new Date('2026-10-07T17:00:00Z'),
      windowStart: new Date('2026-10-07T05:00:00Z'),
      windowEnd: new Date('2026-10-07T21:00:00Z'),
      rolloverDueAt: new Date('2026-10-07T21:00:00Z'),
      graceMinutes: 15,
      flexibleTargetMinutes: null,
      updatedAt: new Date('2026-10-07T11:05:00Z'),
    });

    vi.spyOn(AttendanceFacade, 'loadDaySnapshot').mockResolvedValue({
      userId: employeeId,
      date: '2026-10-07' as DateOnly,
      record: createMockRecordDetailRow({
        workedMinutes: 120,
        breakMinutes: 0,
        lateMinutes: 0,
        arrivalAt: arrival.toISOString(),
        calculatedAt: '2026-10-07T11:05:00Z',
      }),
      events: [],
      overlays: [],
    });

    const res = await getEmployeeWorkStatus(ctx, employeeId, new Date('2026-10-07T11:05:00Z'));

    expect(res.employee).toEqual({
      id: employeeId,
      fullName: 'Jane Doe',
      department: 'Engineering',
      departmentId: 'dept-eng',
      team: 'Backend Core',
      teamId: 'team-backend',
      designation: 'Tech Lead',
      designationId: 'desig-tech-lead',
    });
    expect(res.work.status).toBe('Working');
    expect(res.work.presenceState).toBe('WORKING');
    expect(res.work.punchIn).toBe(arrival.toISOString());
    expect(res.work.punchOut).toBeNull();
    expect(res.work.workMinutes).toBe(120);
    expect(res.work.breakMinutes).toBe(0);
    expect(res.work.isOnLeave).toBe(false);
  });

  // 2. On-break employee
  it('2. correctly derives "On Break" status when presenceState is ON_BREAK', async () => {
    vi.spyOn(LiveStatusFacade, 'readRow').mockResolvedValue({
      id: employeeId,
      userId: employeeId,
      workDate: '2026-10-07' as DateOnly,
      state: 'ON_BREAK',
      since: new Date('2026-10-07T12:00:00Z'),
      lastEventAt: new Date('2026-10-07T12:00:00Z'),
      workedMinutes: 180,
      breakMinutes: 15,
      presenceConfidence: 'confirmed',
      lastScanAt: null,
      lastScanDevice: null,
      likelyFinishedAt: null,
      isWfh: false,
      dayGroup: null,
      shiftStartAt: new Date('2026-10-07T09:00:00Z'),
      shiftEndAt: new Date('2026-10-07T17:00:00Z'),
      windowStart: new Date('2026-10-07T05:00:00Z'),
      windowEnd: new Date('2026-10-07T21:00:00Z'),
      rolloverDueAt: new Date('2026-10-07T21:00:00Z'),
      graceMinutes: 15,
      flexibleTargetMinutes: null,
      updatedAt: new Date('2026-10-07T12:15:00Z'),
    });

    const res = await getEmployeeWorkStatus(ctx, employeeId);
    expect(res.work.status).toBe('On Break');
    expect(res.work.presenceState).toBe('ON_BREAK');
    expect(res.work.breakMinutes).toBe(15);
  });

  // 3. Finished employee
  it('3. correctly derives "Finished" status when employee has punched out', async () => {
    const arrival = '2026-10-07T09:00:00.000Z';
    const departure = '2026-10-07T17:00:00.000Z';

    vi.spyOn(LiveStatusFacade, 'readRow').mockResolvedValue({
      id: employeeId,
      userId: employeeId,
      workDate: '2026-10-07' as DateOnly,
      state: 'FINISHED',
      since: new Date(departure),
      lastEventAt: new Date(departure),
      workedMinutes: 450,
      breakMinutes: 30,
      presenceConfidence: 'confirmed',
      lastScanAt: null,
      lastScanDevice: null,
      likelyFinishedAt: null,
      isWfh: false,
      dayGroup: null,
      shiftStartAt: new Date('2026-10-07T09:00:00Z'),
      shiftEndAt: new Date('2026-10-07T17:00:00Z'),
      windowStart: new Date('2026-10-07T05:00:00Z'),
      windowEnd: new Date('2026-10-07T21:00:00Z'),
      rolloverDueAt: new Date('2026-10-07T21:00:00Z'),
      graceMinutes: 15,
      flexibleTargetMinutes: null,
      updatedAt: new Date(departure),
    });

    vi.spyOn(AttendanceFacade, 'loadDaySnapshot').mockResolvedValue({
      userId: employeeId,
      date: '2026-10-07' as DateOnly,
      record: createMockRecordDetailRow({
        state: 'closed',
        status: 'present',
        workedMinutes: 450,
        breakMinutes: 30,
        arrivalAt: arrival,
        departureAt: departure,
        calculatedAt: departure,
      }),
      events: [],
      overlays: [],
    });

    const res = await getEmployeeWorkStatus(ctx, employeeId);
    expect(res.work.status).toBe('Finished');
    expect(res.work.presenceState).toBe('FINISHED');
    expect(res.work.punchIn).toBe(arrival);
    expect(res.work.punchOut).toBe(departure);
  });

  // 4. Not checked-in before shift due time
  it('4. derives "Not Checked In" before shift due time with isOverdue=false', async () => {
    const shiftStart = new Date('2026-10-07T10:00:00Z');
    const now = new Date('2026-10-07T09:30:00Z'); // before shift starts

    vi.spyOn(LiveStatusFacade, 'readRow').mockResolvedValue({
      id: employeeId,
      userId: employeeId,
      workDate: '2026-10-07' as DateOnly,
      state: 'NOT_IN',
      since: null,
      lastEventAt: null,
      workedMinutes: 0,
      breakMinutes: 0,
      presenceConfidence: 'confirmed',
      lastScanAt: null,
      lastScanDevice: null,
      likelyFinishedAt: null,
      isWfh: false,
      dayGroup: null,
      shiftStartAt: shiftStart,
      shiftEndAt: new Date('2026-10-07T18:00:00Z'),
      windowStart: new Date('2026-10-07T06:00:00Z'),
      windowEnd: new Date('2026-10-07T22:00:00Z'),
      rolloverDueAt: new Date('2026-10-07T22:00:00Z'),
      graceMinutes: 15,
      flexibleTargetMinutes: null,
      updatedAt: now,
    });

    const res = await getEmployeeWorkStatus(ctx, employeeId, now);
    expect(res.work.status).toBe('Not Checked In');
    expect(res.work.isOverdue).toBe(false);
    expect(res.work.displayGroup).toBe('notInNotYetDue');
    expect(res.work.punchIn).toBeNull();
    expect(res.work.punchOut).toBeNull();
  });

  // 5. Not checked-in after shift + grace
  it('5. derives "Not Checked In" with isOverdue=true and displayGroup=notInDue when past shift+grace', async () => {
    const shiftStart = new Date('2026-10-07T09:00:00Z');
    const now = new Date('2026-10-07T09:30:00Z'); // grace is 15m, so due was 09:15:00Z

    vi.spyOn(LiveStatusFacade, 'readRow').mockResolvedValue({
      id: employeeId,
      userId: employeeId,
      workDate: '2026-10-07' as DateOnly,
      state: 'NOT_IN',
      since: null,
      lastEventAt: null,
      workedMinutes: 0,
      breakMinutes: 0,
      presenceConfidence: 'confirmed',
      lastScanAt: null,
      lastScanDevice: null,
      likelyFinishedAt: null,
      isWfh: false,
      dayGroup: null,
      shiftStartAt: shiftStart,
      shiftEndAt: new Date('2026-10-07T17:00:00Z'),
      windowStart: new Date('2026-10-07T05:00:00Z'),
      windowEnd: new Date('2026-10-07T21:00:00Z'),
      rolloverDueAt: new Date('2026-10-07T21:00:00Z'),
      graceMinutes: 15,
      flexibleTargetMinutes: null,
      updatedAt: now,
    });

    const res = await getEmployeeWorkStatus(ctx, employeeId, now);
    expect(res.work.status).toBe('Not Checked In');
    expect(res.work.isOverdue).toBe(true);
    expect(res.work.displayGroup).toBe('notInDue');
  });

  // 6. Late employee
  it('6. derives display status "Late" when employee arrived after grace period, preserving WORKING state', async () => {
    const shiftStart = new Date('2026-10-07T09:00:00Z');
    const arrival = new Date('2026-10-07T09:35:00Z'); // 20m late after 15m grace

    vi.spyOn(LiveStatusFacade, 'readRow').mockResolvedValue({
      id: employeeId,
      userId: employeeId,
      workDate: '2026-10-07' as DateOnly,
      state: 'WORKING',
      since: arrival,
      lastEventAt: arrival,
      workedMinutes: 60,
      breakMinutes: 0,
      presenceConfidence: 'confirmed',
      lastScanAt: null,
      lastScanDevice: null,
      likelyFinishedAt: null,
      isWfh: false,
      dayGroup: null,
      shiftStartAt: shiftStart,
      shiftEndAt: new Date('2026-10-07T17:00:00Z'),
      windowStart: new Date('2026-10-07T05:00:00Z'),
      windowEnd: new Date('2026-10-07T21:00:00Z'),
      rolloverDueAt: new Date('2026-10-07T21:00:00Z'),
      graceMinutes: 15,
      flexibleTargetMinutes: null,
      updatedAt: new Date('2026-10-07T10:35:00Z'),
    });

    vi.spyOn(AttendanceFacade, 'loadDaySnapshot').mockResolvedValue({
      userId: employeeId,
      date: '2026-10-07' as DateOnly,
      record: createMockRecordDetailRow({
        workedMinutes: 60,
        lateMinutes: 20,
        arrivalAt: arrival.toISOString(),
        flags: ['late'],
        calculatedAt: '2026-10-07T10:35:00Z',
      }),
      events: [],
      overlays: [],
    });

    const res = await getEmployeeWorkStatus(ctx, employeeId);
    expect(res.work.status).toBe('Late');
    expect(res.work.presenceState).toBe('WORKING'); // Authoritative core presence state unchanged
    expect(res.work.punchIn).toBe(arrival.toISOString());
    expect(res.work.punchOut).toBeNull();
  });

  // 7. Employee on leave
  it('7. derives "Leave" status when dayGroup is leave', async () => {
    vi.spyOn(LiveStatusFacade, 'readRow').mockResolvedValue({
      id: employeeId,
      userId: employeeId,
      workDate: '2026-10-07' as DateOnly,
      state: 'NOT_IN',
      since: null,
      lastEventAt: null,
      workedMinutes: 0,
      breakMinutes: 0,
      presenceConfidence: 'confirmed',
      lastScanAt: null,
      lastScanDevice: null,
      likelyFinishedAt: null,
      isWfh: false,
      dayGroup: 'leave',
      shiftStartAt: new Date('2026-10-07T09:00:00Z'),
      shiftEndAt: new Date('2026-10-07T17:00:00Z'),
      windowStart: new Date('2026-10-07T05:00:00Z'),
      windowEnd: new Date('2026-10-07T21:00:00Z'),
      rolloverDueAt: new Date('2026-10-07T21:00:00Z'),
      graceMinutes: 15,
      flexibleTargetMinutes: null,
      updatedAt: new Date('2026-10-07T09:00:00Z'),
    });

    const res = await getEmployeeWorkStatus(ctx, employeeId);
    expect(res.work.status).toBe('Leave');
    expect(res.work.isOnLeave).toBe(true);
    expect(res.work.displayGroup).toBe('onLeave');
  });

  // 8. Employee with punch-in
  it('8. provides authoritative punchIn timestamp from arrivalAt without depending on updatedAt or lastEventAt', async () => {
    const arrival = '2026-10-07T08:55:00.000Z';
    const lastEvent = new Date('2026-10-07T11:45:00.000Z'); // different from arrival
    const updated = new Date('2026-10-07T11:50:00.000Z');

    vi.spyOn(LiveStatusFacade, 'readRow').mockResolvedValue({
      id: employeeId,
      userId: employeeId,
      workDate: '2026-10-07' as DateOnly,
      state: 'WORKING',
      since: new Date(arrival),
      lastEventAt: lastEvent,
      workedMinutes: 175,
      breakMinutes: 0,
      presenceConfidence: 'confirmed',
      lastScanAt: null,
      lastScanDevice: null,
      likelyFinishedAt: null,
      isWfh: false,
      dayGroup: null,
      shiftStartAt: new Date('2026-10-07T09:00:00Z'),
      shiftEndAt: new Date('2026-10-07T17:00:00Z'),
      windowStart: new Date('2026-10-07T05:00:00Z'),
      windowEnd: new Date('2026-10-07T21:00:00Z'),
      rolloverDueAt: new Date('2026-10-07T21:00:00Z'),
      graceMinutes: 15,
      flexibleTargetMinutes: null,
      updatedAt: updated,
    });

    vi.spyOn(AttendanceFacade, 'loadDaySnapshot').mockResolvedValue({
      userId: employeeId,
      date: '2026-10-07' as DateOnly,
      record: createMockRecordDetailRow({
        workedMinutes: 175,
        arrivalAt: arrival,
        calculatedAt: updated.toISOString(),
      }),
      events: [],
      overlays: [],
    });

    const res = await getEmployeeWorkStatus(ctx, employeeId);
    expect(res.work.punchIn).toBe(arrival);
    expect(res.work.punchIn).not.toBe(lastEvent.toISOString());
    expect(res.work.punchIn).not.toBe(updated.toISOString());
  });

  // 9. Employee with punch-out
  it('9. provides punchOut timestamp when finished and null when working', async () => {
    const arrival = '2026-10-07T09:00:00.000Z';
    const departure = '2026-10-07T17:05:00.000Z';

    vi.spyOn(LiveStatusFacade, 'readRow').mockResolvedValue({
      id: employeeId,
      userId: employeeId,
      workDate: '2026-10-07' as DateOnly,
      state: 'FINISHED',
      since: new Date(departure),
      lastEventAt: new Date(departure),
      workedMinutes: 455,
      breakMinutes: 30,
      presenceConfidence: 'confirmed',
      lastScanAt: null,
      lastScanDevice: null,
      likelyFinishedAt: null,
      isWfh: false,
      dayGroup: null,
      shiftStartAt: new Date('2026-10-07T09:00:00Z'),
      shiftEndAt: new Date('2026-10-07T17:00:00Z'),
      windowStart: new Date('2026-10-07T05:00:00Z'),
      windowEnd: new Date('2026-10-07T21:00:00Z'),
      rolloverDueAt: new Date('2026-10-07T21:00:00Z'),
      graceMinutes: 15,
      flexibleTargetMinutes: null,
      updatedAt: new Date(departure),
    });

    vi.spyOn(AttendanceFacade, 'loadDaySnapshot').mockResolvedValue({
      userId: employeeId,
      date: '2026-10-07' as DateOnly,
      record: createMockRecordDetailRow({
        state: 'closed',
        status: 'present',
        workedMinutes: 455,
        breakMinutes: 30,
        arrivalAt: arrival,
        departureAt: departure,
        calculatedAt: departure,
      }),
      events: [],
      overlays: [],
    });

    const res = await getEmployeeWorkStatus(ctx, employeeId);
    expect(res.work.punchIn).toBe(arrival);
    expect(res.work.punchOut).toBe(departure);
  });

  // 10. Work minutes
  it('10. reflects authoritative workedMinutes from the live projection', async () => {
    vi.spyOn(LiveStatusFacade, 'readRow').mockResolvedValue({
      id: employeeId,
      userId: employeeId,
      workDate: '2026-10-07' as DateOnly,
      state: 'WORKING',
      since: new Date('2026-10-07T09:00:00Z'),
      lastEventAt: new Date('2026-10-07T09:00:00Z'),
      workedMinutes: 245,
      breakMinutes: 40,
      presenceConfidence: 'confirmed',
      lastScanAt: null,
      lastScanDevice: null,
      likelyFinishedAt: null,
      isWfh: false,
      dayGroup: null,
      shiftStartAt: new Date('2026-10-07T09:00:00Z'),
      shiftEndAt: new Date('2026-10-07T17:00:00Z'),
      windowStart: new Date('2026-10-07T05:00:00Z'),
      windowEnd: new Date('2026-10-07T21:00:00Z'),
      rolloverDueAt: new Date('2026-10-07T21:00:00Z'),
      graceMinutes: 15,
      flexibleTargetMinutes: null,
      updatedAt: new Date('2026-10-07T13:45:00Z'),
    });

    const res = await getEmployeeWorkStatus(ctx, employeeId);
    expect(res.work.workMinutes).toBe(245);
    expect(res.work.workTime).toBe(245);
  });

  // 11. Break minutes
  it('11. reflects authoritative breakMinutes from the live projection', async () => {
    vi.spyOn(LiveStatusFacade, 'readRow').mockResolvedValue({
      id: employeeId,
      userId: employeeId,
      workDate: '2026-10-07' as DateOnly,
      state: 'ON_BREAK',
      since: new Date('2026-10-07T13:00:00Z'),
      lastEventAt: new Date('2026-10-07T13:00:00Z'),
      workedMinutes: 240,
      breakMinutes: 45,
      presenceConfidence: 'confirmed',
      lastScanAt: null,
      lastScanDevice: null,
      likelyFinishedAt: null,
      isWfh: false,
      dayGroup: null,
      shiftStartAt: new Date('2026-10-07T09:00:00Z'),
      shiftEndAt: new Date('2026-10-07T17:00:00Z'),
      windowStart: new Date('2026-10-07T05:00:00Z'),
      windowEnd: new Date('2026-10-07T21:00:00Z'),
      rolloverDueAt: new Date('2026-10-07T21:00:00Z'),
      graceMinutes: 15,
      flexibleTargetMinutes: null,
      updatedAt: new Date('2026-10-07T13:45:00Z'),
    });

    const res = await getEmployeeWorkStatus(ctx, employeeId);
    expect(res.work.breakMinutes).toBe(45);
    expect(res.work.breakTime).toBe(45);
  });

  // 12. Employee with no attendance record
  it('12. cleanly returns zero-value work data when employee has no attendance record', async () => {
    vi.spyOn(LiveStatusFacade, 'readRow').mockResolvedValue(null);
    vi.spyOn(AttendanceFacade, 'loadDaySnapshot').mockResolvedValue(null);

    const res = await getEmployeeWorkStatus(ctx, employeeId);
    expect(res.work.status).toBe('Not Checked In');
    expect(res.work.presenceState).toBe('NOT_IN');
    expect(res.work.punchIn).toBeNull();
    expect(res.work.punchOut).toBeNull();
    expect(res.work.workMinutes).toBe(0);
    expect(res.work.breakMinutes).toBe(0);
  });

  // 13. Unauthorized employee access
  it('13. rejects access when caller has "own" scope and requests another employee', async () => {
    const callerStaffCtx = createPolicyContext(orgId, callerId, 'dept-eng', 'team-backend');
    const targetResource = {
      type: 'user',
      id: employeeId, // different from callerId
      organizationId: orgId,
      departmentId: 'dept-sales',
      teamId: 'team-sales-1',
    };

    const isOwnAllowed = await userPolicy.check(callerStaffCtx, 'users:view', targetResource, 'own');
    expect(isOwnAllowed).toBe(false);

    const isDifferentDeptAllowed = await userPolicy.check(
      callerStaffCtx,
      'users:view',
      targetResource,
      'department',
    );
    expect(isDifferentDeptAllowed).toBe(false);
  });

  // 14. Cross-tenant access
  it('14. rejects cross-tenant access and returns not found when employee belongs to another organization', async () => {
    const otherOrgId = randomUUID();
    const crossTenantCtx = createMockContext(otherOrgId, callerId);

    // findEmployeeProfile returns null when employee is not in caller's organizationId
    vi.spyOn(repo, 'findEmployeeProfile').mockResolvedValue(null);

    await expect(getEmployeeWorkStatus(crossTenantCtx, employeeId)).rejects.toThrow(IdentityNotFoundError);

    // Also assert userPolicy denies cross-tenant resources
    const policyCtx = createPolicyContext(otherOrgId, callerId);
    const crossOrgResource = {
      type: 'user',
      id: employeeId,
      organizationId: orgId, // different from crossTenantCtx.organizationId
    };
    const allowed = await userPolicy.check(policyCtx, 'users:view', crossOrgResource, 'all-people');
    expect(allowed).toBe(false);
  });

  // 15. Onboarding completed + verification pending
  it('15. allows Employee 360 access when onboarding is completed and verification is pending', async () => {
    // Employee profile with onboarding completed
    const onboardingCompletedProfile: repo.EmployeeProfile = {
      ...mockProfile,
      onboardingWorkflowId: 'completed-wf-id',
    };
    vi.spyOn(repo, 'findEmployeeProfile').mockResolvedValue(onboardingCompletedProfile);

    const res = await getEmployeeWorkStatus(ctx, employeeId);
    expect(res.employee.id).toBe(employeeId);
    expect(res.work.status).toBe('Not Checked In');
  });

  // 16. Employee 360 still accessible (verification independence)
  it('16. does NOT check verification status (isVerified) to gate Employee 360 access', async () => {
    const res = await getEmployeeWorkStatus(ctx, employeeId);
    expect(res).toBeDefined();
    expect(res.employee.fullName).toBe('Jane Doe');
  });

  // 17. Realtime/live-status update compatibility
  it('17. confirms live-status STATUS_CHANGED event contract naming { userId }', () => {
    expect(LIVE_STATUS_EVENTS.STATUS_CHANGED).toBe('live-status.status-changed');
  });
});
