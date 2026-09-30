import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { MyNotepadDbRow, MyNotepadHistoryDbRow } from '../types.js';
import type {
  EmployeeNoteSummaryDbRow,
  EmployeeNoteSummaryItem,
  ListEmployeeNotesFilter,
  PaginatedEmployeeNotesResult,
} from './types.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toSummaryItem(row: EmployeeNoteSummaryDbRow): EmployeeNoteSummaryItem {
  const userId = row.userId ?? row.user_id ?? '';
  const hasNote = Boolean(row.hasNote ?? row.has_note);
  const rawDate = row.lastUpdatedAt ?? row.last_updated_at;
  const lastUpdatedAt =
    rawDate instanceof Date
      ? rawDate.toISOString()
      : typeof rawDate === 'string'
        ? rawDate
        : null;

  return {
    userId,
    name: row.name,
    email: row.email,
    department: row.department,
    designation: row.designation,
    hasNote,
    lastUpdatedAt,
  };
}

/**
 * Verify whether an employee exists within the authenticated organization boundary.
 */
export async function findEmployeeInOrg(
  ctx: RequestContext,
  userId: string,
): Promise<{ id: string; organizationId: string; fullName: string } | null> {
  if (!UUID_REGEX.test(userId)) return null;

  return db.maybeOne<{ id: string; organizationId: string; fullName: string }>(
    ctx,
    sql`
      SELECT id, organization_id AS "organizationId", full_name AS "fullName"
      FROM app_user
      WHERE organization_id = ${ctx.organizationId} AND id = ${userId}
    `,
  );
}

/**
 * List employees with note presence and metadata across departments.
 * Supports department filtering, employee search, and pagination.
 */
export async function listEmployeeNotes(
  ctx: RequestContext,
  filter: ListEmployeeNotesFilter = {},
): Promise<PaginatedEmployeeNotesResult> {
  const page = filter.page && filter.page > 0 ? filter.page : 1;
  const limit = filter.limit && filter.limit > 0 ? filter.limit : 50;
  const offset = (page - 1) * limit;

  const whereClauses: SqlFragment[] = [
    sql`u.organization_id = ${ctx.organizationId}`,
    sql`u.account_type = 'employee'`,
    sql`u.status = 'active'`,
  ];

  if (filter.department) {
    const dept = filter.department.trim();
    if (UUID_REGEX.test(dept)) {
      whereClauses.push(sql`u.department_id = ${dept}`);
    } else {
      const pattern = `%${dept}%`;
      whereClauses.push(
        sql`(d.code ILIKE ${dept} OR d.name ILIKE ${pattern})`,
      );
    }
  }

  if (filter.search && filter.search.trim().length > 0) {
    const searchPattern = `%${filter.search.trim()}%`;
    whereClauses.push(
      sql`(u.full_name ILIKE ${searchPattern} OR u.email ILIKE ${searchPattern})`,
    );
  }

  const where = sql.join(whereClauses, ' AND ');

  const countRow = await db.one<{ count: string }>(
    ctx,
    sql`
      SELECT COUNT(*)::text AS count
      FROM app_user u
      LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
      LEFT JOIN designation des ON des.organization_id = u.organization_id AND des.id = u.designation_id
      LEFT JOIN my_notepad n ON n.organization_id = u.organization_id AND n.user_id = u.id
      WHERE ${where}
    `,
  );

  const total = parseInt(countRow.count, 10);

  const rows = await db.query<EmployeeNoteSummaryDbRow>(
    ctx,
    sql`
      SELECT
        u.id AS user_id,
        u.full_name AS name,
        u.email AS email,
        d.name AS department,
        des.name AS designation,
        CASE WHEN n.id IS NOT NULL AND length(trim(n.content)) > 0 THEN true ELSE false END AS has_note,
        n.updated_at AS last_updated_at
      FROM app_user u
      LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
      LEFT JOIN designation des ON des.organization_id = u.organization_id AND des.id = u.designation_id
      LEFT JOIN my_notepad n ON n.organization_id = u.organization_id AND n.user_id = u.id
      WHERE ${where}
      ORDER BY u.full_name ASC
      LIMIT ${limit} OFFSET ${offset}
    `,
  );

  return {
    items: rows.map(toSummaryItem),
    total,
    page,
    limit,
  };
}

/**
 * Fetch the current notepad record for a specific employee within the current tenant.
 */
export async function findEmployeeNoteRow(
  ctx: RequestContext,
  userId: string,
): Promise<MyNotepadDbRow | null> {
  if (!UUID_REGEX.test(userId)) return null;

  return db.maybeOne<MyNotepadDbRow>(
    ctx,
    sql`
      SELECT id, organization_id, user_id, content, created_at, updated_at
      FROM my_notepad
      WHERE organization_id = ${ctx.organizationId} AND user_id = ${userId}
    `,
  );
}

/**
 * Retrieve saved note history snapshots for a specific employee, newest first.
 */
export async function listEmployeeNoteHistoryRows(
  ctx: RequestContext,
  userId: string,
): Promise<MyNotepadHistoryDbRow[]> {
  if (!UUID_REGEX.test(userId)) return [];

  return db.query<MyNotepadHistoryDbRow>(
    ctx,
    sql`
      SELECT id, organization_id, user_id, content, created_at
      FROM my_notepad_history
      WHERE organization_id = ${ctx.organizationId} AND user_id = ${userId}
      ORDER BY created_at DESC, id DESC
    `,
  );
}

/**
 * Retrieve a specific historical note by ID scoped strictly to target employee and tenant.
 */
export async function findEmployeeHistoricalNoteRowById(
  ctx: RequestContext,
  userId: string,
  historyId: string,
): Promise<MyNotepadHistoryDbRow | null> {
  if (!UUID_REGEX.test(userId) || !UUID_REGEX.test(historyId)) return null;

  return db.maybeOne<MyNotepadHistoryDbRow>(
    ctx,
    sql`
      SELECT id, organization_id, user_id, content, created_at
      FROM my_notepad_history
      WHERE organization_id = ${ctx.organizationId}
        AND user_id = ${userId}
        AND id = ${historyId}
    `,
  );
}
