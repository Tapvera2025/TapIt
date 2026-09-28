import { randomUUID } from 'node:crypto';
import type { Principal } from '@tapcrm/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installAuthz } from '../../platform/authz-adapter.js';
import {
  createJobContext,
  createRequestContext,
  systemPrincipal,
} from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { fixedClock, toDateOnly } from '../../platform/time.js';
import { appendEvent } from './facade.js';
import { registerAttendancePolicies } from './policy.js';
import { approveCorrection, bulkCorrection, raiseCorrection, requestCorrection } from './correction.js';

/**
 * Mandatory PostgreSQL gate for the correction and closure workflow (§12).
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */

const ORG = randomUUID();
const DEPT1 = randomUUID();
const DEPT2 = randomUUID();
const POS_HR1 = randomUUID();
const POS_HR2 = randomUUID();
const POS_EMP = randomUUID();
const POS_SA = randomUUID();
const SUBJECT = randomUUID();
const HR1 = randomUUID();
const HR2 = randomUUID();
const SA = randomUUID();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

/** IST wall-clock → UTC Date */
const ist = (local: string) => new Date(`${local}+05:30`);
const d = toDateOnly;

const WORK_DATE = d('2026-09-01');
const CLOCK_NOW = fixedClock(ist('2026-09-01T22:00:00')); // after shift end

function asPrincipal(userId: string, positionId: string, departmentId: string, isSa = false): Principal {
  if (isSa) {
    return {
      id: userId,
      organizationId: ORG,
      sessionVersion: 1,
      accountType: 'super-admin',
      positionId,
      departmentId,
      teamId: null,
      reportsTo: null,
      organizationalLevel: 99,
    } as unknown as Principal;
  }
  return {
    id: userId,
    organizationId: ORG,
    sessionVersion: 1,
    accountType: 'employee',
    positionId,
    departmentId,
    teamId: null,
    reportsTo: null,
    organizationalLevel: 30,
  };
}

const ctxAs = (userId: string, positionId: string, departmentId = DEPT1, isSa = false) =>
  createRequestContext({
    organizationId: ORG,
    principal: asPrincipal(userId, positionId, departmentId, isSa),
    requestId: randomUUID(),
  });

const system = () =>
  createJobContext({
    organizationId: ORG,
    principal: systemPrincipal(ORG),
    jobName: 'test',
    runId: randomUUID(),
  });

