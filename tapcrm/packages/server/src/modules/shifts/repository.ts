import type { SqlFragment } from '@tapcrm/authz';
import type { DateOnly, LocalTime, PlacementsByDate } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { organizationTimezone } from '../../platform/organization-time.js';
import { addDays } from '../../platform/time.js';
import {
  departmentDefaultsFor,
  type AssignmentInput,
  type DepartmentDefaultRow,
  type FlexibleRequestInput,
  type OverrideInput,
  type ShiftInput,
  type ShiftInputs,
  type ShiftSettingInput,
  type ShiftVersionInput,
  type WorkingDayExceptionInput,
  type WeekdayScheduleInput,
} from './resolve.js';

/**
 * SQL for shifts. Dates come back as 'YYYY-MM-DD' text and times as 'HH:mm',
 * never as JavaScript Dates, so no timezone can shift them (T-1).
 */

/** Windows need a day either side of every date they are asked about. */
const MARGIN_DAYS = 2;

export interface Subject {
  readonly id: string;
  readonly departmentId: string | null;
  readonly teamId: string | null;
  readonly status: string;
}

export interface WorkingDayExceptionRecord {
  id: string;
  exceptionDate: DateOnly;
  reason: string;
  status: 'active' | 'inactive';
  createdAt: string;
  departmentIds: string[];
  departmentNames: string[];
}

