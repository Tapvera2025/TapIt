import { authorize, holdsPolicy, visibilityFilter, type Resource } from '@tapcrm/authz';
import type { DateOnly, ResolvedShift } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { organizationToday } from '../../platform/organization-time.js';
import { addDays, daysBetween, systemClock, type Clock } from '../../platform/time.js';
import {
  SHIFT_ERROR_CODES,
  ShiftConflictError,
  ShiftForbiddenError,
  ShiftNotFoundError,
  ShiftValidationError,
} from './errors.js';
import { recordDaysChanged } from './events.js';
import * as repo from './repository.js';
import { resolveShift, type AssignmentInput, type ShiftInputs } from './resolve.js';
import { findWindowOverlaps, validateVersion } from './rules.js';
import type {
  AssignmentBody,
  CreateShiftBody,
  DecideBody,
  ReviseShiftBody,
  VersionBody,
} from './validators.js';
import { dayWindow } from './windows.js';

/** The explorer answers at most this many days at a time. */
export const EXPLAIN_MAX_DAYS = 62;

/* ------------------------------------------------------------------ *
 * Shared checks
 * ------------------------------------------------------------------ */

/**
 * SH-6 — a change that takes effect before today (the organization's date)
 * rewrites days already worked, so it needs `attendance:correct` as well.
 */
async function assertMayChangeFrom(
  ctx: RequestContext,
  tx: Tx,
  from: DateOnly,
  clock: Clock,
): Promise<void> {
  if (from >= (await organizationToday(tx, clock))) return;
  if (await holdsPolicy(ctx, 'attendance:correct')) return;
  throw new ShiftForbiddenError(
    SHIFT_ERROR_CODES.PAST_CHANGE_NEEDS_CORRECTION_AUTHORITY,
    'This change starts before today. Changing days already worked also needs attendance:correct (SH-6).',
  );
}

function subjectResource(ctx: RequestContext, subject: repo.Subject): Resource {
  return {
    type: 'shift',
    id: subject.id,
    organizationId: ctx.organizationId,
    userId: subject.id,
    teamId: subject.teamId,
    departmentId: subject.departmentId,
  };
}

/** The person must exist, and be inside the caller's scope for `action`. */
async function loadSubject(
  ctx: RequestContext,
  tx: Tx,
  userId: string,
  action: 'shifts:view' | 'shifts:manage',
) {
  const subject = await repo.findSubject(tx, userId);
  if (subject === null)
    throw new ShiftNotFoundError('No such person in this organization.');
  await authorize(ctx, action, subjectResource(ctx, subject));
  return subject;
}

async function assertAssignable(tx: Tx, shiftId: string): Promise<void> {
  const shift = await repo.findShift(tx, shiftId);
  if (shift === null) throw new ShiftNotFoundError('No such shift template.');
  // SH-5: inactive templates cannot be newly assigned; existing assignments keep resolving.
  if (shift.status !== 'active') {
    throw new ShiftValidationError(
      SHIFT_ERROR_CODES.INACTIVE,
      `Shift ${shift.code} is inactive and cannot be assigned.`,
    );
  }
  if (!(await repo.hasVersion(tx, shiftId))) {
    throw new ShiftValidationError(
      SHIFT_ERROR_CODES.NO_VERSION,
      `Shift ${shift.code} has no version yet.`,
    );
  }
}

/** §6.3 "No overlap" — refuse a change that makes two consecutive shifts overlap. */
function assertNoOverlap(inputs: ShiftInputs, from: DateOnly, to: DateOnly | null): void {
  const overlaps = findWindowOverlaps(inputs, from, to);
  if (overlaps.length === 0) return;
  const first = overlaps[0]!;
  throw new ShiftValidationError(
    SHIFT_ERROR_CODES.WINDOW_OVERLAP,
    `On ${first.date} this shift would start ${first.overlapMinutes} minutes before the previous day's shift ends.`,
    { overlaps },
  );
}

/** The person's inputs with a proposed assignment in place, for the overlap check. */
function withAssignment(
  inputs: ShiftInputs,
  next: AssignmentInput,
  rotationDays?: ReadonlyMap<number, string | null>,
): ShiftInputs {
  const assignments = inputs.assignments
    .filter((row) => row.kind !== next.kind || row.effectiveFrom < next.effectiveFrom)
    .map((row) =>
      row.kind === next.kind &&
      (row.effectiveTo === null || row.effectiveTo > next.effectiveFrom)
        ? { ...row, effectiveTo: next.effectiveFrom }
        : row,
    );
  const rotations = new Map(inputs.rotations);
  if (rotationDays !== undefined && next.rotationId !== null)
    rotations.set(next.rotationId, rotationDays);
  return { ...inputs, assignments: [...assignments, next], rotations };
}

