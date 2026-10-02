import type { LeaveTypeDto, LeaveRequestSummary, LeaveQueueItem, LeaveBalanceDto, LeaveCalendarEvent, DateOnly } from '@tapcrm/contracts';
import { holdsPolicy, isMatchNothing, visibilityFilter } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { organizationToday } from '../../platform/organization-time.js';
import { addDays, systemClock, type Clock } from '../../platform/time.js';
import * as AttendanceFacade from '../attendance/facade.js';
import * as CalendarFacade from '../holidays/facade.js';
import {
  LEAVE_ERROR_CODES,
  LeaveConflictError, LeaveForbiddenError, LeaveNotFoundError, LeaveTypeNotFoundError, LeaveValidationError,
} from './errors.js';
import { recordLeaveDecided } from './events.js';
import { daysConsumed, overlayKindForDay, yearlyEntitlement } from './rules.js';
import * as repo from './repository.js';
import { makeLeaveRequestResource } from './policy.js';
import { notifyLeaveDecided, notifyLeaveRequested } from './notifications.js';
import type { CreateLeaveTypeBody, UpdateLeaveTypeBody, SubmitLeaveBody, SubmitWfhBody, SubmitStandingWfhBody, ListQuery, QueueListQuery, BalanceQuery, CalendarQuery, DecideBody, AdjustBalanceBody } from './validators.js';

export function toLeaveTypeDto(row: repo.LeaveTypeRow): LeaveTypeDto {
  return {
    id: row.id, code: row.code, name: row.name, kind: row.kind,
    accrualDays: row.accrualDays, enforcement: row.enforcement,
    paidLeave: row.paidLeave, isActive: row.isActive,
  };
}

function toRequestSummary(row: repo.LeaveRequestRow, userFullName: string, typeName: string): LeaveRequestSummary {
  return {
    id: row.id, userId: row.userId, userFullName, leaveTypeId: row.leaveTypeId, leaveTypeName: typeName,
    kind: row.kind, fromDate: row.fromDate, toDate: row.toDate,
    fromHalf: row.fromHalf, toHalf: row.toHalf,
    daysConsumed: row.daysConsumed, reason: row.reason, status: row.status,
    requestedBy: row.requestedBy,
    acknowledgedAt: row.acknowledgedAt, decidedAt: row.decidedAt, decisionNote: row.decisionNote,
    revokedAt: row.revokedAt,
    recurrenceType: row.recurrenceType, recurrenceEnd: row.recurrenceEnd, createdAt: row.createdAt,
  };
}

async function allowedActionsFor(
  ctx: RequestContext,
  row: repo.LeaveRequestRow,
): Promise<NonNullable<LeaveRequestSummary['allowedActions']>> {
  const resource = makeLeaveRequestResource(row.id, row.organizationId, row.userId, row.requestedBy);
  const actions = {
    cancel: false,
    acknowledge: false,
    approve: false,
    reject: false,
    revoke: false,
  };
  if (row.status === 'pending') {
    actions.cancel = row.requestedBy === ctx.principal.id && await holdsPolicy(ctx, 'leave:request', resource);
    // HR decides in one step (owner decision, 29 Sep 2026); acknowledging first is optional.
    const decides = await holdsPolicy(ctx, 'leave:decide', resource);
    actions.approve = decides;
    actions.reject = decides;
    actions.acknowledge = !decides && await holdsPolicy(ctx, 'leave:acknowledge', resource);
  } else if (row.status === 'acknowledged') {
    const allowed = await holdsPolicy(ctx, 'leave:decide', resource);
    actions.approve = allowed;
    actions.reject = allowed;
  } else if (row.status === 'approved') {
    actions.revoke = await holdsPolicy(ctx, 'leave:decide', resource);
  }
  return actions;
}

export async function listLeaveTypes(ctx: RequestContext): Promise<LeaveTypeDto[]> {
  return db.transaction(ctx, async (tx) => (await repo.listLeaveTypes(tx)).map(toLeaveTypeDto));
}

export async function listAvailableLeaveTypes(ctx: RequestContext): Promise<LeaveTypeDto[]> {
  return db.transaction(ctx, async (tx) =>
    (await repo.listAvailableAbsenceTypes(tx)).map(toLeaveTypeDto));
}

export async function createLeaveType(ctx: RequestContext, body: CreateLeaveTypeBody): Promise<LeaveTypeDto> {
  return db.transaction(ctx, async (tx) => {
    const orgId = await repo.currentOrganizationId(tx);
    return toLeaveTypeDto(await repo.insertLeaveType(tx, orgId, body, ctx.principal.id));
  });
}