export interface WorkingDayExceptionPage {
  readonly items: WorkingDayExceptionRecord[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

export async function findSubject(tx: Tx, userId: string): Promise<Subject | null> {
  return tx.maybeOne<Subject>(sql`
    SELECT id, department_id, team_id, status FROM app_user WHERE id = ${userId}
  `);
}

interface VersionRow extends ShiftVersionInput {
  shiftId: string;
  kind: 'fixed' | 'flexible';
}

async function loadShifts(tx: Tx): Promise<Map<string, ShiftInput>> {
  const rows = await tx.query<VersionRow>(sql`
    SELECT s.id AS shift_id, s.kind, v.id, v.effective_from::text AS effective_from,
           to_char(v.start_time, 'HH24:MI') AS start_time, to_char(v.end_time, 'HH24:MI') AS end_time,
           v.grace_minutes, v.early_exit_grace_minutes, v.full_day_minutes, v.half_day_minutes,
           v.complementary_half_minutes, v.min_overtime_minutes, v.early_window_minutes,
           v.max_closing_extension_minutes
    FROM shift s JOIN shift_version v ON v.organization_id = s.organization_id AND v.shift_id = s.id
  `);
  const shifts = new Map<
    string,
    { id: string; kind: 'fixed' | 'flexible'; versions: ShiftVersionInput[] }
  >();
  for (const { shiftId, kind, ...version } of rows) {
    const shift = shifts.get(shiftId) ?? { id: shiftId, kind, versions: [] };
    shift.versions.push(version);
    shifts.set(shiftId, shift);
  }
  return shifts;
}

async function loadRotations(tx: Tx): Promise<Map<string, Map<number, string | null>>> {
  const rows = await tx.query<{
    rotationId: string;
    weekday: number;
    shiftId: string | null;
  }>(sql`
    SELECT rotation_id, weekday, shift_id FROM shift_rotation_day
  `);
  const rotations = new Map<string, Map<number, string | null>>();
  for (const row of rows) {
    const days = rotations.get(row.rotationId) ?? new Map<number, string | null>();
    days.set(row.weekday, row.shiftId);
    rotations.set(row.rotationId, days);
  }
  return rotations;
}

/**
 * Everything the resolver and the windows need for one person, `from` to `to`
 * inclusive. `placements` are the departments recorded by days attendance has
 * already built; those dates resolve with them (see `departmentDefaultsFor`).
 */
export async function loadShiftInputs(
  tx: Tx,
  userId: string,
  from: DateOnly,
  to: DateOnly,
  placements?: PlacementsByDate,
): Promise<ShiftInputs> {
  const first = addDays(from, -MARGIN_DAYS);
  const last = addDays(to, MARGIN_DAYS);
  const subject = await findSubject(tx, userId);
  const today = subject?.departmentId ?? null;
  const departmentIds = [
    ...new Set([today, ...[...(placements?.values() ?? [])].map((p) => p.departmentId)]),
  ].filter((id): id is string => id !== null);
  const departmentIdsByDate = new Map<DateOnly, string | null>();
  for (let date = first; date <= last; date = addDays(date, 1)) {
    departmentIdsByDate.set(date, placements?.get(date)?.departmentId ?? today);
  }
  const [
    timezone,
    shifts,
    rotations,
    overrides,
    assignments,
    weekdaySchedules,
    workingDayExceptions,
    flexibleRequests,
    departmentDefaults,
    settings,
  ] = await Promise.all([
    organizationTimezone(tx),
    loadShifts(tx),
    loadRotations(tx),
    tx.query<OverrideInput>(sql`
        SELECT work_date::text AS work_date, kind, shift_id FROM shift_override
        WHERE user_id = ${userId} AND work_date BETWEEN ${first} AND ${last}
      `),
    tx.query<AssignmentInput>(sql`
        SELECT kind, shift_id, rotation_id, effective_from::text AS effective_from, effective_to::text AS effective_to
        FROM shift_assignment
        WHERE user_id = ${userId} AND effective_from <= ${last}
          AND (effective_to IS NULL OR effective_to > ${first})
      `),
    tx.query<WeekdayScheduleInput>(sql`
        SELECT a.effective_from::text AS effective_from,
               a.effective_to::text AS effective_to,
               s.working_weekdays AS working_weekdays,
               s.status
        FROM weekday_schedule_assignment a
        JOIN weekday_schedule s
          ON s.organization_id = a.organization_id AND s.id = a.schedule_id
        WHERE a.user_id = ${userId} AND a.effective_from <= ${last}
          AND (a.effective_to IS NULL OR a.effective_to > ${first})
      `),
    tx.query<WorkingDayExceptionInput & { departmentIds: string[] }>(sql`
        SELECT e.exception_date::text AS date,
               COALESCE(
                 (
                   SELECT array_agg(s.department_id)
                   FROM working_day_exception_scope s
                   WHERE s.organization_id = e.organization_id
                     AND s.exception_id = e.id
                 ),
                 ARRAY[]::uuid[]
               ) AS department_ids
        FROM working_day_exception e
        WHERE e.status = 'active'
          AND e.exception_date BETWEEN ${first} AND ${last}
      `),
    tx.query<FlexibleRequestInput>(sql`
        SELECT from_date::text AS from_date, to_date::text AS to_date FROM shift_request
        WHERE user_id = ${userId} AND kind = 'flexible' AND status = 'approved'
          AND from_date <= ${last} AND to_date >= ${first}
      `),
    departmentIds.length === 0
      ? Promise.resolve([] as DepartmentDefaultRow[])
      : tx.query<DepartmentDefaultRow>(sql`
            SELECT department_id, shift_id, effective_from::text AS effective_from,
                   effective_to::text AS effective_to
            FROM department_shift_default
            WHERE department_id = ANY(${departmentIds}::uuid[]) AND effective_from <= ${last}
              AND (effective_to IS NULL OR effective_to > ${first})
          `),
    tx.query<ShiftSettingInput>(sql`
        SELECT effective_from::text AS effective_from, to_char(day_start_time, 'HH24:MI') AS day_start_time,
               max_closing_extension_minutes
        FROM shift_setting
      `),
  ]);
  return {
    timezone,
    shifts,
    rotations,
    overrides,
    assignments,
    weekdaySchedules,
    workingDayExceptions,
    departmentIdsByDate,
    flexibleRequests,
    departmentDefaults: departmentDefaultsFor(
      departmentDefaults,
      today,
      placements,
      first,
      last,
    ),
    settings,
  };
}

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

export interface ShiftRow {
  id: string;
  code: string;
  name: string;
  kind: 'fixed' | 'flexible';
  status: 'active' | 'inactive';
}

export interface ShiftWithVersion extends ShiftRow {
  versionId: string | null;
  effectiveFrom: DateOnly | null;
  startTime: LocalTime | null;
  endTime: LocalTime | null;
  graceMinutes: number | null;
  fullDayMinutes: number | null;
  halfDayMinutes: number | null;
}

export interface WeekdayScheduleRow {
  id: string;
  name: string;
  workingWeekdays: number[];
  status: 'active' | 'inactive';
  createdAt: string;
}

export interface WeekdayScheduleAssignmentRow {
  scheduleId: string;
  scheduleName: string;
  workingWeekdays: number[];
  effectiveFrom: DateOnly;
  effectiveTo: DateOnly | null;
}

export async function listWeekdaySchedules(tx: Tx): Promise<WeekdayScheduleRow[]> {
  return tx.query<WeekdayScheduleRow>(sql`
    SELECT id, name, working_weekdays AS "workingWeekdays", status,
           created_at AS "createdAt"
    FROM weekday_schedule
    ORDER BY status DESC, name ASC
  `);
}

export async function findWeekdaySchedule(
  tx: Tx,
  scheduleId: string,
): Promise<WeekdayScheduleRow | null> {
  return tx.maybeOne<WeekdayScheduleRow>(sql`
    SELECT id, name, working_weekdays AS "workingWeekdays", status,
           created_at AS "createdAt"
    FROM weekday_schedule
    WHERE id = ${scheduleId}
  `);
}

export async function findCurrentWeekdayScheduleAssignment(
  tx: Tx,
  userId: string,
  asOfDate: DateOnly,
): Promise<WeekdayScheduleAssignmentRow | null> {
  return tx.maybeOne<WeekdayScheduleAssignmentRow>(sql`
    SELECT a.schedule_id AS "scheduleId", s.name AS "scheduleName",
           s.working_weekdays AS "workingWeekdays",
           a.effective_from AS "effectiveFrom", a.effective_to AS "effectiveTo"
    FROM weekday_schedule_assignment a
    JOIN weekday_schedule s
      ON s.organization_id = a.organization_id AND s.id = a.schedule_id
    WHERE a.user_id = ${userId}
      AND a.effective_from <= ${asOfDate}
      AND (a.effective_to IS NULL OR a.effective_to > ${asOfDate})
    ORDER BY a.effective_from DESC
    LIMIT 1
  `);
}

export async function insertWeekdaySchedule(
  tx: Tx,
  input: {
    organizationId: string;
    name: string;
    workingWeekdays: readonly number[];
    createdBy: string;
  },
): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO weekday_schedule (organization_id, name, working_weekdays, created_by)
    VALUES (${input.organizationId}, ${input.name}, ${input.workingWeekdays}::smallint[], ${input.createdBy})
    RETURNING id
  `);
  return row.id;
}

export async function setWeekdayScheduleStatus(
  tx: Tx,
  scheduleId: string,
  status: 'active' | 'inactive',
): Promise<void> {
  await tx.query(sql`
    UPDATE weekday_schedule SET status = ${status} WHERE id = ${scheduleId}
  `);
}

export async function listWorkingDayExceptions(
  tx: Tx,
  organizationId: string,
  query: { page: number; pageSize: number },
): Promise<WorkingDayExceptionPage> {
  const [rows, count] = await Promise.all([
    tx.query<Omit<WorkingDayExceptionRecord, 'departmentIds' | 'departmentNames'>>(sql`
      SELECT id, exception_date::text AS exception_date, reason, status, created_at::text AS created_at
      FROM working_day_exception
      WHERE organization_id = ${organizationId}
      ORDER BY exception_date DESC, created_at DESC, id DESC
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
    `),
    tx.one<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM working_day_exception
      WHERE organization_id = ${organizationId}
    `),
  ]);
  const ids = rows.map((row) => row.id);
  const scopes = ids.length === 0
    ? []
    : await tx.query<{ exceptionId: string; departmentId: string; departmentName: string }>(sql`
        SELECT s.exception_id, s.department_id, d.name AS department_name
        FROM working_day_exception_scope s
        JOIN department d
          ON d.organization_id = s.organization_id AND d.id = s.department_id
        WHERE s.organization_id = ${organizationId}
          AND s.exception_id = ANY(${ids}::uuid[])
        ORDER BY d.name
      `);
  const byException = new Map<string, { ids: string[]; names: string[] }>();
  for (const scope of scopes) {
    const current = byException.get(scope.exceptionId) ?? { ids: [], names: [] };
    current.ids.push(scope.departmentId);
    current.names.push(scope.departmentName);
    byException.set(scope.exceptionId, current);
  }
  const items = rows.map((row) => {
    const scope = byException.get(row.id) ?? { ids: [], names: [] };
    return { ...row, departmentIds: scope.ids, departmentNames: scope.names };
  });
  return {
    items,
    total: count.count,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(count.count / query.pageSize)),
  };
}

