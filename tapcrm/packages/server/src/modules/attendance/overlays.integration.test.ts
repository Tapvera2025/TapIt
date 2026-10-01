import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { toDateOnly } from '../../platform/time.js';
import { applyOverlay, removeOverlays, type OverlayInput } from './overlays.js';

/**
 * Step 3c overlays (§8.1 L8, BM-5): leave and break-management's one seam.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const ORG = randomUUID();
const DEPT = randomUUID();
const POS = randomUUID();
const HR = randomUUID();
const USER = randomUUID();
const NIGHT = randomUUID();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);
const ctx = () =>
  createJobContext({
    organizationId: ORG,
    principal: systemPrincipal(ORG),
    jobName: 'test',
    runId: randomUUID(),
  });
const date = toDateOnly;
/** The seam takes the caller's transaction; each call here is its own. */
const apply = (input: OverlayInput) =>
  db.transaction(ctx(), (tx) => applyOverlay(tx, input));
const remove = (kind: OverlayInput['sourceKind'], sourceId: string) =>
  db.transaction(ctx(), (tx) => removeOverlays(tx, kind, sourceId));

interface OverlayRow {
  kind: string;
  paid: boolean | null;
  consequence: string | null;
  minutes: number | null;
  leaveRequestId: string | null;
  breakBreachId: string | null;
}
async function overlaysOn(userId: string, day: string): Promise<OverlayRow[]> {
  return (await asOwner(
    'read overlays',
    sql`
      SELECT kind, paid, consequence, minutes, leave_request_id, break_breach_id
      FROM attendance_overlay WHERE user_id = ${userId} AND work_date = ${day} ORDER BY kind
    `,
  )) as OverlayRow[];
}

async function recalcCount(userId: string, day: string): Promise<number> {
  const rows = (await asOwner(
    'count recalc',
    sql`
      SELECT count(*)::int AS n FROM domain_outbox
      WHERE organization_id = ${ORG}
        AND event_name = 'attendance.recalc-requested'
        AND payload->>'userId' = ${userId}
        AND payload->>'workDate' = ${day}
    `,
  )) as { n: number }[];
  return rows[0]!.n;
}

async function inputVersion(userId: string, day: string): Promise<number | null> {
  const rows = (await asOwner(
    'read input_version',
    sql`SELECT input_version FROM attendance_record WHERE user_id = ${userId} AND work_date = ${day}`,
  )) as { inputVersion: number }[];
  return rows[0]?.inputVersion ?? null;
}

/**
 * Overlays point at what created them, and since steps 6 and 8 the database
 * holds them to it: a leave overlay needs a real leave request, a breach
 * overlay a real breach. These make the smallest real ones.
 */
const leaveTypes = new Map<string, string>();
async function leaveRequest(kind: 'absence' | 'attendance-mode', day: string, last = day): Promise<string> {
  let typeId = leaveTypes.get(kind);
  if (!typeId) {
    typeId = randomUUID();
    await asOwner('leave type', sql`
      INSERT INTO leave_type (id, organization_id, code, name, kind, enforcement, paid_leave, created_by)
      VALUES (${typeId}, ${ORG}, ${kind === 'absence' ? 'AL' : 'WFH'}, ${kind === 'absence' ? 'Annual' : 'Work from home'},
              ${kind}, false, ${kind === 'absence'}, ${HR})
    `);
    leaveTypes.set(kind, typeId);
  }
  const id = randomUUID();
  await asOwner('leave request', sql`
    INSERT INTO leave_request (id, organization_id, user_id, leave_type_id, kind, from_date, to_date, reason, requested_by)
    VALUES (${id}, ${ORG}, ${USER}, ${typeId}, ${kind}, ${day}, ${last}, 'Overlay test', ${USER})
  `);
  return id;
}

