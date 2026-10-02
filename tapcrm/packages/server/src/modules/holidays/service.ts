import { holdsPolicy, visibilityFilter } from '@tapcrm/authz';
import type { DateOnly } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { organizationToday } from '../../platform/organization-time.js';
import { addDays, systemClock, toDateOnly, type Clock } from '../../platform/time.js';
import {
  HOLIDAY_ERROR_CODES,
  HolidayConflictError,
  HolidayForbiddenError,
  HolidayNotFoundError,
  HolidayValidationError,
} from './errors.js';
import { recordDaysChanged, type DaysChanged } from './events.js';
import * as repo from './repository.js';
import { validateHoliday, validateScopeSet } from './rules.js';
import type { CreateBody, ListQuery, ReviseBody, ScopeRow } from './validators.js';

/**
 * SH-6-style rule: a change that takes effect before today needs
 * `attendance:correct` as well.
 */
async function assertMayChangeFrom(
  ctx: RequestContext,
  tx: Tx,
  from: DateOnly,
  clock: Clock,
): Promise<void> {
  if (from >= (await organizationToday(tx, clock))) return;
  if (await holdsPolicy(ctx, 'attendance:correct')) return;
  throw new HolidayForbiddenError(
    HOLIDAY_ERROR_CODES.PAST_CHANGE_NEEDS_CORRECTION_AUTHORITY,
    'This change starts before today. Changing days already worked also needs attendance:correct.',
  );
}

/**
 * The first date the change touches. Dated holiday → its date; week-off →
 * effective_from. Used for the past-date authority check.
 */
function firstAffectedDate(body: CreateBody | { holidayDate: DateOnly | null; effectiveFrom: DateOnly | null }): DateOnly {
  const date =
    'holidayDate' in body ? body.holidayDate : null;
  const from =
    'effectiveFrom' in body ? body.effectiveFrom : null;
  if (date !== null) return date;
  if (from !== null) return from;
  throw new HolidayValidationError(
    HOLIDAY_ERROR_CODES.DATE_REQUIRED,
    'Missing both holidayDate and effectiveFrom.',
  );
}

/**
 * The range a change covers, as an inclusive `from` / exclusive `to`.
 *   dated: [date, date + 1)
 *   week-off: [effective_from, effective_to)   effective_to may be null
 */
function rangeOf(row: {
  type: string;
  holidayDate: DateOnly | null;
  effectiveFrom: DateOnly | null;
  effectiveTo: DateOnly | null;
}): { from: DateOnly; toExclusive: DateOnly | null } {
  if (row.type === 'week-off') {
    return { from: row.effectiveFrom!, toExclusive: row.effectiveTo };
  }
  return { from: row.holidayDate!, toExclusive: addDays(row.holidayDate!, 1) };
}

/**
 * Split a scope set into department and shift id lists — the shape the outbox
 * event uses. An empty set (national) returns two undefined arrays, so the
 * caller can drop both fields cleanly.
 */
function partitionScope(rows: readonly ScopeRow[]): {
  departmentIds?: string[];
  shiftIds?: string[];
} {
  const departmentIds = rows.filter((r) => r.departmentId !== null).map((r) => r.departmentId!);
  const shiftIds = rows.filter((r) => r.shiftId !== null).map((r) => r.shiftId!);
  const out: { departmentIds?: string[]; shiftIds?: string[] } = {};
  if (departmentIds.length > 0) out.departmentIds = departmentIds;
  if (shiftIds.length > 0) out.shiftIds = shiftIds;
  return out;
}

const unique = <T>(xs: readonly T[]) => Array.from(new Set(xs));

/** UNION(old, new) per axis. National on either side → both id sets omitted. */
function unionScope(
  oldRows: readonly ScopeRow[],
  newRows: readonly ScopeRow[],
): { departmentIds?: string[]; shiftIds?: string[] } {
  if (oldRows.length === 0 || newRows.length === 0) return {}; // national on one side → org-wide
  const dept = unique([
    ...oldRows.filter((r) => r.departmentId !== null).map((r) => r.departmentId!),
    ...newRows.filter((r) => r.departmentId !== null).map((r) => r.departmentId!),
  ]);
  const shift = unique([
    ...oldRows.filter((r) => r.shiftId !== null).map((r) => r.shiftId!),
    ...newRows.filter((r) => r.shiftId !== null).map((r) => r.shiftId!),
  ]);
  const out: { departmentIds?: string[]; shiftIds?: string[] } = {};
  if (dept.length > 0) out.departmentIds = dept;
  if (shift.length > 0) out.shiftIds = shift;
  return out;
}