export async function findWorkingDayException(
  tx: Tx,
  organizationId: string,
  id: string,
): Promise<WorkingDayExceptionRecord | null> {
  const rows = await tx.query<Omit<WorkingDayExceptionRecord, 'departmentIds' | 'departmentNames'>>(sql`
    SELECT id, exception_date::text AS exception_date, reason, status, created_at::text AS created_at
    FROM working_day_exception
    WHERE organization_id = ${organizationId} AND id = ${id}
  `);
  const row = rows[0];
  if (row === undefined) return null;
  const scopes = await tx.query<{ departmentId: string; departmentName: string }>(sql`
    SELECT s.department_id, d.name AS department_name
    FROM working_day_exception_scope s
    JOIN department d
      ON d.organization_id = s.organization_id AND d.id = s.department_id
    WHERE s.organization_id = ${organizationId} AND s.exception_id = ${id}
    ORDER BY d.name
  `);
  return {
    ...row,
    departmentIds: scopes.map((scope) => scope.departmentId),
    departmentNames: scopes.map((scope) => scope.departmentName),
  };
}

export async function insertWorkingDayException(
  tx: Tx,
  input: { organizationId: string; exceptionDate: DateOnly; reason: string; createdBy: string },
): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO working_day_exception (organization_id, exception_date, reason, created_by)
    VALUES (${input.organizationId}, ${input.exceptionDate}, ${input.reason}, ${input.createdBy})
    RETURNING id
  `);
  return row.id;
}

export async function insertWorkingDayExceptionScopes(
  tx: Tx,
  organizationId: string,
  exceptionId: string,
  exceptionDate: DateOnly,
  departmentIds: readonly string[],
): Promise<void> {
  for (const departmentId of departmentIds) {
    await tx.query(sql`
      INSERT INTO working_day_exception_scope
        (organization_id, exception_id, exception_date, department_id)
      VALUES (${organizationId}, ${exceptionId}, ${exceptionDate}, ${departmentId})
    `);
  }
}

export async function setWorkingDayExceptionStatus(
  tx: Tx,
  id: string,
  status: 'active' | 'inactive',
): Promise<void> {
  await tx.query(sql`
    UPDATE working_day_exception
    SET status = ${status}, updated_at = now()
    WHERE id = ${id}
  `);
}

export async function workingDayExceptionConflict(
  tx: Tx,
  organizationId: string,
  exceptionDate: DateOnly,
  departmentIds: readonly string[],
): Promise<boolean> {
  return (await tx.maybeOne<{ id: string }>(sql`
    SELECT e.id
    FROM working_day_exception e
    WHERE e.organization_id = ${organizationId}
      AND e.exception_date = ${exceptionDate}
      AND e.status = 'active'
      AND (
        ${departmentIds.length === 0}
        OR NOT EXISTS (
          SELECT 1 FROM working_day_exception_scope existing_org_scope
          WHERE existing_org_scope.exception_id = e.id
        )
        OR EXISTS (
          SELECT 1
          FROM working_day_exception_scope existing_scope
          WHERE existing_scope.exception_id = e.id
            AND existing_scope.department_id = ANY(${[...departmentIds]}::uuid[])
        )
      )
    LIMIT 1
  `)) !== null;
}

export async function departmentIdsExist(tx: Tx, departmentIds: readonly string[]): Promise<boolean> {
  if (departmentIds.length === 0) return true;
  const row = await tx.maybeOne<{ count: number }>(sql`
    SELECT count(*)::int AS count
    FROM department
    WHERE id = ANY(${[...departmentIds]}::uuid[])
  `);
  return row?.count === departmentIds.length;
}

export async function insertWeekdayScheduleAssignment(
  tx: Tx,
  input: {
    organizationId: string;
    userId: string;
    scheduleId: string;
    effectiveFrom: DateOnly;
    createdBy: string;
  },
): Promise<string> {
  await tx.query(sql`
    UPDATE weekday_schedule_assignment
    SET effective_to = ${input.effectiveFrom}
    WHERE organization_id = ${input.organizationId}
      AND user_id = ${input.userId}
      AND effective_from < ${input.effectiveFrom}
      AND (effective_to IS NULL OR effective_to > ${input.effectiveFrom})
  `);
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO weekday_schedule_assignment
      (organization_id, user_id, schedule_id, effective_from, created_by)
    VALUES
      (${input.organizationId}, ${input.userId}, ${input.scheduleId}, ${input.effectiveFrom}, ${input.createdBy})
    RETURNING id
  `);
  return row.id;
}