export async function updateLeaveType(ctx: RequestContext, id: string, body: UpdateLeaveTypeBody): Promise<LeaveTypeDto> {
  return db.transaction(ctx, async (tx) => {
    if (!(await repo.findLeaveTypeById(tx, id))) throw new LeaveTypeNotFoundError();
    const patch: Parameters<typeof repo.updateLeaveType>[2] = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.accrualDays !== undefined) patch.accrualDays = body.accrualDays;
    if (body.enforcement !== undefined) patch.enforcement = body.enforcement;
    if (body.paidLeave !== undefined) patch.paidLeave = body.paidLeave;
    if (body.isActive !== undefined) patch.isActive = body.isActive;
    return toLeaveTypeDto(await repo.updateLeaveType(tx, id, patch));
  });
}

export async function submitLeave(ctx: RequestContext, body: SubmitLeaveBody): Promise<LeaveRequestSummary> {
  return db.transaction(ctx, async (tx) => {
    if (body.fromDate.slice(0, 4) !== body.toDate.slice(0, 4)) {
      throw new LeaveValidationError(LEAVE_ERROR_CODES.CROSS_YEAR,
        'Cross-year leave requests are not supported. Submit two separate requests.');
    }
    if (body.toDate < body.fromDate) {
      throw new LeaveValidationError(LEAVE_ERROR_CODES.INVALID_DATES, 'toDate must be >= fromDate');
    }

    const leaveType = await repo.findLeaveTypeById(tx, body.leaveTypeId);
    if (!leaveType || !leaveType.isActive || leaveType.kind !== 'absence') {
      throw new LeaveValidationError(LEAVE_ERROR_CODES.INVALID_KIND, 'Leave type not found or not an absence type');
    }

    await AttendanceFacade.lockPerson(tx, ctx.principal.id);

    const overlaps = await repo.findActiveOverlappingRequests(
      tx, ctx.principal.id, body.fromDate as DateOnly, body.toDate as DateOnly,
      { conflictKinds: ['absence'] },
    );
    if (overlaps.length > 0) {
      throw new LeaveConflictError(LEAVE_ERROR_CODES.OVERLAP, 'Overlaps an existing absence request',
        { conflictId: overlaps[0]!.id });
    }

    const [fromDayType, toDayType] = await Promise.all([
      CalendarFacade.dayType(tx, ctx.principal.id, body.fromDate as DateOnly),
      CalendarFacade.dayType(tx, ctx.principal.id, body.toDate as DateOnly),
    ]);
    const firstDayIsWorking = fromDayType.type === 'working';
    const lastDayIsWorking  = toDayType.type  === 'working';
    const isSingleDay       = body.fromDate === body.toDate;
    const workingDayCount   = await CalendarFacade.leaveDays(tx, ctx.principal.id, body.fromDate as DateOnly, body.toDate as DateOnly);
    const consumed = daysConsumed(
      workingDayCount, body.fromHalf, body.toHalf,
      firstDayIsWorking, lastDayIsWorking, isSingleDay,
    );

    if (leaveType.enforcement && consumed > 0) {
      const year = parseInt(body.fromDate.slice(0, 4));
      const balance = await balanceFor(tx, ctx.principal.id, leaveType, year);
      const free = balance.available - balance.pending;
      if (free < consumed) {
        throw new LeaveValidationError(LEAVE_ERROR_CODES.INSUFFICIENT_BALANCE,
          `Not enough ${leaveType.name} left: ${free} day${free === 1 ? '' : 's'} available` +
          (balance.pending > 0 ? ` after ${balance.pending} day${balance.pending === 1 ? '' : 's'} already requested` : '') +
          `, ${consumed} requested.`,
          { available: balance.available, pending: balance.pending, requested: consumed });
      }
    }

    const orgId = await repo.currentOrganizationId(tx);
    const row = await repo.insertLeaveRequest(tx, {
      organizationId: orgId, userId: ctx.principal.id,
      leaveTypeId: body.leaveTypeId, kind: 'absence',
      fromDate: body.fromDate as DateOnly, toDate: body.toDate as DateOnly,
      fromHalf: body.fromHalf, toHalf: body.toHalf,
      daysConsumed: consumed, reason: body.reason,
      requestedBy: ctx.principal.id,
      recurrenceType: null, recurrenceEnd: null,
    });
    await notifyLeaveRequested(tx, ctx, row, leaveType.name);
    return toRequestSummary(row, '', leaveType.name);
  });
}