function checkRange(to: DateOnly | null, from: DateOnly): DateOnly {
  return to === null ? addDays(from, 7) : addDays(to, -1);
}

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

export async function listShiftTemplates(
  ctx: RequestContext,
  clock: Clock = systemClock,
) {
  return db.transaction(ctx, async (tx) =>
    repo.listShifts(tx, await organizationToday(tx, clock)),
  );
}

function versionFields(kind: 'fixed' | 'flexible', body: VersionBody) {
  validateVersion({ kind, ...body });
  return body;
}

export async function createShift(
  ctx: RequestContext,
  body: CreateShiftBody,
  clock: Clock = systemClock,
) {
  const version = versionFields(body.kind, body.version);
  return db.transaction(ctx, async (tx) => {
    const effectiveFrom = version.effectiveFrom ?? (await organizationToday(tx, clock));
    await assertMayChangeFrom(ctx, tx, effectiveFrom, clock);
    const shiftId = await repo.insertShift(tx, {
      organizationId: ctx.organizationId,
      code: body.code,
      name: body.name,
      kind: body.kind,
      createdBy: ctx.principal.id,
    });
    if (shiftId === null) {
      throw new ShiftConflictError(
        SHIFT_ERROR_CODES.CODE_TAKEN,
        `A shift with code ${body.code} already exists.`,
      );
    }
    await repo.insertVersion(tx, {
      ...version,
      organizationId: ctx.organizationId,
      shiftId,
      effectiveFrom,
      createdBy: ctx.principal.id,
    });
    return { id: shiftId, effectiveFrom };
  });
}

/**
 * PATCH /api/shifts/:id — a new version from its effective date (default
 * tomorrow), or a status change. Nothing before the date changes (SH-2).
 */
export async function reviseShift(
  ctx: RequestContext,
  shiftId: string,
  body: ReviseShiftBody,
  clock: Clock = systemClock,
) {
  return db.transaction(ctx, async (tx) => {
    const shift = await repo.findShift(tx, shiftId);
    if (shift === null) throw new ShiftNotFoundError('No such shift template.');
    if ('status' in body) {
      await repo.setShiftStatus(tx, shiftId, body.status);
      return { id: shiftId, status: body.status };
    }
    const version = versionFields(shift.kind, body.version);
    const effectiveFrom =
      version.effectiveFrom ?? addDays(await organizationToday(tx, clock), 1);
    await assertMayChangeFrom(ctx, tx, effectiveFrom, clock);
    const inserted = await repo.insertVersion(tx, {
      ...version,
      organizationId: ctx.organizationId,
      shiftId,
      effectiveFrom,
      createdBy: ctx.principal.id,
    });
    if (!inserted) {
      throw new ShiftConflictError(
        SHIFT_ERROR_CODES.VERSION_EXISTS,
        `Shift ${shift.code} already has a version starting ${effectiveFrom}.`,
      );
    }
    await recordDaysChanged(tx, ctx.organizationId, {
      shiftId,
      from: effectiveFrom,
      to: null,
      reason: 'shift version',
    });
    return { id: shiftId, effectiveFrom };
  });
}

/* ------------------------------------------------------------------ *
 * Assignments — POST /api/shifts/assignments
 * ------------------------------------------------------------------ */

