import type { LeaveTypeDto, LeaveRequestSummary, LeaveBalanceDto, LeaveCalendarEvent, DateOnly } from '@tapcrm/contracts';
import { isMatchNothing, visibilityFilter } from '@tapcrm/authz';
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
import { daysConsumed, balanceAvailable, overlayKindForDay } from './rules.js';
import * as repo from './repository.js';
import type { CreateLeaveTypeBody, UpdateLeaveTypeBody, SubmitLeaveBody, SubmitWfhBody, SubmitStandingWfhBody, ListQuery, BalanceQuery, CalendarQuery, DecideBody } from './validators.js';

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
    fromHalf: row.fromHalf as any, toHalf: row.toHalf as any,
    daysConsumed: row.daysConsumed, reason: row.reason, status: row.status as any,
    requestedBy: row.requestedBy,
    acknowledgedAt: row.acknowledgedAt, decidedAt: row.decidedAt, decisionNote: row.decisionNote,
    revokedAt: row.revokedAt,
    recurrenceType: row.recurrenceType, recurrenceEnd: row.recurrenceEnd, createdAt: row.createdAt,
  };
}

export async function listLeaveTypes(ctx: RequestContext): Promise<LeaveTypeDto[]> {
  return db.transaction(ctx, async (tx) => (await repo.listLeaveTypes(tx)).map(toLeaveTypeDto));
}

export async function createLeaveType(ctx: RequestContext, body: CreateLeaveTypeBody): Promise<LeaveTypeDto> {
  if (body.enforcement)
    throw new LeaveValidationError(LEAVE_ERROR_CODES.ENFORCEMENT_NOT_ENABLED,
      'Enforcement cannot be enabled until opening balances are seeded (leave go-live task).');
  return db.transaction(ctx, async (tx) => {
    const orgId = await repo.currentOrganizationId(tx);
    return toLeaveTypeDto(await repo.insertLeaveType(tx, orgId, body, ctx.principal.id));
  });
}

export async function updateLeaveType(ctx: RequestContext, id: string, body: UpdateLeaveTypeBody): Promise<LeaveTypeDto> {
  if (body.enforcement === true)
    throw new LeaveValidationError(LEAVE_ERROR_CODES.ENFORCEMENT_NOT_ENABLED,
      'Enforcement cannot be enabled until opening balances are seeded (leave go-live task).');
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
      const entries = await repo.getBalanceEntries(tx, ctx.principal.id, body.leaveTypeId, year);
      const available = balanceAvailable(entries);
      if (available < consumed) {
        throw new LeaveValidationError(LEAVE_ERROR_CODES.INSUFFICIENT_BALANCE,
          `Insufficient balance: ${available} days available, ${consumed} requested`);
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
    return toRequestSummary(row, '', leaveType.name);
  });
}

export async function getLeaveRequest(ctx: RequestContext, id: string): Promise<LeaveRequestSummary> {
  return db.transaction(ctx, async (tx) => {
    const row = await repo.findLeaveRequestById(tx, id);
    if (!row) throw new LeaveNotFoundError();
    const lt = await repo.findLeaveTypeById(tx, row.leaveTypeId);
    return toRequestSummary(row, '', lt?.name ?? '');
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
    return rows.map(r => toRequestSummary(r, '', typeMap.get(r.leaveTypeId)?.name ?? ''));
  });
}