export async function getLeaveRequest(ctx: RequestContext, id: string): Promise<LeaveRequestSummary> {
  return db.transaction(ctx, async (tx) => {
    const row = await repo.findLeaveRequestById(tx, id);
    if (!row) throw new LeaveNotFoundError();
    const lt = await repo.findLeaveTypeById(tx, row.leaveTypeId);
    return { ...toRequestSummary(row, '', lt?.name ?? ''), allowedActions: await allowedActionsFor(ctx, row) };
  });
}

export async function listLeaveRequests(ctx: RequestContext, query: ListQuery): Promise<LeaveRequestSummary[]> {
  return db.transaction(ctx, async (tx) => {
    const visibility = await visibilityFilter(ctx, 'leave:view', 'leaveRequest');
    if (isMatchNothing(visibility)) return [];
    const rows = await repo.listLeaveRequests(tx, {
      ...(query.userId !== undefined && { userId: query.userId }),
      ...(query.status !== undefined && { status: query.status }),
      ...(query.fromDate !== undefined && { fromDate: query.fromDate as DateOnly }),
      ...(query.toDate !== undefined && { toDate: query.toDate as DateOnly }),
      ...(query.after !== undefined && { after: query.after }),
      limit: query.limit,
    }, visibility);
    const typeMap = new Map((await repo.listLeaveTypes(tx)).map(t => [t.id, t]));
    return Promise.all(rows.map(async (row) => ({
      ...toRequestSummary(row, row.userFullName, typeMap.get(row.leaveTypeId)?.name ?? ''),
      allowedActions: await allowedActionsFor(ctx, row),
    })));
  });
}

/**
 * Workflow inboxes use the workflow action's scope before querying, then attach
 * state- and A1-aware actions to each visible request. The collection route is
 * authorized with leave:view because acknowledge/decide are approval-bearing
 * actions and the auth engine requires a concrete resource for A1 evaluation.
 */
async function listLeaveWorkflowQueue(
  ctx: RequestContext,
  action: 'leave:acknowledge' | 'leave:decide',
  statuses: readonly string[],
  query: QueueListQuery,
): Promise<LeaveQueueItem[]> {
  return db.transaction(ctx, async (tx) => {
    const visibility = await visibilityFilter(ctx, action, 'leaveRequest');
    if (isMatchNothing(visibility)) return [];
    const rows = await repo.listLeaveRequests(tx, {
      statuses,
      ...(query.fromDate !== undefined && { fromDate: query.fromDate as DateOnly }),
      ...(query.toDate !== undefined && { toDate: query.toDate as DateOnly }),
      ...(query.after !== undefined && { after: query.after }),
      limit: query.limit,
    }, visibility);
    const typeMap = new Map((await repo.listLeaveTypes(tx)).map((type) => [type.id, type]));
    return Promise.all(rows.map(async (row) => {
      return {
        ...toRequestSummary(row, row.userFullName, typeMap.get(row.leaveTypeId)?.name ?? ''),
        allowedActions: await allowedActionsFor(ctx, row),
      };
    }));
  });
}

export function listLeaveAcknowledgements(ctx: RequestContext, query: QueueListQuery): Promise<LeaveQueueItem[]> {
  return listLeaveWorkflowQueue(ctx, 'leave:acknowledge', ['pending'], query);
}

export function listLeaveDecisions(ctx: RequestContext, query: QueueListQuery): Promise<LeaveQueueItem[]> {
  return listLeaveWorkflowQueue(ctx, 'leave:decide', ['pending', 'acknowledged', 'approved'], query);
}

export interface BalanceFigures {
  entitlement: number;
  opening: number;
  accrued: number;
  adjustments: number;
  consumed: number;
  pending: number;
  available: number;
}

/**
 * One person's balance for a type and year: the pro-rated yearly entitlement
 * plus the ledger (opening, accrual, adjustments) less what approved leave
 * used; `pending` is what requests awaiting a decision would use.
 */
async function balanceFor(
  tx: Tx, userId: string, leaveType: repo.LeaveTypeRow, year: number,
): Promise<BalanceFigures> {
  const window = await repo.findEmploymentWindow(tx, userId);
  const entries = await repo.getBalanceEntries(tx, userId, leaveType.id, year);
  return figures(
    yearlyEntitlement(leaveType.accrualDays, year, window?.joinedOn ?? null, window?.leftOn ?? null),
    entries,
    await repo.pendingDays(tx, userId, leaveType.id, year),
  );
}

function figures(
  entitlement: number,
  entries: readonly { kind: string; units: number }[],
  pending: number,
): BalanceFigures {
  const sum = (kind: string) => entries.filter((e) => e.kind === kind).reduce((total, e) => total + e.units, 0);
  const opening = sum('opening');
  const accrued = entitlement + sum('accrual');
  const adjustments = sum('adjustment');
  const consumed = sum('consumption') - sum('reversal');
  return {
    entitlement,
    opening,
    accrued,
    adjustments,
    consumed,
    pending,
    available: Math.round((opening + accrued + adjustments - consumed) * 2) / 2,
  };
}

