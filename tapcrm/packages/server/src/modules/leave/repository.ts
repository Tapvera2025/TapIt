// packages/server/src/modules/leave/repository.ts
import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { BalanceEntry } from './rules.js';

// ── row types ─────────────────────────────────────────────────────────────────

export interface LeaveTypeRow {
  id: string; organizationId: string; code: string; name: string;
  kind: 'absence' | 'attendance-mode'; accrualDays: number;
  enforcement: boolean; paidLeave: boolean; isActive: boolean;
}

export interface LeaveRequestRow {
  id: string; organizationId: string; userId: string;
  leaveTypeId: string; kind: 'absence' | 'attendance-mode';
  fromDate: DateOnly; toDate: DateOnly;
  fromHalf: 'full' | 'first' | 'second'; toHalf: 'full' | 'first' | 'second';
  daysConsumed: number; reason: string;
  status: 'pending' | 'acknowledged' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string;
  acknowledgedBy: string | null; acknowledgedAt: string | null;
  decidedBy: string | null; decidedAt: string | null; decisionNote: string | null;
  revokedBy: string | null; revokedAt: string | null;
  recurrenceType: 'daily' | null; recurrenceEnd: DateOnly | null; createdAt: string;
}

export interface BalanceEntryRow extends BalanceEntry {
  id: string; leaveRequestId: string | null; periodYear: number;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const REQUEST_COLS = sql.raw(`
  id, organization_id AS "organizationId", user_id AS "userId",
  leave_type_id AS "leaveTypeId", kind,
  from_date::text AS "fromDate", to_date::text AS "toDate",
  from_half AS "fromHalf", to_half AS "toHalf",
  days_consumed::float AS "daysConsumed", reason, status,
  requested_by AS "requestedBy",
  acknowledged_by AS "acknowledgedBy", acknowledged_at::text AS "acknowledgedAt",
  decided_by AS "decidedBy", decided_at::text AS "decidedAt",
  decision_note AS "decisionNote",
  revoked_by AS "revokedBy", revoked_at::text AS "revokedAt",
  recurrence_type AS "recurrenceType", recurrence_end::text AS "recurrenceEnd",
  created_at::text AS "createdAt"
`);

// ── leave types ───────────────────────────────────────────────────────────────

export async function listLeaveTypes(tx: Tx): Promise<LeaveTypeRow[]> {
  return tx.query<LeaveTypeRow>(sql`
    SELECT id, organization_id AS "organizationId", code, name, kind,
           accrual_days AS "accrualDays", enforcement, paid_leave AS "paidLeave",
           is_active AS "isActive"
    FROM leave_type ORDER BY name
  `);
}

export async function findLeaveTypeById(tx: Tx, id: string): Promise<LeaveTypeRow | null> {
  return tx.maybeOne<LeaveTypeRow>(sql`
    SELECT id, organization_id AS "organizationId", code, name, kind,
           accrual_days AS "accrualDays", enforcement, paid_leave AS "paidLeave",
           is_active AS "isActive"
    FROM leave_type WHERE id = ${id}
  `);
}

export async function insertLeaveType(
  tx: Tx, organizationId: string,
  input: { code: string; name: string; kind: string; accrualDays: number; enforcement: boolean; paidLeave: boolean },
  createdBy: string,
): Promise<LeaveTypeRow> {
  return tx.one<LeaveTypeRow>(sql`
    INSERT INTO leave_type (organization_id, code, name, kind, accrual_days, enforcement, paid_leave, created_by)
    VALUES (${organizationId}, ${input.code}, ${input.name}, ${input.kind},
            ${input.accrualDays}, ${input.enforcement}, ${input.paidLeave}, ${createdBy})
    RETURNING id, organization_id AS "organizationId", code, name, kind,
              accrual_days AS "accrualDays", enforcement, paid_leave AS "paidLeave",
              is_active AS "isActive"
  `);
}

export async function updateLeaveType(
  tx: Tx, id: string,
  patch: { name?: string; accrualDays?: number; enforcement?: boolean; paidLeave?: boolean; isActive?: boolean },
): Promise<LeaveTypeRow> {
  return tx.one<LeaveTypeRow>(sql`
    UPDATE leave_type SET
      name        = COALESCE(${patch.name        ?? null}, name),
      accrual_days= COALESCE(${patch.accrualDays ?? null}, accrual_days),
      enforcement = COALESCE(${patch.enforcement ?? null}, enforcement),
      paid_leave  = COALESCE(${patch.paidLeave   ?? null}, paid_leave),
      is_active   = COALESCE(${patch.isActive    ?? null}, is_active)
    WHERE id = ${id}
    RETURNING id, organization_id AS "organizationId", code, name, kind,
              accrual_days AS "accrualDays", enforcement, paid_leave AS "paidLeave",
              is_active AS "isActive"
  `);
}

// ── leave requests ─────────────────────────────────────────────────────────────

export async function findLeaveRequestById(tx: Tx, id: string): Promise<LeaveRequestRow | null> {
  return tx.maybeOne<LeaveRequestRow>(sql`SELECT ${REQUEST_COLS} FROM leave_request WHERE id = ${id}`);
}

/** Serialising read for acknowledge/decide/cancel — acquires a row-level lock. */
export async function findLeaveRequestForUpdate(tx: Tx, id: string): Promise<LeaveRequestRow | null> {
  return tx.maybeOne<LeaveRequestRow>(sql`
    SELECT ${REQUEST_COLS} FROM leave_request WHERE id = ${id} FOR UPDATE
  `);
}

export async function findActiveOverlappingRequests(
  tx: Tx,
  userId: string,
  fromDate: DateOnly,
  toDate: DateOnly,
  options: { excludeId?: string; conflictKinds?: string[] } = {},
): Promise<LeaveRequestRow[]> {
  const kinds = options.conflictKinds ?? ['absence', 'attendance-mode'];
  return tx.query<LeaveRequestRow>(sql`
    SELECT ${REQUEST_COLS}
    FROM leave_request
    WHERE user_id = ${userId}
      AND status IN ('pending', 'acknowledged', 'approved')
      AND from_date <= ${toDate} AND to_date >= ${fromDate}
      AND kind = ANY(${kinds}::text[])
      AND (${options.excludeId ?? null} IS NULL OR id <> ${options.excludeId ?? null})
  `);
}

export async function insertLeaveRequest(
  tx: Tx,
  input: {
    organizationId: string; userId: string; leaveTypeId: string;
    kind: string; fromDate: DateOnly; toDate: DateOnly;
    fromHalf: string; toHalf: string; daysConsumed: number;
    reason: string; requestedBy: string;
    recurrenceType: string | null; recurrenceEnd: DateOnly | null;
  },
): Promise<LeaveRequestRow> {
  return tx.one<LeaveRequestRow>(sql`
    INSERT INTO leave_request
      (organization_id, user_id, leave_type_id, kind, from_date, to_date,
       from_half, to_half, days_consumed, reason, requested_by,
       recurrence_type, recurrence_end)
    VALUES
      (${input.organizationId}, ${input.userId}, ${input.leaveTypeId}, ${input.kind},
       ${input.fromDate}, ${input.toDate}, ${input.fromHalf}, ${input.toHalf},
       ${input.daysConsumed}, ${input.reason}, ${input.requestedBy},
       ${input.recurrenceType}, ${input.recurrenceEnd})
    RETURNING ${REQUEST_COLS}
  `);
}

export async function updateLeaveRequestStatus(
  tx: Tx, id: string,
  patch: {
    status: string;
    acknowledgedBy?: string; acknowledgedAt?: Date;
    decidedBy?: string; decidedAt?: Date; decisionNote?: string | null;
    revokedBy?: string; revokedAt?: Date;
    daysConsumed?: number;
  },
): Promise<LeaveRequestRow> {
  return tx.one<LeaveRequestRow>(sql`
    UPDATE leave_request SET
      status          = ${patch.status},
      acknowledged_by = COALESCE(${patch.acknowledgedBy ?? null}, acknowledged_by),
      acknowledged_at = COALESCE(${patch.acknowledgedAt ?? null}, acknowledged_at),
      decided_by      = COALESCE(${patch.decidedBy      ?? null}, decided_by),
      decided_at      = COALESCE(${patch.decidedAt      ?? null}, decided_at),
      decision_note   = COALESCE(${patch.decisionNote   ?? null}, decision_note),
      revoked_by      = COALESCE(${patch.revokedBy      ?? null}, revoked_by),
      revoked_at      = COALESCE(${patch.revokedAt      ?? null}, revoked_at),
      days_consumed   = COALESCE(${patch.daysConsumed   ?? null}, days_consumed)
    WHERE id = ${id}
    RETURNING ${REQUEST_COLS}
  `);
}

export async function listLeaveRequests(
  tx: Tx,
  filter: { userId?: string; status?: string; fromDate?: DateOnly; toDate?: DateOnly; after?: string; limit: number },
  visibility: import('@tapcrm/authz').SqlFragment,
): Promise<LeaveRequestRow[]> {
  return tx.query<LeaveRequestRow>(sql`
    SELECT ${REQUEST_COLS}
    FROM leave_request
    WHERE (${filter.userId ?? null} IS NULL OR user_id = ${filter.userId ?? null})
      AND (${filter.status   ?? null} IS NULL OR status = ${filter.status ?? null})
      AND (${filter.fromDate ?? null} IS NULL OR to_date >= ${filter.fromDate ?? null})
      AND (${filter.toDate   ?? null} IS NULL OR from_date <= ${filter.toDate ?? null})
      AND (${filter.after    ?? null} IS NULL OR id < ${filter.after ?? null})
      AND ${visibility}
    ORDER BY id DESC
    LIMIT ${filter.limit}
  `);
}

export async function findApprovedWfhOverlapping(
  tx: Tx, userId: string, fromDate: DateOnly, toDate: DateOnly,
): Promise<LeaveRequestRow[]> {
  return tx.query<LeaveRequestRow>(sql`
    SELECT ${REQUEST_COLS}
    FROM leave_request
    WHERE user_id = ${userId}
      AND kind = 'attendance-mode'
      AND status = 'approved'
      AND from_date <= ${toDate} AND to_date >= ${fromDate}
  `);
}

// ── balances ──────────────────────────────────────────────────────────────────

export async function getBalanceEntries(
  tx: Tx, userId: string, leaveTypeId: string, year: number,
): Promise<BalanceEntryRow[]> {
  return tx.query<BalanceEntryRow>(sql`
    SELECT id, kind, units::float AS units,
           leave_request_id AS "leaveRequestId", period_year AS "periodYear"
    FROM leave_balance_entry
    WHERE user_id = ${userId} AND leave_type_id = ${leaveTypeId} AND period_year = ${year}
    ORDER BY created_at
  `);
}

export async function insertBalanceEntry(
  tx: Tx,
  input: {
    organizationId: string; userId: string; leaveTypeId: string;
    kind: 'opening' | 'accrual' | 'consumption' | 'reversal'; units: number;
    leaveRequestId: string | null; periodYear: number;
  },
): Promise<void> {
  await tx.query(sql`
    INSERT INTO leave_balance_entry
      (organization_id, user_id, leave_type_id, kind, units, leave_request_id, period_year)
    VALUES
      (${input.organizationId}, ${input.userId}, ${input.leaveTypeId},
       ${input.kind}, ${input.units}, ${input.leaveRequestId}, ${input.periodYear})
  `);
}

// ── WFH days ──────────────────────────────────────────────────────────────────

export async function upsertWfhDay(
  tx: Tx,
  input: { organizationId: string; userId: string; workDate: DateOnly; reason: string; approvedBy: string; leaveRequestId: string },
): Promise<void> {
  await tx.query(sql`
    INSERT INTO work_from_home_day
      (organization_id, user_id, work_date, reason, approved_by, leave_request_id)
    VALUES
      (${input.organizationId}, ${input.userId}, ${input.workDate},
       ${input.reason}, ${input.approvedBy}, ${input.leaveRequestId})
    ON CONFLICT (organization_id, user_id, work_date) DO UPDATE
      SET reason = EXCLUDED.reason,
          approved_by = EXCLUDED.approved_by,
          leave_request_id = EXCLUDED.leave_request_id
  `);
}

export async function deleteWfhDaysByRequest(
  tx: Tx, organizationId: string, leaveRequestId: string,
): Promise<void> {
  await tx.query(sql`
    DELETE FROM work_from_home_day
    WHERE organization_id = ${organizationId} AND leave_request_id = ${leaveRequestId}
  `);
}

export async function deleteWfhDayByRequestAndDate(
  tx: Tx, organizationId: string, userId: string, leaveRequestId: string, workDate: DateOnly,
): Promise<void> {
  await tx.query(sql`
    DELETE FROM work_from_home_day
    WHERE organization_id = ${organizationId} AND user_id = ${userId} AND leave_request_id = ${leaveRequestId} AND work_date = ${workDate}
  `);
}

export async function existsWfhDay(tx: Tx, userId: string, workDate: DateOnly): Promise<boolean> {
  const row = await tx.maybeOne<{ e: boolean }>(sql`
    SELECT TRUE AS e FROM work_from_home_day WHERE user_id = ${userId} AND work_date = ${workDate}
  `);
  return row?.e ?? false;
}

export async function findActiveStandingWfhRequests(
  tx: Tx, asOf: DateOnly,
): Promise<{ id: string; userId: string; fromDate: DateOnly; recurrenceEnd: DateOnly; reason: string; decidedBy: string }[]> {
  // Called per-org inside a transaction that has app.organization_id set — RLS scopes the result.
  return tx.query(sql`
    SELECT id, user_id AS "userId",
           from_date::text AS "fromDate", recurrence_end::text AS "recurrenceEnd",
           reason, decided_by AS "decidedBy"
    FROM leave_request
    WHERE recurrence_type = 'daily' AND status = 'approved'
      AND recurrence_end >= ${asOf}
  `);
}

export async function findApprovedAbsenceForDate(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<LeaveRequestRow | null> {
  return tx.maybeOne<LeaveRequestRow>(sql`
    SELECT ${REQUEST_COLS}
    FROM leave_request
    WHERE user_id = ${userId}
      AND kind = 'absence'
      AND status = 'approved'
      AND from_date <= ${date} AND to_date >= ${date}
    LIMIT 1
  `);
}

export async function currentOrganizationId(tx: Tx): Promise<string> {
  const row = await tx.one<{ v: string }>(sql`
    SELECT current_setting('app.organization_id') AS v
  `);
  return row.v;
}
