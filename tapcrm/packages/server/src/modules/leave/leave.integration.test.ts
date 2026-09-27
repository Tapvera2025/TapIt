/**
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… \
 *     npx vitest run packages/server/src/modules/leave/leave.integration.test.ts
 */
import type { DateOnly } from '@tapcrm/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { createTestContext } from '../../platform/test-helpers.js';
import { advanceStandingWfhForDate } from './jobs.js';
import {
  acknowledgeLeave, decideLeave, reconcileWfhForDate,
  submitLeave, submitStandingWfh, submitWfh,
} from './service.js';

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';

async function setup() {
  const orgId = (await platformDb.query<{ id: string }>('seed', 'create org',
    sql`INSERT INTO organization (name, slug) VALUES ('Test', 'test-' || gen_random_uuid()::text) RETURNING id`
  ))[0]!.id;

  const [empRows, mgrRows] = await Promise.all([
    platformDb.query<{ id: string }>('seed', 'create emp',
      sql`INSERT INTO app_user (organization_id, email, full_name, account_type)
          VALUES (${orgId}, 'emp@test.invalid', 'Employee', 'employee') RETURNING id`),
    platformDb.query<{ id: string }>('seed', 'create mgr',
      sql`INSERT INTO app_user (organization_id, email, full_name, account_type)
          VALUES (${orgId}, 'mgr@test.invalid', 'Manager', 'employee') RETURNING id`),
  ]);
  const empId = empRows[0]!.id;
  const mgrId = mgrRows[0]!.id;

  const ltId = (await platformDb.query<{ id: string }>('seed', 'create leave type',
    sql`INSERT INTO leave_type (organization_id, code, name, kind, enforcement, paid_leave, created_by)
        VALUES (${orgId}, 'AL', 'Annual Leave', 'absence', FALSE, TRUE, ${mgrId}) RETURNING id`
  ))[0]!.id;

  const wfhTypeId = (await platformDb.query<{ id: string }>('seed', 'create wfh type',
    sql`INSERT INTO leave_type (organization_id, code, name, kind, enforcement, paid_leave, created_by)
        VALUES (${orgId}, 'WFH', 'Work From Home', 'attendance-mode', FALSE, FALSE, ${mgrId}) RETURNING id`
  ))[0]!.id;

  await platformDb.query('seed', 'create balance',
    sql`INSERT INTO leave_balance_entry (organization_id, user_id, leave_type_id, kind, units, period_year)
        VALUES (${orgId}, ${empId}, ${ltId}, 'opening', 12, 2026)`);

  return {
    orgId, empId, mgrId, ltId, wfhTypeId,
    empCtx: createTestContext(orgId, empId),
    mgrCtx: createTestContext(orgId, mgrId),
  };
}

async function forceAck(reqId: string, mgrId: string) {
  await platformDb.query('seed', 'force ack',
    sql`UPDATE leave_request SET status = 'acknowledged', acknowledged_by = ${mgrId},
        acknowledged_at = now() WHERE id = ${reqId}`);
}