async function assertBalanceVisible(ctx: RequestContext, tx: Tx, userId: string): Promise<void> {
  const scopeFilter = await visibilityFilter(ctx, 'leave:view', 'leaveRequest');
  if (isMatchNothing(scopeFilter)) {
    throw new LeaveForbiddenError(LEAVE_ERROR_CODES.FORBIDDEN, 'Not authorized to view this user\'s balances');
  }
  // The leaveRequest policy filter only references user_id, requested_by,
  // acknowledged_by, decided_by — all present in this synthetic row.
  const allowed = await tx.maybeOne<{ ok: boolean }>(sql`
    SELECT TRUE AS ok
    FROM (
      SELECT ${userId}::uuid AS user_id,
             NULL::uuid AS requested_by,
             NULL::uuid AS acknowledged_by,
             NULL::uuid AS decided_by
    ) t
    WHERE ${scopeFilter}
  `);
  if (!allowed)
    throw new LeaveForbiddenError(LEAVE_ERROR_CODES.FORBIDDEN, 'Not authorized to view this user\'s balances');
}

export async function getBalances(ctx: RequestContext, userId: string, query: BalanceQuery): Promise<LeaveBalanceDto[]> {
  return db.transaction(ctx, async (tx) => {
    await assertBalanceVisible(ctx, tx, userId);
    const types = await repo.listLeaveTypes(tx);
    const result: LeaveBalanceDto[] = [];
    for (const t of types.filter((type) => type.isActive && type.kind === 'absence')) {
      const balance = await balanceFor(tx, userId, t, query.year);
      result.push({
        leaveTypeId: t.id, leaveTypeName: t.name, enforced: t.enforcement, paid: t.paidLeave,
        ...balance,
      });
    }
    return result;
  });
}

export interface LeaveBalanceOverviewRow {
  userId: string;
  fullName: string;
  employeeId: string | null;
  departmentName: string | null;
  balances: LeaveBalanceDto[];
}

/** Every visible employee's balances for the year — the HR overview. */
export async function getBalanceOverview(ctx: RequestContext, query: BalanceQuery): Promise<LeaveBalanceOverviewRow[]> {
  return db.transaction(ctx, async (tx) => {
    const visibility = await visibilityFilter(ctx, 'leave:view', 'leaveRequest');
    if (isMatchNothing(visibility)) return [];
    const subjects = await repo.listBalanceSubjects(tx, visibility, query.year);
    const ids = subjects.map((s) => s.id);
    const types = (await repo.listLeaveTypes(tx)).filter((type) => type.isActive && type.kind === 'absence');
    const sums = await repo.sumBalanceEntries(tx, ids, query.year);
    const pending = await repo.sumPendingDays(tx, ids, query.year);
    return subjects.map((subject) => ({
      userId: subject.id,
      fullName: subject.fullName,
      employeeId: subject.employeeId,
      departmentName: subject.departmentName,
      balances: types.map((t) => {
        const entries = sums.filter((e) => e.userId === subject.id && e.leaveTypeId === t.id);
        const waiting = pending.find((p) => p.userId === subject.id && p.leaveTypeId === t.id)?.days ?? 0;
        return {
          leaveTypeId: t.id, leaveTypeName: t.name, enforced: t.enforcement, paid: t.paidLeave,
          ...figures(yearlyEntitlement(t.accrualDays, query.year, subject.joinedOn, subject.leftOn), entries, waiting),
        };
      }),
    }));
  });
}

/**
 * HR adjusts a balance: a signed ledger entry with a reason — carried-forward
 * days, a correction, compensatory leave. It never edits past entries.
 */
