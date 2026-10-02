import type { SqlFragment } from '@tapcrm/authz';
import type { DateOnly, HolidaySubtype, PlacementsByDate } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { organizationTimezone } from '../../platform/organization-time.js';
import * as shifts from '../shifts/facade.js';
import type { CalendarInputs, ScopeInput, WeekOffRecurrence } from './resolve.js';

/**
 * SQL for holidays. Dates come back as 'YYYY-MM-DD' text, never as JavaScript
 * Dates, so no timezone can shift them (T-1).
 */

export interface Subject {
  readonly id: string;
  readonly departmentId: string | null;
}

export async function findSubject(tx: Tx, userId: string): Promise<Subject | null> {
  return tx.maybeOne<Subject>(sql`
    SELECT id, department_id FROM app_user WHERE id = ${userId}
  `);
}

interface HolidayRow {
  id: string;
  name: string;
  type: HolidaySubtype;
  holidayDate: DateOnly | null;
  recurrence: WeekOffRecurrence | null;
  effectiveFrom: DateOnly | null;
  effectiveTo: DateOnly | null;
  status: 'active' | 'withdrawn';
  createdAt: string;
}

/**
 * Everything the resolver needs for one person over [from, to]. Only one
 * `ShiftsFacade.resolveRange` call — never one per date. Skipped entirely
 * when no shift-scoped holiday overlaps the range. `placements` go to that
 * call, so a built day's shift is resolved with the department it recorded.
 */
export async function loadCalendarInputs(
  tx: Tx,
  userId: string,
  from: DateOnly,
  to: DateOnly,
  placements?: PlacementsByDate,
): Promise<CalendarInputs> {
  const subject = await findSubject(tx, userId);
  const [timezone, holidays] = await Promise.all([
    organizationTimezone(tx),
    tx.query<HolidayRow>(sql`
      SELECT id, name, type,
             holiday_date::text AS holiday_date,
             recurrence,
             effective_from::text AS effective_from,
             effective_to::text AS effective_to,
             status,
             created_at::text AS created_at
      FROM holiday
      WHERE status = 'active'
        AND (
          (holiday_date IS NOT NULL AND holiday_date BETWEEN ${from} AND ${to})
          OR (type = 'week-off' AND effective_from <= ${to}
              AND (effective_to IS NULL OR effective_to > ${from}))
        )
    `),
  ]);
  const holidayIds = holidays.map((h) => h.id);
  const scopes: ScopeInput[] =
    holidayIds.length === 0
      ? []
      : await tx.query<ScopeInput>(sql`
          SELECT holiday_id, department_id, shift_id
          FROM holiday_scope
          WHERE holiday_id = ANY(${holidayIds}::uuid[])
        `);

  // Preload the person's shifts only if a shift-scoped holiday overlaps the
  // range. Otherwise a 62-day payroll batch would multiply into 62N shift
  // queries for nothing.
  const shiftIdsByDate = new Map<DateOnly, string | null>();
  if (scopes.some((s) => s.shiftId !== null)) {
    const resolved = await shifts.resolveRange(
      tx,
      userId,
      from,
      to,
      placements === undefined ? {} : { placements },
    );
    for (const r of resolved) shiftIdsByDate.set(r.date, r.shiftId);
  }

  return {
    timezone,
    departmentId: subject?.departmentId ?? null,
    holidays: holidays.map((h) => ({ ...h })),
    scopes,
    shiftIdsByDate,
  };
}

/* ------------------------------------------------------------------ *
 * CRUD
 * ------------------------------------------------------------------ */

export interface ScopeTarget {
  readonly departmentId: string | null;
  readonly shiftId: string | null;
}

export interface HolidayListRow extends HolidayRow {
  scopeCount: number;
}

/**
 * The GET /api/holidays list, defaulting to `visibility` filtered by
 * `holidays:view` (HO-4: every employee reads it, so this filter is TRUE in
 * practice). Ranges default to the current-year window in the caller.
 */