describe('correction workflow (PostgreSQL)', () => {
  beforeAll(async () => {
    installAuthz();
    registerAttendancePolicies();

    await asOwner('org', sql`
      INSERT INTO organization (id, code, name, timezone)
      VALUES (${ORG}, ${`CT${ORG.slice(0, 6)}`}, 'Correction Test', 'Asia/Kolkata')
    `);
    await asOwner('departments', sql`
      INSERT INTO department (id, organization_id, code, name, kind)
      VALUES (${DEPT1}, ${ORG}, 'OPS', 'Operations', 'operations'),
             (${DEPT2}, ${ORG}, 'SAL', 'Sales', 'sales')
    `);
    await asOwner('positions', sql`
      INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
      VALUES (${POS_SA},  ${ORG}, ${DEPT1}, 'SA',  'Super Admin', 99),
             (${POS_HR1}, ${ORG}, ${DEPT1}, 'HR1', 'HR Raiser',   50),
             (${POS_HR2}, ${ORG}, ${DEPT1}, 'HR2', 'HR Approver', 50),
             (${POS_EMP}, ${ORG}, ${DEPT1}, 'EMP', 'Employee',    20)
    `);
    const users: [string, string, string][] = [
      [SUBJECT, POS_EMP, DEPT1],
      [HR1,     POS_HR1, DEPT1],
      [HR2,     POS_HR2, DEPT1],
      [SA,      POS_SA,  DEPT1],
    ];
    for (const [idx, [id, pos, dept]] of users.entries()) {
      await asOwner('user', sql`
        INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
        VALUES (${id}, ${ORG}, 'employee', ${`EMP-CT${idx}`}, ${`u${idx}-${ORG.slice(0,8)}@ct.io`},
                ${`User${idx}`}, ${pos}, ${dept})
      `);
    }
    // Super Admin is identified by accountType='super-admin' on the Principal — no DB row needed.
    // Position grants: HR1 can raise, HR2 can approve (attendance:correct), SUBJECT can request.
    const grants: [string, string, string][] = [
      [POS_HR1, 'attendance:raise-correction',    'all-people'],
      [POS_HR2, 'attendance:correct',             'all-people'],
      [POS_EMP, 'attendance:request-correction',  'own'],
    ];
    for (const [pos, action, scope] of grants) {
      await asOwner('grant', sql`
        INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
        VALUES (${ORG}, ${pos}, ${action}, true, ${scope})
      `);
    }

    // Open SUBJECT's work day so there is a record to attach events to.
    await asOwner('ensure_record', sql`
      INSERT INTO attendance_record
        (id, organization_id, user_id, work_date, state, window_start, window_end,
         close_due_at, input_version, shift_snapshot, shift_source, day_type, placement_snapshot)
      VALUES (${randomUUID()}, ${ORG}, ${SUBJECT}, ${WORK_DATE}, 'open',
              ${ist('2026-09-01T08:00:00')}, ${ist('2026-09-01T22:00:00')},
              ${ist('2026-09-01T22:00:00')},
              1, '{}', 'none', 'working',
              ${JSON.stringify({ departmentId: DEPT1, positionId: POS_EMP, teamId: null })}::jsonb)
    `);
  });

  afterAll(async () => {
    await closePools();
  });

  // ── Case 1: raise → approve, event is pinned ─────────────────────────────

  it('HR1 raises, HR2 approves; event is source=correction, pinned, correction=approved', async () => {
    const hr1 = ctxAs(HR1, POS_HR1);
    const { correctionId } = await raiseCorrection(hr1, {
      kind: 'add-event',
      userId: SUBJECT,
      workDate: WORK_DATE,
      reason: 'Test correction to add an entry event',
      payload: { kind: 'in', at: ist('2026-09-01T09:00:00').toISOString() },
    }, CLOCK_NOW);

    const hr2 = ctxAs(HR2, POS_HR2);
    await approveCorrection(hr2, correctionId, {}, CLOCK_NOW);

    const [event] = await asOwner('read event', sql`
      SELECT e.source, e.correction_id, a.pinned, a.reason
      FROM attendance_event e
      JOIN attendance_event_assignment a ON a.event_id = e.id
      WHERE e.correction_id = ${correctionId} AND e.is_void = false
    `) as { source: string; correction_id: string; pinned: boolean; reason: string }[];

    expect(event!.source).toBe('correction');
    expect(event!.pinned).toBe(true);
    expect(event!.reason).toBe('correction');

    const [correction] = await asOwner('read correction', sql`
      SELECT status FROM attendance_correction WHERE id = ${correctionId}
    `) as { status: string }[];
    expect(correction!.status).toBe('approved');

    // Domain outbox row must exist.
    const [outbox] = await asOwner('read outbox', sql`
      SELECT payload FROM domain_outbox
      WHERE organization_id = ${ORG} AND event_name = 'attendance.correction-decided'
        AND payload->>'correctionId' = ${correctionId}
    `) as { payload: unknown }[];
    expect(outbox).toBeDefined();

    // Audit outbox row must exist.
    const [audit] = await asOwner('read audit', sql`
      SELECT payload FROM audit_outbox
      WHERE organization_id = ${ORG} AND payload->>'targetId' = ${correctionId}
    `) as { payload: { actorId: string } }[];
    expect(audit!.payload.actorId).toBe(HR2);
  });

  // ── Case 2: A1 — requester cannot approve ────────────────────────────────

  it('A1: requester (HR1) cannot approve their own correction', async () => {
    const hr1 = ctxAs(HR1, POS_HR1);
    const { correctionId } = await raiseCorrection(hr1, {
      kind: 'add-event',
      userId: SUBJECT,
      workDate: WORK_DATE,
      reason: 'Another test correction for A1 check purpose',
      payload: { kind: 'out', at: ist('2026-09-01T18:30:00').toISOString() },
    }, CLOCK_NOW);

    // HR1 tries to approve their own correction — must fail with 403.
    await expect(
      approveCorrection(hr1, correctionId, {}, CLOCK_NOW),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('G4: subject (SUBJECT) cannot approve a correction to their own day', async () => {
    const hr1 = ctxAs(HR1, POS_HR1);
    const { correctionId } = await raiseCorrection(hr1, {
      kind: 'add-event',
      userId: SUBJECT,
      workDate: WORK_DATE,
      reason: 'A correction to test G4 self-approval prevention',
      payload: { kind: 'break-start', at: ist('2026-09-01T12:00:00').toISOString() },
    }, CLOCK_NOW);

    // SUBJECT tries to approve a correction for their own day — must fail.
    const subjectCtx = ctxAs(SUBJECT, POS_EMP);
    await expect(
      approveCorrection(subjectCtx, correctionId, {}, CLOCK_NOW),
    ).rejects.toMatchObject({ status: 403 });
  });

  // ── Case 3: AT-10 — P9 date check ────────────────────────────────────────

  it('AT-10: HR2 approved at exactly 60 days (allowed) and denied at 61 days', async () => {
    // today (org local) = 2026-09-01; 60 days earlier = 2026-07-03
    const workDate60 = d('2026-07-03');
    const workDate61 = d('2026-07-02');

    // Ensure records exist for both dates.
    for (const wd of [workDate60, workDate61]) {
      await asOwner('ensure_record', sql`
        INSERT INTO attendance_record
          (id, organization_id, user_id, work_date, state, window_start, window_end,
           close_due_at, input_version, shift_snapshot, shift_source, day_type, placement_snapshot)
        VALUES (${randomUUID()}, ${ORG}, ${SUBJECT}, ${wd}, 'open',
                ${ist(`${wd}T08:00:00`)}, ${ist(`${wd}T22:00:00`)},
                ${ist(`${wd}T22:00:00`)},
                1, '{}', 'none', 'working',
                ${JSON.stringify({ departmentId: DEPT1, positionId: POS_EMP, teamId: null })}::jsonb)
        ON CONFLICT (organization_id, user_id, work_date) DO NOTHING
      `);
    }

    const hr1 = ctxAs(HR1, POS_HR1);
    const hr2 = ctxAs(HR2, POS_HR2);
    const saCtx = ctxAs(SA, POS_SA, DEPT1, true);

    const { correctionId60 } = await raiseCorrection(hr1, {
      kind: 'add-event', userId: SUBJECT, workDate: workDate60,
      reason: 'Test correction at exactly 60 days boundary check',
      payload: { kind: 'in', at: ist(`${workDate60}T09:00:00`).toISOString() },
    }, CLOCK_NOW).then((r) => ({ correctionId60: r.correctionId }));

    // P9 also applies to raise-correction, so only SA can raise for dates > 60 days.
    // But SA cannot approve what SA raised (A1). Insert the 61-day correction
    // directly with requestedBy=HR1 so SA can approve without hitting A1.
    const correctionId61 = randomUUID();
    await asOwner('correction 61', sql`
      INSERT INTO attendance_correction
        (id, organization_id, user_id, work_date, kind, payload, reason, requested_by)
      VALUES (${correctionId61}, ${ORG}, ${SUBJECT}, ${workDate61}, 'add-event',
              ${JSON.stringify({ kind: 'in', at: ist(`${workDate61}T09:00:00`).toISOString() })}::jsonb,
              'P9: AT-10 61-day boundary test correction', ${HR1})
    `);

    // 60 days — allowed.
    await expect(approveCorrection(hr2, correctionId60, {}, CLOCK_NOW)).resolves.toBeDefined();

    // 61 days — denied for non-SA (P9 fires at step 5 after SA bypass at step 4).
    await expect(approveCorrection(hr2, correctionId61, {}, CLOCK_NOW)).rejects.toThrow();

    // Super Admin bypasses P9; SA ≠ HR1 (requestedBy) so A1 also passes.
    await expect(approveCorrection(saCtx, correctionId61, {}, CLOCK_NOW)).resolves.toBeDefined();
  });

  // ── Case 4: void-event 422 on superseded / wrong date ───────────────────

  it('void-event on already-superseded target returns 422 CORRECTION_TARGET_SUPERSEDED', async () => {
    // Get a real event assigned to SUBJECT's work day.
    const hr1 = ctxAs(HR1, POS_HR1);
    const hr2 = ctxAs(HR2, POS_HR2);

    // First raise+approve an add-event to get an event we can target.
    // By this point, only 'in' at 09:00 is effective, so 'break-start' is the
    // natural next event (IN → ON_BREAK); 'break-end' would need ON_BREAK first.
    const { correctionId: raiseId } = await raiseCorrection(hr1, {
      kind: 'add-event', userId: SUBJECT, workDate: WORK_DATE,
      reason: 'Seed an event for subsequent void-event test case here',
      payload: { kind: 'break-start', at: ist('2026-09-01T12:30:00').toISOString() },
    }, CLOCK_NOW);
    await approveCorrection(hr2, raiseId, {}, CLOCK_NOW);

    // Get the newly created event's ID.
    const [eventRow] = await asOwner('find event', sql`
      SELECT e.id FROM attendance_event e
      WHERE e.correction_id = ${raiseId} AND e.is_void = false
    `) as { id: string }[];
    const targetEventId = eventRow!.id;

    // First void: should succeed.
    const { correctionId: void1Id } = await raiseCorrection(hr1, {
      kind: 'void-event', userId: SUBJECT, workDate: WORK_DATE,
      reason: 'First void of the break-end event to test supersession',
      payload: { targetEventId },
    }, CLOCK_NOW);
    await approveCorrection(hr2, void1Id, {}, CLOCK_NOW);

    // Second void of same already-superseded target: 422.
    const { correctionId: void2Id } = await raiseCorrection(hr1, {
      kind: 'void-event', userId: SUBJECT, workDate: WORK_DATE,
      reason: 'Second void attempt to verify superseded target rejection',
      payload: { targetEventId },
    }, CLOCK_NOW);
    await expect(
      approveCorrection(hr2, void2Id, {}, CLOCK_NOW),
    ).rejects.toMatchObject({ status: 422, code: 'ATTENDANCE_CORRECTION_TARGET_SUPERSEDED' });
  });

  // ── Case 5: bulk correction creates pending rows with batchId ───────────

  it('bulk correction creates pending add-event rows under a common batchId', async () => {
    const hr1 = ctxAs(HR1, POS_HR1);
    const { batchId, count } = await bulkCorrection(hr1, {
      kind: 'add-event',
      workDate: WORK_DATE,
      reason: 'Bulk test add-event correction for a group of employees',
      userIds: [SUBJECT],
      payload: { kind: 'in', at: ist('2026-09-01T08:45:00').toISOString() },
    }, CLOCK_NOW);

    expect(count).toBe(1);

    const rows = await asOwner('read bulk', sql`
      SELECT status, batch_id FROM attendance_correction
      WHERE batch_id = ${batchId}
    `) as { status: string; batchId: string }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending');
    expect(rows[0]!.batchId).toBe(batchId);
  });

  // ── Case 6: employee request (self) ──────────────────────────────────────

  it('employee can request a correction for their own day', async () => {
    const subjectCtx = ctxAs(SUBJECT, POS_EMP);
    const { correctionId } = await requestCorrection(subjectCtx, {
      kind: 'add-event',
      workDate: WORK_DATE,
      reason: 'Employee self-requesting a correction for their own work day',
      payload: { kind: 'out', at: ist('2026-09-01T19:00:00').toISOString() },
    }, CLOCK_NOW);

    const [row] = await asOwner('read correction', sql`
      SELECT requested_by, user_id, status FROM attendance_correction WHERE id = ${correctionId}
    `) as { requestedBy: string; userId: string; status: string }[];

    expect(row!.requestedBy).toBe(SUBJECT);
    expect(row!.userId).toBe(SUBJECT);
    expect(row!.status).toBe('pending');
  });

  // ── Case 7: void increments input_version and writes outbox ─────────────

  it('void-only approval bumps input_version and writes recalc-requested outbox', async () => {
    const hr1 = ctxAs(HR1, POS_HR1);
    const hr2 = ctxAs(HR2, POS_HR2);

    // Append an event via the ledger so it has an assignment.
    const { eventId } = await db.transaction(system(), (tx) =>
      appendEvent(tx, {
        userId: SUBJECT,
        kind: 'in',
        at: ist('2026-09-01T08:55:00'),
        source: 'web',
        evidence: 'confirmed',
      }),
    );

    const [before] = await asOwner('before version', sql`
      SELECT input_version FROM attendance_record WHERE user_id = ${SUBJECT} AND work_date = ${WORK_DATE}
    `) as { inputVersion: number }[];
    const versionBefore = before!.inputVersion;

    // Void it.
    const { correctionId } = await raiseCorrection(hr1, {
      kind: 'void-event', userId: SUBJECT, workDate: WORK_DATE,
      reason: 'Void an event and verify version bump and recalc outbox row',
      payload: { targetEventId: eventId },
    }, CLOCK_NOW);
    await approveCorrection(hr2, correctionId, {}, CLOCK_NOW);

    const [after] = await asOwner('after version', sql`
      SELECT input_version FROM attendance_record WHERE user_id = ${SUBJECT} AND work_date = ${WORK_DATE}
    `) as { inputVersion: number }[];
    expect(after!.inputVersion).toBeGreaterThan(versionBefore);

    const [outbox] = await asOwner('recalc outbox', sql`
      SELECT payload FROM domain_outbox
      WHERE organization_id = ${ORG} AND event_name = 'attendance.recalc-requested'
        AND payload->>'userId' = ${SUBJECT} AND payload->>'workDate' = ${WORK_DATE}
      ORDER BY id DESC LIMIT 1
    `) as { payload: { inputVersion: number } }[];
    expect(outbox!.payload.inputVersion).toBe(after!.inputVersion);
  });
});