async function breach(): Promise<string> {
  const policyId = randomUUID();
  const versionId = randomUUID();
  const recordId = randomUUID();
  const id = randomUUID();
  const day = '2026-07-01';
  await asOwner('break policy', sql`INSERT INTO break_policy (id, organization_id, name) VALUES (${policyId}, ${ORG}, 'Overlay test')`);
  await asOwner('break policy version', sql`
    INSERT INTO break_policy_version (id, organization_id, policy_id, effective_from, upper_total_minutes,
                                      grace_minutes, warning_percent, counts_toward_work_hours)
    VALUES (${versionId}, ${ORG}, ${policyId}, '2026-01-01', 60, 5, 80, true)
  `);
  await asOwner('the breached day', sql`
    INSERT INTO attendance_record (id, organization_id, user_id, work_date, state, window_start, window_end,
                                   shift_source, shift_snapshot, placement_snapshot, close_due_at, day_type)
    VALUES (${recordId}, ${ORG}, ${USER}, ${day}, 'closed', ${`${day}T00:00:00+05:30`}, ${`${day}T23:59:00+05:30`},
            'default', '{}'::jsonb, '{}'::jsonb, ${`${day}T23:00:00+05:30`}, 'working')
  `);
  await asOwner('breach', sql`
    INSERT INTO break_breach (id, organization_id, user_id, attendance_record_id, work_date, policy_version_id,
                              evidence_fingerprint, answer_fingerprint, calculation_version, status)
    VALUES (${id}, ${ORG}, ${USER}, ${recordId}, ${day}, ${versionId}, 'evidence', 'answer', 1, 'pending')
  `);
  return id;
}

