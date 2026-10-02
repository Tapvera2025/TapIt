import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

/**
 * Small helpers for writing notification text. Every module that notifies
 * people formats dates, day counts and names the same way, so the notification
 * centre reads as one voice. Exported through `facade.ts` only.
 */

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const LONG_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

interface Parts {
  readonly y: number;
  readonly m: number;
  readonly d: number;
}

function parts(date: string): Parts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return null;
  const m = Number(match[2]);
  if (m < 1 || m > 12) return null;
  return { y: Number(match[1]), m, d: Number(match[3]) };
}

const short = (p: Parts): string => SHORT_MONTHS[p.m - 1]!;

/** '2026-11-10' → '10 Nov 2026'. A calendar date is shown as written: no time zone. */
export function formatDay(date: string): string {
  const p = parts(date);
  return p ? [p.d, short(p), p.y].join(' ') : date;
}

/** '10 Nov 2026', '10–12 Nov 2026', '28 Nov – 2 Dec 2026', '30 Dec 2026 – 2 Jan 2027'. */
export function formatDayRange(first: string, last: string): string {
  const a = parts(first);
  const b = parts(last);
  if (!a || !b) return [first, last].join(' – ');
  if (first === last) return formatDay(first);
  if (a.y !== b.y) return [formatDay(first), formatDay(last)].join(' – ');
  if (a.m !== b.m) return `${a.d} ${short(a)} – ${b.d} ${short(b)} ${b.y}`;
  return `${a.d}–${b.d} ${short(a)} ${a.y}`;
}

/** '2026-09-01' → 'September 2026'. */
export function formatMonth(date: string): string {
  const p = parts(date);
  return p ? `${LONG_MONTHS[p.m - 1]!} ${p.y}` : date;
}

/** '1 day', '0.5 days', '3 days'. */
export function dayCount(count: number): string {
  return `${count} day${count === 1 ? '' : 's'}`;
}

/** Keeps free text inside the notification limits (title 200, body 2000). */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Full names for message text, keyed by user id. An id that is not found is
 * simply absent: callers fall back to a neutral word ("An employee").
 */
export async function fullNames(
  tx: Tx,
  organizationId: string,
  userIds: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === 'string'))];
  if (ids.length === 0) return new Map();
  const rows = await tx.query<{ id: string; fullName: string }>(sql`
    SELECT id, full_name AS "fullName"
    FROM app_user
    WHERE organization_id = ${organizationId} AND id = ANY(${ids}::uuid[])
  `);
  return new Map(rows.map((row) => [row.id, row.fullName]));
}

/**
 * Where someone sits now, for a "your position changed" message:
 * "Senior Developer, Development (Backend team), reporting to Tara Manager".
 */
export async function describePlacement(tx: Tx, organizationId: string, userId: string): Promise<string | null> {
  const row = await tx.maybeOne<{
    positionName: string | null;
    departmentName: string | null;
    teamName: string | null;
    managerName: string | null;
  }>(sql`
    SELECT p.name AS "positionName", d.name AS "departmentName", t.name AS "teamName",
           m.full_name AS "managerName"
    FROM app_user u
    LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
    LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
    LEFT JOIN team t ON t.organization_id = u.organization_id AND t.id = u.team_id
    LEFT JOIN app_user m ON m.organization_id = u.organization_id AND m.id = u.reports_to
    WHERE u.organization_id = ${organizationId} AND u.id = ${userId}::uuid
  `);
  if (row === null || row.positionName === null) return null;
  const unit = row.departmentName ? `, ${row.departmentName}${row.teamName ? ` (${row.teamName})` : ''}` : '';
  const line = row.managerName ? `, reporting to ${row.managerName}` : '';
  return `${row.positionName}${unit}${line}`;
}

/**
 * Splits a long recipient list so each `notify()` call stays inside the
 * audience limit (1000 explicit users per outbox row).
 */
export function inBatches<T>(items: readonly T[], size = 500): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}