async function assertScopeTargetsExist(
  tx: Tx,
  rows: readonly ScopeRow[],
): Promise<void> {
  for (const r of rows) {
    if (r.departmentId !== null && !(await repo.departmentExists(tx, r.departmentId))) {
      throw new HolidayValidationError(
        HOLIDAY_ERROR_CODES.SCOPE_TARGET_NOT_FOUND,
        `Department ${r.departmentId} does not exist.`,
      );
    }
    if (r.shiftId !== null && !(await repo.shiftExists(tx, r.shiftId))) {
      throw new HolidayValidationError(
        HOLIDAY_ERROR_CODES.SCOPE_TARGET_NOT_FOUND,
        `Shift ${r.shiftId} does not exist.`,
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * Read
 * ------------------------------------------------------------------ */

const startOfYear = (today: DateOnly): DateOnly =>
  toDateOnly(`${today.slice(0, 4)}-01-01`);
const endOfYear = (today: DateOnly): DateOnly =>
  toDateOnly(`${today.slice(0, 4)}-12-31`);

export async function listHolidays(
  ctx: RequestContext,
  query: ListQuery,
  clock: Clock = systemClock,
) {
  return db.transaction(ctx, async (tx) => {
    const today = await organizationToday(tx, clock);
    const from = query.from ?? startOfYear(today);
    const to = query.to ?? endOfYear(today);
    const visibility = await visibilityFilter(ctx, 'holidays:view', 'holiday');
    return { holidays: await repo.listHolidays(tx, from, to, visibility) };
  });
}

/* ------------------------------------------------------------------ *
 * Create
 * ------------------------------------------------------------------ */

export async function createHoliday(
  ctx: RequestContext,
  body: CreateBody,
  clock: Clock = systemClock,
) {
  validateHoliday(body);
  validateScopeSet(body.type, body.scopes);
  return db.transaction(ctx, async (tx) => {
    await assertScopeTargetsExist(tx, body.scopes);
    const from = firstAffectedDate(body);
    await assertMayChangeFrom(ctx, tx, from, clock);
    const id = await repo.insertHoliday(tx, {
      organizationId: ctx.organizationId,
      name: body.name,
      type: body.type,
      holidayDate: body.holidayDate,
      recurrence: body.recurrence,
      effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo,
      createdBy: ctx.principal.id,
    });
    await repo.insertScopes(
      tx,
      ctx.organizationId,
      id,
      body.scopes.map((s) => ({ departmentId: s.departmentId, shiftId: s.shiftId })),
    );
    const range = rangeOf(body);
    const scope = partitionScope(body.scopes);
    const event: DaysChanged = {
      ...scope,
      from: range.from,
      toExclusive: range.toExclusive,
      reason: 'created',
    };
    await recordDaysChanged(tx, ctx.organizationId, event);
    return { id };
  });
}

/* ------------------------------------------------------------------ *
 * Revise: withdraw OR replace scope
 * ------------------------------------------------------------------ */

/** Load the stored scope as validator-shaped rows. */
async function currentScopeRows(tx: Tx, holidayId: string): Promise<ScopeRow[]> {
  const rows = await repo.listScopes(tx, holidayId);
  return rows.map((r) => ({ departmentId: r.departmentId, shiftId: r.shiftId }));
}

export async function reviseHoliday(
  ctx: RequestContext,
  holidayId: string,
  body: ReviseBody,
  clock: Clock = systemClock,
) {
  return db.transaction(ctx, async (tx) => {
    await repo.lockHoliday(tx, holidayId);
    const holiday = await repo.findHoliday(tx, holidayId);
    if (holiday === null) throw new HolidayNotFoundError('No such holiday.');

    const range = rangeOf(holiday);

    if ('status' in body) {
      if (body.status === holiday.status) {
        // A no-op status change: don't write an event, don't advance state.
        return { id: holidayId, status: holiday.status };
      }
      if (body.status === 'active') {
        // Reactivation is out of scope for step 2; the design says a
        // withdrawn row stays withdrawn. If HR needs it back, they create a
        // new row so history is preserved.
        throw new HolidayConflictError(
          HOLIDAY_ERROR_CODES.WITHDRAWN,
          'A withdrawn holiday cannot be reactivated. Create a new one.',
        );
      }
      await assertMayChangeFrom(ctx, tx, range.from, clock);
      await repo.setHolidayStatus(tx, holidayId, 'withdrawn');
      const oldScope = await currentScopeRows(tx, holidayId);
      const event: DaysChanged = {
        ...partitionScope(oldScope), // blast radius = OLD scope
        from: range.from,
        toExclusive: range.toExclusive,
        reason: 'withdrawn',
      };
      await recordDaysChanged(tx, ctx.organizationId, event);
      return { id: holidayId, status: 'withdrawn' as const };
    }

    // Scope replacement.
    validateScopeSet(holiday.type, body.scopes);
    await assertScopeTargetsExist(tx, body.scopes);
    await assertMayChangeFrom(ctx, tx, range.from, clock);

    const oldScope = await currentScopeRows(tx, holidayId);
    await repo.deleteScopes(tx, holidayId);
    await repo.insertScopes(
      tx,
      ctx.organizationId,
      holidayId,
      body.scopes.map((s) => ({ departmentId: s.departmentId, shiftId: s.shiftId })),
    );

    const event: DaysChanged = {
      ...unionScope(oldScope, body.scopes), // blast radius = UNION(OLD, NEW)
      from: range.from,
      toExclusive: range.toExclusive,
      reason: 'scope-changed',
    };
    await recordDaysChanged(tx, ctx.organizationId, event);
    return { id: holidayId, scopeCount: body.scopes.length };
  });
}