describe.skipIf(!enabled)('leave integration', () => {
  afterAll(closePools);

  it('approval creates overlay rows and deducts balance atomically', async () => {
    const { mgrId, ltId, empCtx, mgrCtx } = await setup();
    const req = await submitLeave(empCtx, {
      leaveTypeId: ltId, fromDate: '2026-11-03', toDate: '2026-11-04',
      fromHalf: 'full', toHalf: 'full', reason: 'Annual leave',
    });
    await forceAck(req.id, mgrId);
    await decideLeave(mgrCtx, req.id, { decision: 'approved' });
    const overlays = await platformDb.query<{ workDate: string }>('seed', 'check overlays',
      sql`SELECT work_date::text AS "workDate" FROM attendance_overlay WHERE leave_request_id = ${req.id}`);
    expect(overlays.length).toBeGreaterThan(0);
    const status = await platformDb.query<{ status: string }>('seed', 'check status',
      sql`SELECT status FROM leave_request WHERE id = ${req.id}`);
    expect(status[0]!.status).toBe('approved');
    const outbox = await platformDb.query<{ eventName: string }>('seed', 'check outbox',
      sql`SELECT event_name AS "eventName" FROM domain_outbox WHERE payload->>'requestId' = ${req.id}`);
    expect(outbox.some(o => o.eventName === 'leave.decided')).toBe(true);
  });

  it('revocation removes overlays and inserts exactly one reversal entry (enforcement enabled)', async () => {
    const { orgId, empId, mgrId, empCtx, mgrCtx } = await setup();
    const enfTypeId = (await platformDb.query<{ id: string }>('seed', 'create enf type',
      sql`INSERT INTO leave_type (organization_id, code, name, kind, enforcement, paid_leave, created_by)
          VALUES (${orgId}, 'SL', 'Sick Leave', 'absence', TRUE, TRUE, ${mgrId}) RETURNING id`
    ))[0]!.id;
    await platformDb.query('seed', 'create enf balance',
      sql`INSERT INTO leave_balance_entry (organization_id, user_id, leave_type_id, kind, units, period_year)
          VALUES (${orgId}, ${empId}, ${enfTypeId}, 'opening', 10, 2026)`);
    const req = await submitLeave(empCtx, {
      leaveTypeId: enfTypeId, fromDate: '2026-11-10', toDate: '2026-11-10',
      fromHalf: 'full', toHalf: 'full', reason: 'Sick',
    });
    await forceAck(req.id, mgrId);
    await decideLeave(mgrCtx, req.id, { decision: 'approved' });
    await decideLeave(mgrCtx, req.id, { decision: 'revoked' });
    const overlays = await platformDb.query<{ id: string }>('seed', 'check overlays after revoke',
      sql`SELECT id FROM attendance_overlay WHERE leave_request_id = ${req.id}`);
    expect(overlays).toHaveLength(0);
    const reversals = await platformDb.query<{ kind: string }>('seed', 'check reversals',
      sql`SELECT kind FROM leave_balance_entry WHERE leave_request_id = ${req.id} AND kind = 'reversal'`);
    expect(reversals).toHaveLength(1);
    const status = await platformDb.query<{ status: string }>('seed', 'check status after revoke',
      sql`SELECT status FROM leave_request WHERE id = ${req.id}`);
    expect(status[0]!.status).toBe('cancelled');
  });

  it('concurrent approval: only one succeeds', async () => {
    const { orgId, mgrId, ltId, empCtx, mgrCtx } = await setup();
    const mgrCtx2 = createTestContext(orgId, mgrId);
    const req = await submitLeave(empCtx, {
      leaveTypeId: ltId, fromDate: '2026-11-17', toDate: '2026-11-17',
      fromHalf: 'full', toHalf: 'full', reason: 'Race test',
    });
    await forceAck(req.id, mgrId);
    const [r1, r2] = await Promise.allSettled([
      decideLeave(mgrCtx,  req.id, { decision: 'approved' }),
      decideLeave(mgrCtx2, req.id, { decision: 'approved' }),
    ]);
    expect([r1, r2].filter(r => r.status === 'fulfilled').length).toBe(1);
    expect([r1, r2].filter(r => r.status === 'rejected').length).toBe(1);
    const overlays = await platformDb.query<{ id: string }>('seed', 'check concurrent overlays',
      sql`SELECT id FROM attendance_overlay WHERE leave_request_id = ${req.id}`);
    expect(overlays.length).toBeGreaterThan(0);
    const outbox = await platformDb.query<{ id: string }>('seed', 'check concurrent outbox',
      sql`SELECT id FROM domain_outbox WHERE event_name = 'leave.decided' AND payload->>'requestId' = ${req.id}`);
    expect(outbox).toHaveLength(1);
  });

  it('atomic rollback: late failure leaves no overlay, no approved status, no outbox event', async () => {
    const { orgId, empId, mgrId, empCtx, mgrCtx } = await setup();
    const enfTypeId = (await platformDb.query<{ id: string }>('seed', 'create enf type 2',
      sql`INSERT INTO leave_type (organization_id, code, name, kind, enforcement, paid_leave, created_by)
          VALUES (${orgId}, 'SL2', 'Sick Leave 2', 'absence', TRUE, TRUE, ${mgrId}) RETURNING id`
    ))[0]!.id;
    await platformDb.query('seed', 'create enf balance 3',
      sql`INSERT INTO leave_balance_entry (organization_id, user_id, leave_type_id, kind, units, period_year)
          VALUES (${orgId}, ${empId}, ${enfTypeId}, 'opening', 10, 2026)`);
    const req = await submitLeave(empCtx, {
      leaveTypeId: enfTypeId, fromDate: '2026-11-24', toDate: '2026-11-24',
      fromHalf: 'full', toHalf: 'full', reason: 'Rollback test',
    });
    await forceAck(req.id, mgrId);
    await platformDb.query('seed', 'insert dup consumption',
      sql`INSERT INTO leave_balance_entry
            (organization_id, user_id, leave_type_id, kind, units, leave_request_id, period_year)
          VALUES (${orgId}, ${empId}, ${enfTypeId}, 'consumption', 1, ${req.id}, 2026)`);
    await expect(decideLeave(mgrCtx, req.id, { decision: 'approved' })).rejects.toThrow();
    const status = await platformDb.query<{ status: string }>('seed', 'check rollback status',
      sql`SELECT status FROM leave_request WHERE id = ${req.id}`);
    expect(status[0]!.status).toBe('acknowledged');
    const overlays = await platformDb.query<{ id: string }>('seed', 'check rollback overlays',
      sql`SELECT id FROM attendance_overlay WHERE leave_request_id = ${req.id}`);
    expect(overlays).toHaveLength(0);
    const outbox = await platformDb.query<{ id: string }>('seed', 'check rollback outbox',
      sql`SELECT id FROM domain_outbox WHERE event_name = 'leave.decided' AND payload->>'requestId' = ${req.id}`);
    expect(outbox).toHaveLength(0);
    const consumptions = await platformDb.query<{ id: string }>('seed', 'check rollback consumptions',
      sql`SELECT id FROM leave_balance_entry WHERE leave_request_id = ${req.id} AND kind = 'consumption'`);
    expect(consumptions).toHaveLength(1);
  });

  it('WFH approval inserts work_from_home_day rows and wfh overlays', async () => {
    const { mgrId, wfhTypeId, empCtx, mgrCtx } = await setup();
    const req = await submitWfh(empCtx, {
      leaveTypeId: wfhTypeId, fromDate: '2026-12-01', toDate: '2026-12-01',
      reason: 'WFH day',
    });
    await forceAck(req.id, mgrId);
    await decideLeave(mgrCtx, req.id, { decision: 'approved' });
    const wfhDays = await platformDb.query<{ workDate: string }>('seed', 'check wfh days',
      sql`SELECT work_date::text AS "workDate" FROM work_from_home_day WHERE leave_request_id = ${req.id}`);
    expect(wfhDays.length).toBeGreaterThan(0);
    const wfhOverlays = await platformDb.query<{ kind: string }>('seed', 'check wfh overlays',
      sql`SELECT kind FROM attendance_overlay WHERE leave_request_id = ${req.id}`);
    expect(wfhOverlays.every(o => o.kind === 'wfh')).toBe(true);
  });

  it('self-acknowledge throws LEAVE_SELF_ACKNOWLEDGE', async () => {
    const { ltId, empCtx } = await setup();
    const req = await submitLeave(empCtx, {
      leaveTypeId: ltId, fromDate: '2026-12-08', toDate: '2026-12-08',
      fromHalf: 'full', toHalf: 'full', reason: 'Self-ack test',
    });
    await expect(acknowledgeLeave(empCtx, req.id))
      .rejects.toMatchObject({ code: 'LEAVE_SELF_ACKNOWLEDGE' });
  });

  it('original decided_by preserved after revocation', async () => {
    const { mgrId, ltId, empCtx, mgrCtx } = await setup();
    const req = await submitLeave(empCtx, {
      leaveTypeId: ltId, fromDate: '2026-12-15', toDate: '2026-12-15',
      fromHalf: 'full', toHalf: 'full', reason: 'Revoke test',
    });
    await forceAck(req.id, mgrId);
    await decideLeave(mgrCtx, req.id, { decision: 'approved' });
    await decideLeave(mgrCtx, req.id, { decision: 'revoked' });
    const row = await platformDb.query<{ decidedBy: string; revokedBy: string }>('seed', 'check provenance',
      sql`SELECT decided_by AS "decidedBy", revoked_by AS "revokedBy" FROM leave_request WHERE id = ${req.id}`);
    expect(row[0]!.decidedBy).toBe(mgrId);
    expect(row[0]!.revokedBy).toBe(mgrId);
  });

  it('WFH-7: approved WFH displaced when absence approved on same date', async () => {
    const { mgrId, wfhTypeId, ltId, empCtx, mgrCtx } = await setup();
    const wfhReq = await submitWfh(empCtx, {
      leaveTypeId: wfhTypeId, fromDate: '2026-12-22', toDate: '2026-12-22', reason: 'WFH',
    });
    await forceAck(wfhReq.id, mgrId);
    await decideLeave(mgrCtx, wfhReq.id, { decision: 'approved' });
    const wfhDaysBefore = await platformDb.query<{ id: string }>('seed', 'check wfh days before',
      sql`SELECT id FROM work_from_home_day WHERE leave_request_id = ${wfhReq.id} AND work_date = '2026-12-22'`);
    expect(wfhDaysBefore.length).toBeGreaterThan(0);
    const absReq = await submitLeave(empCtx, {
      leaveTypeId: ltId, fromDate: '2026-12-22', toDate: '2026-12-22',
      fromHalf: 'full', toHalf: 'full', reason: 'Leave',
    });
    await forceAck(absReq.id, mgrId);
    await decideLeave(mgrCtx, absReq.id, { decision: 'approved' });
    const wfhDaysAfter = await platformDb.query<{ id: string }>('seed', 'check wfh days after',
      sql`SELECT id FROM work_from_home_day WHERE leave_request_id = ${wfhReq.id} AND work_date = '2026-12-22'`);
    expect(wfhDaysAfter).toHaveLength(0);
    const wfhOverlaysAfter = await platformDb.query<{ id: string }>('seed', 'check wfh overlays after',
      sql`SELECT id FROM attendance_overlay WHERE leave_request_id = ${wfhReq.id} AND work_date = '2026-12-22'`);
    expect(wfhOverlaysAfter).toHaveLength(0);
  });

  it('WFH-7: absence wins when WFH approved after already-approved absence', async () => {
    const { mgrId, wfhTypeId, ltId, empCtx, mgrCtx } = await setup();
    const wfhReq = await submitWfh(empCtx, {
      leaveTypeId: wfhTypeId, fromDate: '2026-12-23', toDate: '2026-12-23', reason: 'WFH',
    });
    const absReq = await submitLeave(empCtx, {
      leaveTypeId: ltId, fromDate: '2026-12-23', toDate: '2026-12-23',
      fromHalf: 'full', toHalf: 'full', reason: 'Leave',
    });
    await forceAck(absReq.id, mgrId);
    await decideLeave(mgrCtx, absReq.id, { decision: 'approved' });
    await forceAck(wfhReq.id, mgrId);
    await decideLeave(mgrCtx, wfhReq.id, { decision: 'approved' });
    const wfhDays = await platformDb.query<{ id: string }>('seed', 'check wfh days absence wins',
      sql`SELECT id FROM work_from_home_day WHERE leave_request_id = ${wfhReq.id} AND work_date = '2026-12-23'`);
    expect(wfhDays).toHaveLength(0);
    const wfhOverlays = await platformDb.query<{ id: string }>('seed', 'check wfh overlays absence wins',
      sql`SELECT id FROM attendance_overlay WHERE leave_request_id = ${wfhReq.id} AND work_date = '2026-12-23'`);
    expect(wfhOverlays).toHaveLength(0);
  });

  it('WFH-7: standing-WFH job does not recreate WFH after absence displacement', async () => {
    const today = '2026-12-20' as unknown as DateOnly;
    const { orgId, mgrId, wfhTypeId, ltId, empCtx, mgrCtx } = await setup();
    const wfhReq = await submitStandingWfh(empCtx, {
      leaveTypeId: wfhTypeId, fromDate: '2026-12-24', recurrenceEnd: '2026-12-31', reason: 'Standing WFH',
    });
    await forceAck(wfhReq.id, mgrId);
    await decideLeave(mgrCtx, wfhReq.id, { decision: 'approved' });
    const absReq = await submitLeave(empCtx, {
      leaveTypeId: ltId, fromDate: '2026-12-24', toDate: '2026-12-24',
      fromHalf: 'full', toHalf: 'full', reason: 'Leave',
    });
    await forceAck(absReq.id, mgrId);
    await decideLeave(mgrCtx, absReq.id, { decision: 'approved' });
    const beforeJob = await platformDb.query<{ id: string }>('seed', 'check before job',
      sql`SELECT id FROM work_from_home_day WHERE leave_request_id = ${wfhReq.id} AND work_date = '2026-12-24'`);
    expect(beforeJob).toHaveLength(0);
    await advanceStandingWfhForDate(orgId, today);
    const wfhDays = await platformDb.query<{ id: string }>('seed', 'check after job wfh days',
      sql`SELECT id FROM work_from_home_day WHERE leave_request_id = ${wfhReq.id} AND work_date = '2026-12-24'`);
    expect(wfhDays).toHaveLength(0);
    const wfhOverlays = await platformDb.query<{ id: string }>('seed', 'check after job wfh overlays',
      sql`SELECT id FROM attendance_overlay WHERE leave_request_id = ${wfhReq.id} AND work_date = '2026-12-24'`);
    expect(wfhOverlays).toHaveLength(0);
  });

  it('WFH-7: absence revocation restores previously displaced WFH', async () => {
    const { mgrId, wfhTypeId, ltId, empCtx, mgrCtx } = await setup();
    const wfhReq = await submitWfh(empCtx, {
      leaveTypeId: wfhTypeId, fromDate: '2026-12-29', toDate: '2026-12-29', reason: 'WFH',
    });
    await forceAck(wfhReq.id, mgrId);
    await decideLeave(mgrCtx, wfhReq.id, { decision: 'approved' });
    const absReq = await submitLeave(empCtx, {
      leaveTypeId: ltId, fromDate: '2026-12-29', toDate: '2026-12-29',
      fromHalf: 'full', toHalf: 'full', reason: 'Leave',
    });
    await forceAck(absReq.id, mgrId);
    await decideLeave(mgrCtx, absReq.id, { decision: 'approved' });
    const wfhAfterAbsence = await platformDb.query<{ id: string }>('seed', 'check wfh after absence',
      sql`SELECT id FROM work_from_home_day WHERE leave_request_id = ${wfhReq.id} AND work_date = '2026-12-29'`);
    expect(wfhAfterAbsence).toHaveLength(0);
    await decideLeave(mgrCtx, absReq.id, { decision: 'revoked' });
    const wfhRestored = await platformDb.query<{ id: string }>('seed', 'check wfh restored',
      sql`SELECT id FROM work_from_home_day WHERE leave_request_id = ${wfhReq.id} AND work_date = '2026-12-29'`);
    expect(wfhRestored.length).toBeGreaterThan(0);
    const overlayRestored = await platformDb.query<{ kind: string }>('seed', 'check overlay restored',
      sql`SELECT kind FROM attendance_overlay WHERE leave_request_id = ${wfhReq.id} AND work_date = '2026-12-29'`);
    expect(overlayRestored.some(o => o.kind === 'wfh')).toBe(true);
  });
});