/** Templates with the version in force on `date` (null before the first one). */
export async function listShifts(tx: Tx, date: DateOnly): Promise<ShiftWithVersion[]> {
  return tx.query<ShiftWithVersion>(sql`
    SELECT s.id, s.code, s.name, s.kind, s.status,
           v.id AS version_id, v.effective_from::text AS effective_from,
           to_char(v.start_time, 'HH24:MI') AS start_time, to_char(v.end_time, 'HH24:MI') AS end_time,
           v.grace_minutes, v.full_day_minutes, v.half_day_minutes
    FROM shift s
    LEFT JOIN LATERAL (
      SELECT * FROM shift_version sv
      WHERE sv.organization_id = s.organization_id AND sv.shift_id = s.id AND sv.effective_from <= ${date}
      ORDER BY sv.effective_from DESC LIMIT 1
    ) v ON true
    ORDER BY s.code
  `);
}

export async function findShift(tx: Tx, shiftId: string): Promise<ShiftRow | null> {
  return tx.maybeOne<ShiftRow>(
    sql`SELECT id, code, name, kind, status FROM shift WHERE id = ${shiftId}`,
  );
}

/** Returns null when the code is already used in this organization. */
export async function insertShift(
  tx: Tx,
  input: {
    organizationId: string;
    code: string;
    name: string;
    kind: 'fixed' | 'flexible';
    createdBy: string;
  },
): Promise<string | null> {
  const rows = await tx.query<{ id: string }>(sql`
    INSERT INTO shift (organization_id, code, name, kind, created_by)
    VALUES (${input.organizationId}, ${input.code}, ${input.name}, ${input.kind}, ${input.createdBy})
    ON CONFLICT (organization_id, code) DO NOTHING
    RETURNING id
  `);
  return rows[0]?.id ?? null;
}