export async function adjustBalance(
  ctx: RequestContext, userId: string, body: AdjustBalanceBody,
): Promise<LeaveBalanceDto> {
  return db.transaction(ctx, async (tx) => {
    const window = await repo.findEmploymentWindow(tx, userId);
    if (!window) throw new LeaveNotFoundError();
    const leaveType = await repo.findLeaveTypeById(tx, body.leaveTypeId);
    if (!leaveType || leaveType.kind !== 'absence') throw new LeaveTypeNotFoundError();
    const orgId = await repo.currentOrganizationId(tx);
    const entry = await repo.insertBalanceEntry(tx, {
      organizationId: orgId, userId, leaveTypeId: leaveType.id,
      kind: 'adjustment', units: body.units, leaveRequestId: null, periodYear: body.year,
      reason: body.reason, createdBy: ctx.principal.id,
    });
    await tx.query(sql`
      INSERT INTO audit_outbox (organization_id, stream, payload)
      VALUES (${orgId}, 'activity', ${JSON.stringify({
        action: 'leave.balance-adjusted',
        actorId: ctx.principal.id,
        actorType: ctx.principal.accountType,
        targetType: 'leaveBalance',
        targetId: entry.id,
        before: null,
        after: { userId, leaveTypeId: leaveType.id, year: body.year, units: body.units },
        reason: body.reason,
        requestId: ctx.requestId,
        sourceIp: ctx.sourceIp,
      })}::jsonb)
    `);
    const balance = await balanceFor(tx, userId, leaveType, body.year);
    return { leaveTypeId: leaveType.id, leaveTypeName: leaveType.name, enforced: leaveType.enforcement, paid: leaveType.paidLeave, ...balance };
  });
}

export async function cancelLeave(ctx: RequestContext, id: string): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    const seed = await repo.findLeaveRequestById(tx, id);
    if (!seed) throw new LeaveNotFoundError();
    await AttendanceFacade.lockPerson(tx, seed.userId);
    const row = await repo.findLeaveRequestForUpdate(tx, id);
    if (!row) throw new LeaveNotFoundError();
    if (row.requestedBy !== ctx.principal.id)
      throw new LeaveForbiddenError(LEAVE_ERROR_CODES.FORBIDDEN, 'Only your own requests can be cancelled');
    if (row.status !== 'pending')
      throw new LeaveValidationError(LEAVE_ERROR_CODES.INVALID_STATUS,
        'Only pending requests can be cancelled; use decide/revoke for approved requests');
    await repo.updateLeaveRequestStatus(tx, id, { status: 'cancelled' });
  });
}

export async function getLeaveCalendar(ctx: RequestContext, query: CalendarQuery): Promise<LeaveCalendarEvent[]> {
  return db.transaction(ctx, async (tx) => {
    const pad      = (n: number) => String(n).padStart(2, '0');
    const fromDate = `${query.year}-${pad(query.month)}-01` as DateOnly;
    const lastDay  = new Date(query.year, query.month, 0).getDate();
    const toDate   = `${query.year}-${pad(query.month)}-${pad(lastDay)}` as DateOnly;
    const scopeFilter = await visibilityFilter(ctx, 'leave:view', 'leaveRequest');
    if (isMatchNothing(scopeFilter)) return [];
    const rows = await repo.listLeaveRequests(tx, {
      ...(query.userId !== undefined && { userId: query.userId }),
      fromDate, toDate, limit: 500,
    }, scopeFilter);
    const typeMap = new Map((await repo.listLeaveTypes(tx)).map(t => [t.id, t]));
    const events: LeaveCalendarEvent[] = [];
    for (const r of rows.filter(r => r.status !== 'cancelled')) {
      const lt = typeMap.get(r.leaveTypeId);
      for (let d = r.fromDate; d <= r.toDate; d = addDays(d, 1)) {
        if (d >= fromDate && d <= toDate)
          events.push({ date: d, kind: r.kind, status: r.status,
            leaveTypeName: lt?.name ?? '', requestId: r.id });
      }
    }
    return events;
  });
}

export async function submitWfh(ctx: RequestContext, body: SubmitWfhBody): Promise<LeaveRequestSummary> {
  return db.transaction(ctx, async (tx) => {
    if (body.toDate < body.fromDate)
      throw new LeaveValidationError(LEAVE_ERROR_CODES.INVALID_DATES, 'toDate must be >= fromDate');
    if (body.fromDate.slice(0, 4) !== body.toDate.slice(0, 4))
      throw new LeaveValidationError(LEAVE_ERROR_CODES.CROSS_YEAR,
        'Cross-year WFH requests are not supported.');

    const leaveType = await repo.findLeaveTypeById(tx, body.leaveTypeId);
    if (!leaveType || !leaveType.isActive || leaveType.kind !== 'attendance-mode')
      throw new LeaveValidationError(LEAVE_ERROR_CODES.INVALID_KIND, 'Not a WFH leave type');

    await AttendanceFacade.lockPerson(tx, ctx.principal.id);
    const overlaps = await repo.findActiveOverlappingRequests(
      tx, ctx.principal.id, body.fromDate as DateOnly, body.toDate as DateOnly,
      { conflictKinds: ['absence', 'attendance-mode'] },
    );
    if (overlaps.length > 0)
      throw new LeaveConflictError(LEAVE_ERROR_CODES.OVERLAP, 'Overlaps an existing request',
        { conflictId: overlaps[0]!.id });

    const orgId = await repo.currentOrganizationId(tx);
    const row = await repo.insertLeaveRequest(tx, {
      organizationId: orgId, userId: ctx.principal.id,
      leaveTypeId: body.leaveTypeId, kind: 'attendance-mode',
      fromDate: body.fromDate as DateOnly, toDate: body.toDate as DateOnly,
      fromHalf: 'full', toHalf: 'full', daysConsumed: 0,
      reason: body.reason, requestedBy: ctx.principal.id,
      recurrenceType: null, recurrenceEnd: null,
    });
    await notifyLeaveRequested(tx, ctx, row, leaveType.name);
    return toRequestSummary(row, '', leaveType.name);
  });
}