export async function assign(
  ctx: RequestContext,
  body: AssignmentBody,
  clock: Clock = systemClock,
) {
  return db.transaction(ctx, async (tx) => {
    if (body.kind === 'department-default') {
      if (!(await repo.departmentExists(tx, body.departmentId)))
        throw new ShiftNotFoundError('No such department.');
      await authorize(ctx, 'shifts:manage', {
        type: 'shift',
        id: body.departmentId,
        organizationId: ctx.organizationId,
        departmentId: body.departmentId,
      });
      await assertMayChangeFrom(ctx, tx, body.effectiveFrom, clock);
      await assertAssignable(tx, body.shiftId);
      const later = await repo.endDepartmentDefaultsFrom(
        tx,
        body.departmentId,
        body.effectiveFrom,
      );
      if (later.length > 0) {
        throw new ShiftConflictError(
          SHIFT_ERROR_CODES.ASSIGNMENT_CONFLICT,
          'A later default already exists for this department.',
          { ids: later },
        );
      }
      // A default changed under existing assignments can still meet an overlap;
      // the resolver flags that day at read time (§5.2).
      const id = await repo.insertDepartmentDefault(tx, {
        organizationId: ctx.organizationId,
        departmentId: body.departmentId,
        shiftId: body.shiftId,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo,
        createdBy: ctx.principal.id,
      });
      await recordDaysChanged(tx, ctx.organizationId, {
        departmentId: body.departmentId,
        from: body.effectiveFrom,
        to: body.effectiveTo === null ? null : addDays(body.effectiveTo, -1),
        reason: 'department default',
      });
      return { id };
    }

    await loadSubject(ctx, tx, body.userId, 'shifts:manage');

    if (body.kind === 'override') {
      await assertMayChangeFrom(ctx, tx, body.workDate, clock);
      if (body.override === 'shift') {
        if (body.shiftId === null) {
          throw new ShiftValidationError(
            SHIFT_ERROR_CODES.OVERRIDE_NEEDS_SHIFT,
            'A shift override names the shift.',
          );
        }
        await assertAssignable(tx, body.shiftId);
      }
      const shiftId = body.override === 'shift' ? body.shiftId : null;
      const inputs = await repo.loadShiftInputs(
        tx,
        body.userId,
        addDays(body.workDate, -1),
        addDays(body.workDate, 1),
      );
      assertNoOverlap(
        {
          ...inputs,
          overrides: [
            ...inputs.overrides.filter((row) => row.workDate !== body.workDate),
            { workDate: body.workDate, kind: body.override, shiftId },
          ],
        },
        body.workDate,
        body.workDate,
      );
      await repo.replaceOverride(tx, {
        organizationId: ctx.organizationId,
        userId: body.userId,
        workDate: body.workDate,
        kind: body.override,
        shiftId,
        reason: body.reason,
        originRequestId: null,
        createdBy: ctx.principal.id,
      });
      await recordDaysChanged(tx, ctx.organizationId, {
        userIds: [body.userId],
        from: body.workDate,
        to: body.workDate,
        reason: 'date override',
      });
      return { userId: body.userId, workDate: body.workDate };
    }

    await assertMayChangeFrom(ctx, tx, body.effectiveFrom, clock);
    let shiftId: string | null = null;
    let rotationId: string | null = null;
    let rotationDays: Map<number, string | null> | undefined;
    if (body.kind === 'template') {
      await assertAssignable(tx, body.shiftId);
      shiftId = body.shiftId;
    }
    if (body.kind === 'rotation') {
      if ('id' in body.rotation) {
        const days = await repo.rotationShiftIds(tx, body.rotation.id);
        if (days === null) throw new ShiftNotFoundError('No such rotation.');
        rotationId = body.rotation.id;
        rotationDays = new Map(days.map((id, index) => [index + 1, id]));
      } else {
        rotationDays = new Map(
          Object.entries(body.rotation.days).map(([weekday, id]) => [
            Number(weekday),
            id,
          ]),
        );
        for (const id of new Set(rotationDays.values()))
          if (id !== null) await assertAssignable(tx, id);
        rotationId = await repo.insertRotation(tx, {
          organizationId: ctx.organizationId,
          name: body.rotation.name,
          days: rotationDays,
          createdBy: ctx.principal.id,
        });
      }
    }

    const next: AssignmentInput = {
      kind: body.kind,
      shiftId,
      rotationId,
      effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo,
    };
    const lastChecked = checkRange(body.effectiveTo, body.effectiveFrom);
    const inputs = await repo.loadShiftInputs(
      tx,
      body.userId,
      addDays(body.effectiveFrom, -1),
      lastChecked,
    );
    assertNoOverlap(
      withAssignment(inputs, next, rotationDays),
      body.effectiveFrom,
      lastChecked,
    );

    const later = await repo.endAssignmentsFrom(
      tx,
      body.userId,
      body.kind,
      body.effectiveFrom,
    );
    if (later.length > 0) {
      throw new ShiftConflictError(
        SHIFT_ERROR_CODES.ASSIGNMENT_CONFLICT,
        'This person already has a later assignment of this kind. Change that one instead.',
        { ids: later },
      );
    }
    const id = await repo.insertAssignment(tx, {
      organizationId: ctx.organizationId,
      userId: body.userId,
      kind: body.kind,
      shiftId,
      rotationId,
      effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo,
      reason: body.reason ?? null,
      createdBy: ctx.principal.id,
    });
    await recordDaysChanged(tx, ctx.organizationId, {
      userIds: [body.userId],
      from: body.effectiveFrom,
      to: body.effectiveTo === null ? null : addDays(body.effectiveTo, -1),
      reason: `${body.kind} assignment`,
    });
    return { id, rotationId };
  });
}