export interface NewVersion {
  organizationId: string;
  shiftId: string;
  effectiveFrom: DateOnly;
  startTime: LocalTime | null;
  endTime: LocalTime | null;
  graceMinutes: number;
  earlyExitGraceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  complementaryHalfMinutes: number | null;
  minOvertimeMinutes: number | null;
  earlyWindowMinutes: number;
  maxClosingExtensionMinutes: number | null;
  createdBy: string;
}

/** Returns false when the template already has a version on that date. */
export async function insertVersion(tx: Tx, v: NewVersion): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(sql`
    INSERT INTO shift_version (
      organization_id, shift_id, effective_from, start_time, end_time, grace_minutes,
      early_exit_grace_minutes, full_day_minutes, half_day_minutes, complementary_half_minutes,
      min_overtime_minutes, early_window_minutes, max_closing_extension_minutes, created_by
    ) VALUES (
      ${v.organizationId}, ${v.shiftId}, ${v.effectiveFrom}, ${v.startTime}::time, ${v.endTime}::time,
      ${v.graceMinutes}, ${v.earlyExitGraceMinutes}, ${v.fullDayMinutes}, ${v.halfDayMinutes},
      ${v.complementaryHalfMinutes}, ${v.minOvertimeMinutes}, ${v.earlyWindowMinutes},
      ${v.maxClosingExtensionMinutes}, ${v.createdBy}
    )
    ON CONFLICT (organization_id, shift_id, effective_from) DO NOTHING
    RETURNING id
  `);
  return rows.length === 1;
}