export async function submitStandingWfh(ctx: RequestContext, body: SubmitStandingWfhBody): Promise<LeaveRequestSummary> {
  return db.transaction(ctx, async (tx) => {
    if (body.recurrenceEnd < body.fromDate)
      throw new LeaveValidationError(LEAVE_ERROR_CODES.INVALID_DATES, 'recurrenceEnd must be >= fromDate');
    if (body.fromDate.slice(0, 4) !== body.recurrenceEnd.slice(0, 4))
      throw new LeaveValidationError(LEAVE_ERROR_CODES.CROSS_YEAR,
        'Standing WFH may not span calendar years. Submit one per year.');

    const leaveType = await repo.findLeaveTypeById(tx, body.leaveTypeId);
    if (!leaveType || !leaveType.isActive || leaveType.kind !== 'attendance-mode')
      throw new LeaveValidationError(LEAVE_ERROR_CODES.INVALID_KIND, 'Not a WFH leave type');

    await AttendanceFacade.lockPerson(tx, ctx.principal.id);
    const overlaps = await repo.findActiveOverlappingRequests(
      tx, ctx.principal.id, body.fromDate as DateOnly, body.recurrenceEnd as DateOnly,
      { conflictKinds: ['absence', 'attendance-mode'] },
    );
    if (overlaps.length > 0)
      throw new LeaveConflictError(LEAVE_ERROR_CODES.OVERLAP, 'Overlaps an existing request',
        { conflictId: overlaps[0]!.id });

    const orgId = await repo.currentOrganizationId(tx);
    const row = await repo.insertLeaveRequest(tx, {
      organizationId: orgId, userId: ctx.principal.id,
      leaveTypeId: body.leaveTypeId, kind: 'attendance-mode',
      fromDate: body.fromDate as DateOnly, toDate: body.recurrenceEnd as DateOnly,
      fromHalf: 'full', toHalf: 'full', daysConsumed: 0,
      reason: body.reason, requestedBy: ctx.principal.id,
      recurrenceType: 'daily', recurrenceEnd: body.recurrenceEnd as DateOnly,
    });
    await notifyLeaveRequested(tx, ctx, row, leaveType.name);
    return toRequestSummary(row, '', leaveType.name);
  });
}

export async function acknowledgeLeave(
  ctx: RequestContext, id: string, clock: Clock = systemClock,
): Promise<LeaveRequestSummary> {
  return db.transaction(ctx, async (tx) => {
    // Stable lock ordering: read id→userId without locking, then advisory lock, then FOR UPDATE.
    const seed = await repo.findLeaveRequestById(tx, id);
    if (!seed) throw new LeaveNotFoundError();
    await AttendanceFacade.lockPerson(tx, seed.userId);
    const row = await repo.findLeaveRequestForUpdate(tx, id);
    if (!row) throw new LeaveNotFoundError();
    if (row.requestedBy === ctx.principal.id)
      throw new LeaveForbiddenError(LEAVE_ERROR_CODES.SELF_ACKNOWLEDGE, 'Cannot acknowledge your own request (A1)');
    if (row.status !== 'pending')
      throw new LeaveValidationError(LEAVE_ERROR_CODES.INVALID_STATUS,
        `Cannot acknowledge a request in status '${row.status}'`);
    const now = clock.now();
    const updated = await repo.updateLeaveRequestStatus(tx, id, {
      status: 'acknowledged',
      acknowledgedBy: ctx.principal.id,
      acknowledgedAt: now,
    });
    const lt = await repo.findLeaveTypeById(tx, updated.leaveTypeId);
    return toRequestSummary(updated, '', lt?.name ?? '');
  });
}

/**
 * WFH-7 persistent precedence rule. Must be called after any event that changes
 * absence or WFH approval state for a date. The caller's transaction must have
 * already committed the status change so the queries here see current state.
 *
 *   approved absence on date  → WFH overlay/day must not exist
 *   approved WFH, no absence  → WFH overlay/day must exist (if working day)
 *   neither                   → WFH overlay/day must not exist
 */