export async function getBalances(ctx: RequestContext, userId: string, query: BalanceQuery): Promise<LeaveBalanceDto[]> {
  return db.transaction(ctx, async (tx) => {
    const scopeFilter = await visibilityFilter(ctx, 'leave:view', 'leaveRequest');
    if (!isMatchNothing(scopeFilter)) {
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
    } else {
      throw new LeaveForbiddenError(LEAVE_ERROR_CODES.FORBIDDEN, 'Not authorized to view this user\'s balances');
    }

    const types = await repo.listLeaveTypes(tx);
    return Promise.all(
      types.filter(t => t.isActive && t.kind === 'absence').map(async (t) => {
        const entries = await repo.getBalanceEntries(tx, userId, t.id, query.year);
        const opening  = entries.filter(e => e.kind === 'opening').reduce((s, e) => s + e.units, 0);
        const accrued  = entries.filter(e => e.kind === 'accrual').reduce((s, e) => s + e.units, 0);
        const consumed = entries.filter(e => e.kind === 'consumption').reduce((s, e) => s + e.units, 0);
        const reversed = entries.filter(e => e.kind === 'reversal').reduce((s, e) => s + e.units, 0);
        return { leaveTypeId: t.id, leaveTypeName: t.name, opening, accrued, consumed,
          available: opening + accrued - consumed + reversed };
      }),
    );
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
    const userId   = query.userId ?? ctx.principal.id;
    const pad      = (n: number) => String(n).padStart(2, '0');
    const fromDate = `${query.year}-${pad(query.month)}-01` as DateOnly;
    const lastDay  = new Date(query.year, query.month, 0).getDate();
    const toDate   = `${query.year}-${pad(query.month)}-${pad(lastDay)}` as DateOnly;
    const scopeFilter = await visibilityFilter(ctx, 'leave:view', 'leaveRequest');
    if (isMatchNothing(scopeFilter)) return [];
    const rows = await repo.listLeaveRequests(tx, { userId, fromDate, toDate, limit: 500 }, scopeFilter);
    const typeMap = new Map((await repo.listLeaveTypes(tx)).map(t => [t.id, t]));
    const events: LeaveCalendarEvent[] = [];
    for (const r of rows.filter(r => r.status !== 'cancelled')) {
      const lt = typeMap.get(r.leaveTypeId);
      for (let d = r.fromDate; d <= r.toDate; d = addDays(d, 1)) {
        if (d >= fromDate && d <= toDate)
          events.push({ date: d, kind: r.kind, status: r.status as any,
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
      if (leaveType?.enforcement && row.kind === 'absence' && row.daysConsumed > 0) {
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
      return toRequestSummary(updated, '', leaveType?.name ?? '');
    }

    if (body.decision === 'rejected') {
      if (row.status !== 'acknowledged')
        throw new LeaveValidationError(LEAVE_ERROR_CODES.INVALID_STATUS,
          `Cannot reject a request in status '${row.status}'`);
      if (row.requestedBy === ctx.principal.id)
        throw new LeaveForbiddenError(LEAVE_ERROR_CODES.SELF_DECIDE, 'Cannot decide your own request (A1)');
      const updated = await repo.updateLeaveRequestStatus(tx, id, {
        status: 'rejected', decidedBy: ctx.principal.id, decidedAt: now,
        ...(body.decisionNote !== undefined && { decisionNote: body.decisionNote }),
      });
      await recordLeaveDecided(tx, orgId, {
        requestId: id, userId: row.userId, leaveTypeId: row.leaveTypeId,
        kind: row.kind, fromDate: row.fromDate, toDate: row.toDate,
        outcome: 'rejected', daysConsumed: 0,
      });
      const lt = await repo.findLeaveTypeById(tx, updated.leaveTypeId);
      return toRequestSummary(updated, '', lt?.name ?? '');
    }

    // decision === 'approved'
    if (row.status !== 'acknowledged')
      throw new LeaveValidationError(LEAVE_ERROR_CODES.INVALID_STATUS,
        `Cannot approve a request in status '${row.status}'`);
    if (row.requestedBy === ctx.principal.id)
      throw new LeaveForbiddenError(LEAVE_ERROR_CODES.SELF_DECIDE, 'Cannot decide your own request (A1)');

    const leaveType = await repo.findLeaveTypeById(tx, row.leaveTypeId);

    if (leaveType?.enforcement && row.kind === 'absence' && row.daysConsumed > 0) {
      const year    = parseInt(row.fromDate.slice(0, 4));
      const entries = await repo.getBalanceEntries(tx, row.userId, row.leaveTypeId, year);
      if (balanceAvailable(entries) < row.daysConsumed) {
        throw new LeaveValidationError(LEAVE_ERROR_CODES.INSUFFICIENT_BALANCE,
          'Insufficient balance at approval time (may have changed since submission)');
      }
    }

    const today = await organizationToday(tx);

    const updated = await repo.updateLeaveRequestStatus(tx, id, {
      status: 'approved', decidedBy: ctx.principal.id, decidedAt: now,
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
      if (leaveType?.enforcement && row.daysConsumed > 0) {
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
    return toRequestSummary(updated, '', leaveType?.name ?? '');
  });
}