export async function hasVersion(tx: Tx, shiftId: string): Promise<boolean> {
  const row = await tx.maybeOne<{ one: number }>(sql`
    SELECT 1 AS one FROM shift_version WHERE shift_id = ${shiftId} LIMIT 1
  `);
  return row !== null;
}

export async function setShiftStatus(
  tx: Tx,
  shiftId: string,
  status: 'active' | 'inactive',
): Promise<void> {
  await tx.query(sql`UPDATE shift SET status = ${status} WHERE id = ${shiftId}`);
}

/* ------------------------------------------------------------------ *
 * Assignments, rotations, overrides, department defaults
 * ------------------------------------------------------------------ */

type AssignmentKind = 'template' | 'rotation' | 'permanent-flexible';

/**
 * A new assignment replaces its kind from its first date: an earlier one still
 * running is ended there. Returns the ids of any that start on or after it,
 * which the caller refuses rather than silently rewriting.
 */
export async function endAssignmentsFrom(
  tx: Tx,
  userId: string,
  kind: AssignmentKind,
  from: DateOnly,
): Promise<string[]> {
  const later = await tx.query<{ id: string }>(sql`
    SELECT id FROM shift_assignment
    WHERE user_id = ${userId} AND kind = ${kind} AND effective_from >= ${from}
  `);
  if (later.length > 0) return later.map((row) => row.id);
  await tx.query(sql`
    UPDATE shift_assignment SET effective_to = ${from}
    WHERE user_id = ${userId} AND kind = ${kind} AND effective_from < ${from}
      AND (effective_to IS NULL OR effective_to > ${from})
  `);
  return [];
}

export async function insertAssignment(
  tx: Tx,
  a: {
    organizationId: string;
    userId: string;
    kind: AssignmentKind;
    shiftId: string | null;
    rotationId: string | null;
    effectiveFrom: DateOnly;
    effectiveTo: DateOnly | null;
    reason: string | null;
    createdBy: string;
  },
): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO shift_assignment (organization_id, user_id, kind, shift_id, rotation_id, effective_from, effective_to, reason, created_by)
    VALUES (${a.organizationId}, ${a.userId}, ${a.kind}, ${a.shiftId}, ${a.rotationId}, ${a.effectiveFrom},
            ${a.effectiveTo}, ${a.reason}, ${a.createdBy})
    RETURNING id
  `);
  return row.id;
}

export async function insertRotation(
  tx: Tx,
  r: {
    organizationId: string;
    name: string;
    days: ReadonlyMap<number, string | null>;
    createdBy: string;
  },
): Promise<string> {
  const { id } = await tx.one<{ id: string }>(sql`
    INSERT INTO shift_rotation (organization_id, name, created_by)
    VALUES (${r.organizationId}, ${r.name}, ${r.createdBy})
    RETURNING id
  `);
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    await tx.query(sql`
      INSERT INTO shift_rotation_day (organization_id, rotation_id, weekday, shift_id)
      VALUES (${r.organizationId}, ${id}, ${weekday}, ${r.days.get(weekday) ?? null})
    `);
  }
  return id;
}

export async function rotationShiftIds(
  tx: Tx,
  rotationId: string,
): Promise<(string | null)[] | null> {
  const rows = await tx.query<{ shiftId: string | null }>(sql`
    SELECT shift_id FROM shift_rotation_day WHERE rotation_id = ${rotationId} ORDER BY weekday
  `);
  return rows.length === 0 ? null : rows.map((row) => row.shiftId);
}

/** One override per person per date: a new one replaces the old. */
export async function replaceOverride(
  tx: Tx,
  o: {
    organizationId: string;
    userId: string;
    workDate: DateOnly;
    kind: 'shift' | 'flexible' | 'no-shift';
    shiftId: string | null;
    reason: string;
    originRequestId: string | null;
    createdBy: string;
  },
): Promise<void> {
  await tx.query(
    sql`DELETE FROM shift_override WHERE user_id = ${o.userId} AND work_date = ${o.workDate}`,
  );
  await tx.query(sql`
    INSERT INTO shift_override (organization_id, user_id, work_date, kind, shift_id, reason, origin_request_id, created_by)
    VALUES (${o.organizationId}, ${o.userId}, ${o.workDate}, ${o.kind}, ${o.shiftId}, ${o.reason},
            ${o.originRequestId}, ${o.createdBy})
  `);
}

export async function endDepartmentDefaultsFrom(
  tx: Tx,
  departmentId: string,
  from: DateOnly,
): Promise<string[]> {
  const later = await tx.query<{ id: string }>(sql`
    SELECT id FROM department_shift_default WHERE department_id = ${departmentId} AND effective_from >= ${from}
  `);
  if (later.length > 0) return later.map((row) => row.id);
  await tx.query(sql`
    UPDATE department_shift_default SET effective_to = ${from}
    WHERE department_id = ${departmentId} AND effective_from < ${from}
      AND (effective_to IS NULL OR effective_to > ${from})
  `);
  return [];
}

export async function insertDepartmentDefault(
  tx: Tx,
  d: {
    organizationId: string;
    departmentId: string;
    shiftId: string;
    effectiveFrom: DateOnly;
    effectiveTo: DateOnly | null;
    createdBy: string;
  },
): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO department_shift_default (organization_id, department_id, shift_id, effective_from, effective_to, created_by)
    VALUES (${d.organizationId}, ${d.departmentId}, ${d.shiftId}, ${d.effectiveFrom}, ${d.effectiveTo}, ${d.createdBy})
    RETURNING id
  `);
  return row.id;
}