export async function reconcileWfhForDate(
  tx: Tx,
  userId: string,
  date: DateOnly,
  orgId: string,
  clock: Clock = systemClock,
): Promise<void> {
  await AttendanceFacade.lockPerson(tx, userId);
  const hasAbsence  = !!(await repo.findApprovedAbsenceForDate(tx, userId, date));
  const approvedWfh = await repo.findApprovedWfhOverlapping(tx, userId, date, date);

  if (hasAbsence || approvedWfh.length === 0) {
    for (const wfh of approvedWfh) {
      await AttendanceFacade.removeOverlayForDate(tx, userId, wfh.id, date, clock);
      await repo.deleteWfhDayByRequestAndDate(tx, orgId, userId, wfh.id, date);
    }
    return;
  }
  const resolved = await CalendarFacade.dayType(tx, userId, date);
  if (resolved.type !== 'working') return;
  for (const wfh of approvedWfh) {
    if (await repo.existsWfhDay(tx, userId, date)) continue;
    await AttendanceFacade.applyOverlay(tx, {
      sourceKind: 'wfh', sourceId: wfh.id, userId, workDate: date, kind: 'wfh',
    });
    await repo.upsertWfhDay(tx, {
      organizationId: orgId, userId, workDate: date,
      reason: wfh.reason, approvedBy: wfh.decidedBy!, leaveRequestId: wfh.id,
    });
  }
}