export async function listHolidays(
  tx: Tx,
  from: DateOnly,
  to: DateOnly,
  _visibility: SqlFragment,
): Promise<HolidayListRow[]> {
  return tx.query<HolidayListRow>(sql`
    SELECT h.id, h.name, h.type,
           h.holiday_date::text AS holiday_date,
           h.recurrence,
           h.effective_from::text AS effective_from,
           h.effective_to::text AS effective_to,
           h.status,
           h.created_at::text AS created_at,
           (SELECT count(*)::int FROM holiday_scope s WHERE s.holiday_id = h.id) AS scope_count
    FROM holiday h
    WHERE (
      (h.holiday_date IS NOT NULL AND h.holiday_date BETWEEN ${from} AND ${to})
      OR (h.type = 'week-off' AND h.effective_from <= ${to}
          AND (h.effective_to IS NULL OR h.effective_to > ${from}))
    )
    ORDER BY h.holiday_date NULLS LAST, h.effective_from NULLS LAST, h.name
  `);
}

export async function findHoliday(
  tx: Tx,
  id: string,
): Promise<HolidayRow | null> {
  return tx.maybeOne<HolidayRow>(sql`
    SELECT id, name, type,
           holiday_date::text AS holiday_date,
           recurrence,
           effective_from::text AS effective_from,
           effective_to::text AS effective_to,
           status,
           created_at::text AS created_at
    FROM holiday WHERE id = ${id}
    FOR UPDATE
  `);
}

export async function listScopes(tx: Tx, holidayId: string): Promise<ScopeTarget[]> {
  return tx.query<ScopeTarget>(sql`
    SELECT department_id, shift_id FROM holiday_scope WHERE holiday_id = ${holidayId}
  `);
}

export interface NewHoliday {
  organizationId: string;
  name: string;
  type: HolidaySubtype;
  holidayDate: DateOnly | null;
  recurrence: WeekOffRecurrence | null;
  effectiveFrom: DateOnly | null;
  effectiveTo: DateOnly | null;
  createdBy: string;
}

export async function insertHoliday(tx: Tx, h: NewHoliday): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO holiday (organization_id, name, type, holiday_date, recurrence,
                         effective_from, effective_to, created_by)
    VALUES (${h.organizationId}, ${h.name}, ${h.type}, ${h.holidayDate},
            ${h.recurrence === null ? null : JSON.stringify(h.recurrence)}::jsonb,
            ${h.effectiveFrom}, ${h.effectiveTo}, ${h.createdBy})
    RETURNING id
  `);
  return row.id;
}

export async function insertScopes(
  tx: Tx,
  organizationId: string,
  holidayId: string,
  rows: readonly ScopeTarget[],
): Promise<void> {
  for (const r of rows) {
    await tx.query(sql`
      INSERT INTO holiday_scope (organization_id, holiday_id, department_id, shift_id)
      VALUES (${organizationId}, ${holidayId}, ${r.departmentId}, ${r.shiftId})
    `);
  }
}

export async function deleteScopes(tx: Tx, holidayId: string): Promise<void> {
  await tx.query(sql`DELETE FROM holiday_scope WHERE holiday_id = ${holidayId}`);
}

export async function setHolidayStatus(
  tx: Tx,
  holidayId: string,
  status: 'active' | 'withdrawn',
): Promise<void> {
  await tx.query(sql`UPDATE holiday SET status = ${status} WHERE id = ${holidayId}`);
}

export async function departmentExists(tx: Tx, departmentId: string): Promise<boolean> {
  return (
    (await tx.maybeOne<{ id: string }>(
      sql`SELECT id FROM department WHERE id = ${departmentId}`,
    )) !== null
  );
}

export async function shiftExists(tx: Tx, shiftId: string): Promise<boolean> {
  // Reads through ShiftsFacade so holidays never touches the shift tables
  // directly (SH-1 / design §6.2).
  return shifts.exists(tx, shiftId);
}

/** Serialize scope replacement on one holiday so concurrent PATCHes don't race. */
export async function lockHoliday(tx: Tx, holidayId: string): Promise<void> {
  await tx.query(sql`
    SELECT pg_advisory_xact_lock(hashtextextended('holiday:' || ${holidayId}, 0))
  `);
}