export async function departmentExists(tx: Tx, departmentId: string): Promise<boolean> {
  return (
    (await tx.maybeOne<{ id: string }>(
      sql`SELECT id FROM department WHERE id = ${departmentId}`,
    )) !== null
  );
}

/** People whose department default this is, so an overlap check can be run for each. */
export async function departmentMemberIds(
  tx: Tx,
  departmentId: string,
): Promise<string[]> {
  const rows = await tx.query<{ id: string }>(sql`
    SELECT id FROM app_user WHERE department_id = ${departmentId} AND status = 'active' ORDER BY id
  `);
  return rows.map((row) => row.id);
}

export interface AssignmentListRow {
  id: string;
  userId: string;
  fullName: string;
  kind: AssignmentKind;
  shiftId: string | null;
  rotationId: string | null;
  effectiveFrom: DateOnly;
  effectiveTo: DateOnly | null;
}

/** Assignments running on `date` for the people `visibility` lets the caller see (alias `u`). */
export async function listAssignments(
  tx: Tx,
  date: DateOnly,
  visibility: SqlFragment,
): Promise<AssignmentListRow[]> {
  return tx.query<AssignmentListRow>(sql`
    SELECT a.id, a.user_id, u.full_name, a.kind, a.shift_id, a.rotation_id,
           a.effective_from::text AS effective_from, a.effective_to::text AS effective_to
    FROM shift_assignment a
    JOIN app_user u ON u.organization_id = a.organization_id AND u.id = a.user_id
    WHERE a.effective_from <= ${date} AND (a.effective_to IS NULL OR a.effective_to > ${date})
      AND (${visibility})
    ORDER BY u.full_name, a.kind
  `);
}

/* ------------------------------------------------------------------ *
 * Requests (G3: raising and listing need routes that do not exist yet)
 * ------------------------------------------------------------------ */

export interface RequestRow {
  id: string;
  userId: string;
  kind: 'flexible' | 'change';
  fromDate: DateOnly;
  toDate: DateOnly;
  requestedShiftId: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string;
}

export async function findRequest(tx: Tx, requestId: string): Promise<RequestRow | null> {
  return tx.maybeOne<RequestRow>(sql`
    SELECT id, user_id, kind, from_date::text AS from_date, to_date::text AS to_date,
           requested_shift_id, status, requested_by
    FROM shift_request WHERE id = ${requestId}
    FOR UPDATE
  `);
}

export async function recordDecision(
  tx: Tx,
  d: {
    requestId: string;
    status: 'approved' | 'rejected';
    decidedBy: string;
    note: string | null;
  },
): Promise<void> {
  await tx.query(sql`
    UPDATE shift_request
    SET status = ${d.status}, decided_by = ${d.decidedBy}, decided_at = now(), decision_note = ${d.note}
    WHERE id = ${d.requestId} AND status = 'pending'
  `);
}