export async function decideLeave(
  ctx: RequestContext, id: string, body: DecideBody, clock: Clock = systemClock,
): Promise<LeaveRequestSummary> {
  return db.transaction(ctx, async (tx) => {
    const seed = await repo.findLeaveRequestById(tx, id);
    if (!seed) throw new LeaveNotFoundError();
    await AttendanceFacade.lockPerson(tx, seed.userId);
    const row = await repo.findLeaveRequestForUpdate(tx, id);
    if (!row) throw new LeaveNotFoundError();

    const orgId = await repo.currentOrganizationId(tx);
    const now   = clock.now();

    if (body.decision === 'revoked') {
      if (row.status !== 'approved')
        throw new LeaveValidationError(LEAVE_ERROR_CODES.INVALID_STATUS, 'Only approved requests can be revoked');

      await AttendanceFacade.removeOverlays(tx, row.kind === 'absence' ? 'leave' : 'wfh', id);
      await repo.deleteWfhDaysByRequest(tx, orgId, id);

      const leaveType = await repo.findLeaveTypeById(tx, row.leaveTypeId);
      if (row.kind === 'absence' && row.daysConsumed > 0 && await repo.hasConsumption(tx, id)) {
        await repo.insertBalanceEntry(tx, {
          organizationId: orgId, userId: row.userId, leaveTypeId: row.leaveTypeId,
          kind: 'reversal', units: row.daysConsumed,
          leaveRequestId: id, periodYear: parseInt(row.fromDate.slice(0, 4)),
        });
      }

      const updated = await repo.updateLeaveRequestStatus(tx, id, {
        status: 'cancelled',
        revokedBy: ctx.principal.id, revokedAt: now,
      });

      if (row.kind === 'absence') {
        for (let date = row.fromDate; date <= row.toDate; date = addDays(date, 1)) {
          await reconcileWfhForDate(tx, row.userId, date, orgId, clock);
        }
      }

      await recordLeaveDecided(tx, orgId, {
        requestId: id, userId: row.userId, leaveTypeId: row.leaveTypeId,
        kind: row.kind, fromDate: row.fromDate, toDate: row.toDate,
        outcome: 'revoked', daysConsumed: row.daysConsumed,
      });
      await notifyLeaveDecided(tx, ctx, row, 'revoked', leaveType?.name ?? 'leave', body.decisionNote);
      return toRequestSummary(updated, '', leaveType?.name ?? '');
    }

    if (body.decision === 'rejected') {
      if (row.status !== 'acknowledged' && row.status !== 'pending')
        throw new LeaveValidationError(LEAVE_ERROR_CODES.INVALID_STATUS,
          `Cannot reject a request in status '${row.status}'`);
      if (row.requestedBy === ctx.principal.id)
        throw new LeaveForbiddenError(LEAVE_ERROR_CODES.SELF_DECIDE, 'Cannot decide your own request (A1)');
      const updated = await repo.updateLeaveRequestStatus(tx, id, {
        status: 'rejected', decidedBy: ctx.principal.id, decidedAt: now,
        // Decided in one step: the decider acknowledged it too.
        ...(row.acknowledgedBy === null && { acknowledgedBy: ctx.principal.id, acknowledgedAt: now }),
        ...(body.decisionNote !== undefined && { decisionNote: body.decisionNote }),
      });
      await recordLeaveDecided(tx, orgId, {
        requestId: id, userId: row.userId, leaveTypeId: row.leaveTypeId,
        kind: row.kind, fromDate: row.fromDate, toDate: row.toDate,
        outcome: 'rejected', daysConsumed: 0,
      });
      const lt = await repo.findLeaveTypeById(tx, updated.leaveTypeId);
      await notifyLeaveDecided(tx, ctx, row, 'rejected', lt?.name ?? 'leave', body.decisionNote);
      return toRequestSummary(updated, '', lt?.name ?? '');
    }

    // decision === 'approved' — from pending (HR decides in one step) or acknowledged
    if (row.status !== 'acknowledged' && row.status !== 'pending')
      throw new LeaveValidationError(LEAVE_ERROR_CODES.INVALID_STATUS,
        `Cannot approve a request in status '${row.status}'`);
    if (row.requestedBy === ctx.principal.id)
      throw new LeaveForbiddenError(LEAVE_ERROR_CODES.SELF_DECIDE, 'Cannot decide your own request (A1)');

    const leaveType = await repo.findLeaveTypeById(tx, row.leaveTypeId);

    if (leaveType?.enforcement && row.kind === 'absence' && row.daysConsumed > 0) {
      const year    = parseInt(row.fromDate.slice(0, 4));
      const balance = await balanceFor(tx, row.userId, leaveType, year);
      if (balance.available < row.daysConsumed) {
        throw new LeaveValidationError(LEAVE_ERROR_CODES.INSUFFICIENT_BALANCE,
          `Not enough ${leaveType.name} left to approve: ${balance.available} day${balance.available === 1 ? '' : 's'} available, ${row.daysConsumed} requested.`,
          { available: balance.available, requested: row.daysConsumed });
      }
    }

    const today = await organizationToday(tx);

    const updated = await repo.updateLeaveRequestStatus(tx, id, {
      status: 'approved', decidedBy: ctx.principal.id, decidedAt: now,
      ...(row.acknowledgedBy === null && { acknowledgedBy: ctx.principal.id, acknowledgedAt: now }),
      ...(body.decisionNote !== undefined && { decisionNote: body.decisionNote }),
    });

    if (row.kind === 'absence') {
      for (let date = row.fromDate; date <= row.toDate; date = addDays(date, 1)) {
        const resolved = await CalendarFacade.dayType(tx, row.userId, date);
        if (resolved.type !== 'working') continue;
        const overlayKind = overlayKindForDay(date, row.fromDate, row.toDate,
          row.fromHalf, row.toHalf);
        await AttendanceFacade.applyOverlay(tx, {
          sourceKind: 'leave', sourceId: id,
          userId: row.userId, workDate: date, kind: overlayKind,
          paid: leaveType?.paidLeave ?? null,
        });
        await reconcileWfhForDate(tx, row.userId, date, orgId, clock);
      }
      // Approved leave always records what it used, limit or not. A pending or
      // acknowledged request has never been approved, so it has no consumption
      // yet: one already there is an anomaly and the unique index refuses it,
      // rolling the whole approval back.
      if (row.daysConsumed > 0) {
        await repo.insertBalanceEntry(tx, {
          organizationId: orgId, userId: row.userId, leaveTypeId: row.leaveTypeId,
          kind: 'consumption', units: row.daysConsumed,
          leaveRequestId: id, periodYear: parseInt(row.fromDate.slice(0, 4)),
        });
      }
    } else {
      const isStanding = row.recurrenceType === 'daily';
      const rangeEnd   = isStanding
        ? (row.recurrenceEnd! < addDays(today, 60) ? row.recurrenceEnd! : addDays(today, 60))
        : row.toDate;
      const rangeStart = isStanding
        ? (row.fromDate > today ? row.fromDate : today)
        : row.fromDate;

      for (let date = rangeStart; date <= rangeEnd; date = addDays(date, 1)) {
        await reconcileWfhForDate(tx, row.userId, date, orgId, clock);
      }
    }

    await recordLeaveDecided(tx, orgId, {
      requestId: id, userId: row.userId, leaveTypeId: row.leaveTypeId,
      kind: row.kind, fromDate: row.fromDate, toDate: row.toDate,
      outcome: 'approved', daysConsumed: row.daysConsumed,
    });
    await notifyLeaveDecided(tx, ctx, row, 'approved', leaveType?.name ?? 'leave', body.decisionNote);
    return toRequestSummary(updated, '', leaveType?.name ?? '');
  });
}