/* ------------------------------------------------------------------ *
 * The "why this shift" explorer — GET /api/shifts/assignments
 * ------------------------------------------------------------------ */

export interface ExplainedDay extends ResolvedShift {
  readonly window: {
    readonly start: string;
    readonly end: string;
    readonly overlap: boolean;
    readonly anchor: string;
  };
}

export async function explainShifts(
  ctx: RequestContext,
  query: {
    userId?: string | undefined;
    from?: DateOnly | undefined;
    to?: DateOnly | undefined;
  },
  clock: Clock = systemClock,
) {
  return db.transaction(ctx, async (tx) => {
    const today = await organizationToday(tx, clock);
    if (query.userId === undefined) {
      // Without a person: the assignments running on the date, for the people in scope.
      const visibility = await visibilityFilter(ctx, 'shifts:view', 'shift');
      return {
        assignments: await repo.listAssignments(tx, query.from ?? today, visibility),
      };
    }
    await loadSubject(ctx, tx, query.userId, 'shifts:view');
    const from = query.from ?? today;
    const to = query.to ?? from;
    if (to < from || daysBetween(from, to) >= EXPLAIN_MAX_DAYS) {
      throw new ShiftValidationError(
        SHIFT_ERROR_CODES.RANGE_TOO_LONG,
        `Ask for 1 to ${EXPLAIN_MAX_DAYS} days at a time.`,
      );
    }
    const inputs = await repo.loadShiftInputs(tx, query.userId, from, to);
    const days: ExplainedDay[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const window = dayWindow(inputs, date);
      days.push({
        ...resolveShift(inputs, date),
        window: {
          start: window.start.toISOString(),
          end: window.end.toISOString(),
          overlap: window.overlap,
          anchor: window.shape.anchor,
        },
      });
    }
    return { userId: query.userId, days };
  });
}

/* ------------------------------------------------------------------ *
 * Requests — POST /api/shifts/requests/:id/decide
 * ------------------------------------------------------------------ */

/**
 * The framework has already authorized `shifts:approve` on the request,
 * including A1 through `requestedBy` (SH-7). An approved change becomes date
 * overrides that point back at the request (L15); an approved flexible request
 * is read by the resolver directly.
 */
export async function decideRequest(
  ctx: RequestContext,
  requestId: string,
  body: DecideBody,
  clock: Clock = systemClock,
) {
  return db.transaction(ctx, async (tx) => {
    const request = await repo.findRequest(tx, requestId);
    if (request === null) throw new ShiftNotFoundError('No such shift request.');
    if (request.status !== 'pending') {
      throw new ShiftConflictError(
        SHIFT_ERROR_CODES.REQUEST_NOT_PENDING,
        `This request is already ${request.status}.`,
      );
    }
    if (body.decision === 'reject') {
      await repo.recordDecision(tx, {
        requestId,
        status: 'rejected',
        decidedBy: ctx.principal.id,
        note: body.note,
      });
      return { id: requestId, status: 'rejected' as const };
    }

    await assertMayChangeFrom(ctx, tx, request.fromDate, clock);
    if (request.kind === 'change' && request.requestedShiftId !== null) {
      await assertAssignable(tx, request.requestedShiftId);
      const inputs = await repo.loadShiftInputs(
        tx,
        request.userId,
        request.fromDate,
        request.toDate,
      );
      const dates: DateOnly[] = [];
      for (let date = request.fromDate; date <= request.toDate; date = addDays(date, 1))
        dates.push(date);
      assertNoOverlap(
        {
          ...inputs,
          overrides: [
            ...inputs.overrides.filter((row) => !dates.includes(row.workDate)),
            ...dates.map((workDate) => ({
              workDate,
              kind: 'shift' as const,
              shiftId: request.requestedShiftId,
            })),
          ],
        },
        request.fromDate,
        request.toDate,
      );
      for (const workDate of dates) {
        await repo.replaceOverride(tx, {
          organizationId: ctx.organizationId,
          userId: request.userId,
          workDate,
          kind: 'shift',
          shiftId: request.requestedShiftId,
          reason: `Approved shift change request ${requestId}`,
          originRequestId: requestId,
          createdBy: ctx.principal.id,
        });
      }
    }
    await repo.recordDecision(tx, {
      requestId,
      status: 'approved',
      decidedBy: ctx.principal.id,
      note: body.note,
    });
    await recordDaysChanged(tx, ctx.organizationId, {
      userIds: [request.userId],
      from: request.fromDate,
      to: request.toDate,
      reason: `${request.kind} request approved`,
    });
    return { id: requestId, status: 'approved' as const };
  });
}