describe.skipIf(!enabled)('attendance overlays (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'create organization',
      sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`OV${ORG.slice(0, 6)}`}, 'Overlays', 'Asia/Kolkata')`,
    );
    await asOwner(
      'create department',
      sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${DEPT}, ${ORG}, 'OPS', 'Operations', 'operations')`,
    );
    await asOwner(
      'create position',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
          VALUES (${POS}, ${ORG}, ${DEPT}, 'OPS-1', 'Operator', 20)`,
    );
    for (const [i, id] of [HR, USER].entries()) {
      await asOwner(
        'create person',
        sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
            VALUES (${id}, ${ORG}, 'employee', ${`EMP-OV${String(i).padStart(3, '0')}`},
                    ${`p${i}-${id}@t.io`}, ${`Person ${i}`}, ${POS}, ${DEPT})`,
      );
    }
    await asOwner(
      'shift',
      sql`INSERT INTO shift (id, organization_id, code, name, kind, created_by)
          VALUES (${NIGHT}, ${ORG}, 'NIGHT', 'Night', 'fixed', ${HR})`,
    );
    await asOwner(
      'version',
      sql`INSERT INTO shift_version (organization_id, shift_id, effective_from, start_time, end_time, grace_minutes,
                                     full_day_minutes, half_day_minutes, created_by)
          VALUES (${ORG}, ${NIGHT}, '2026-01-01', '20:00', '05:00', 10, 450, 240, ${HR})`,
    );
    await asOwner(
      'assignment',
      sql`INSERT INTO shift_assignment (organization_id, user_id, kind, shift_id, effective_from, created_by)
          VALUES (${ORG}, ${USER}, 'template', ${NIGHT}, '2026-09-01', ${HR})`,
    );
    await asOwner(
      'setting',
      sql`INSERT INTO shift_setting (organization_id, effective_from, max_closing_extension_minutes, created_by)
          VALUES (${ORG}, '2026-01-01', 240, ${HR})`,
    );
  });

  afterAll(async () => {
    for (const table of [
      'domain_outbox',
      'attendance_event_assignment',
      'attendance_overlay',
      'break_breach',
      'break_policy_version',
      'break_policy',
      'leave_request',
      'leave_type',
      'attendance_record',
      'attendance_day_open_state',
      'shift_setting',
      'shift_assignment',
      'shift_version',
      'shift',
    ]) {
      await asOwner(
        `clear ${table}`,
        sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${ORG}`,
      );
    }
    await asOwner(
      'clear voids',
      sql`DELETE FROM attendance_event WHERE organization_id = ${ORG} AND supersedes_event_id IS NOT NULL`,
    );
    await asOwner(
      'clear events',
      sql`DELETE FROM attendance_event WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'clear directory',
      sql`DELETE FROM identity_email_directory WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'clear people',
      sql`DELETE FROM app_user WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'clear position',
      sql`DELETE FROM position WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'clear department',
      sql`DELETE FROM department WHERE organization_id = ${ORG}`,
    );
    await asOwner('clear organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  it('full unpaid leave on a fresh day writes ONE overlay and ONE recalc event (no double event)', async () => {
    const day = '2026-10-15';
    const leaveId = await leaveRequest('absence', day);
    await apply({
      sourceKind: 'leave',
      sourceId: leaveId,
      userId: USER,
      workDate: date(day),
      kind: 'leave-full',
      paid: false,
    });

    const overlays = await overlaysOn(USER, day);
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toMatchObject({
      kind: 'leave-full',
      paid: false,
      leaveRequestId: leaveId,
      breakBreachId: null,
    });
    expect(await recalcCount(USER, day)).toBe(1); // regression guard for the two-event bug
    expect(await inputVersion(USER, day)).toBe(2); // v1 on create, +1 on overlay bump
  });

  it('first-half paid leave', async () => {
    const day = '2026-10-16';
    const leaveId = await leaveRequest('absence', day);
    await apply({
      sourceKind: 'leave',
      sourceId: leaveId,
      userId: USER,
      workDate: date(day),
      kind: 'leave-first-half',
      paid: true,
    });
    const overlays = await overlaysOn(USER, day);
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toMatchObject({ kind: 'leave-first-half', paid: true });
    expect(await recalcCount(USER, day)).toBe(1);
  });

  it('WFH overlay', async () => {
    const day = '2026-10-17';
    const wfhId = await leaveRequest('attendance-mode', day);
    await apply({
      sourceKind: 'wfh',
      sourceId: wfhId,
      userId: USER,
      workDate: date(day),
      kind: 'wfh',
    });
    const overlays = await overlaysOn(USER, day);
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toMatchObject({
      kind: 'wfh',
      leaveRequestId: wfhId,
      breakBreachId: null,
    });
    expect(await recalcCount(USER, day)).toBe(1);
  });

  it('break-breach consequence: deduct 30 minutes', async () => {
    const day = '2026-10-18';
    const breachId = await breach();
    await apply({
      sourceKind: 'break-breach',
      sourceId: breachId,
      userId: USER,
      workDate: date(day),
      kind: 'breach-consequence',
      consequence: 'deduct-minutes',
      minutes: 30,
    });
    const overlays = await overlaysOn(USER, day);
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toMatchObject({
      kind: 'breach-consequence',
      consequence: 'deduct-minutes',
      minutes: 30,
      breakBreachId: breachId,
      leaveRequestId: null,
    });
    expect(await recalcCount(USER, day)).toBe(1);
  });

  it('re-applying the same overlay is a no-op (no second event, no bump)', async () => {
    const day = '2026-10-19';
    const leaveId = await leaveRequest('absence', day);
    const overlay = {
      sourceKind: 'leave' as const,
      sourceId: leaveId,
      userId: USER,
      workDate: date(day),
      kind: 'leave-full' as const,
      paid: true,
    };
    await apply(overlay);
    const v1 = await inputVersion(USER, day);
    const c1 = await recalcCount(USER, day);

    await apply(overlay);
    expect(await inputVersion(USER, day)).toBe(v1);
    expect(await recalcCount(USER, day)).toBe(c1);
    expect(await overlaysOn(USER, day)).toHaveLength(1);
  });

  it('removeOverlays(sourceId) removes every overlay from that source and requeues each day', async () => {
    const d1 = '2026-10-20';
    const d2 = '2026-10-21';
    const leaveId = await leaveRequest('absence', d1, d2);
    await apply({
      sourceKind: 'leave',
      sourceId: leaveId,
      userId: USER,
      workDate: date(d1),
      kind: 'leave-full',
      paid: true,
    });
    await apply({
      sourceKind: 'leave',
      sourceId: leaveId,
      userId: USER,
      workDate: date(d2),
      kind: 'leave-full',
      paid: true,
    });
    const before = { d1: await recalcCount(USER, d1), d2: await recalcCount(USER, d2) };

    await remove('leave', leaveId);
    expect(await overlaysOn(USER, d1)).toHaveLength(0);
    expect(await overlaysOn(USER, d2)).toHaveLength(0);
    // One new recalc event per day.
    expect(await recalcCount(USER, d1)).toBe(before.d1 + 1);
    expect(await recalcCount(USER, d2)).toBe(before.d2 + 1);
  });
});
