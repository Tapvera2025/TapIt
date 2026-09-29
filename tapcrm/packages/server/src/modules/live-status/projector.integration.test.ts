import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { fixedClock, toDateOnly } from '../../platform/time.js';
import { emitAboutPerson } from '../../platform/realtime/server.js';
import * as AttendanceFacade from '../attendance/facade.js';
import { STATUS_CHANNEL } from './channel.js';
import { LIVE_STATUS_EVENTS } from './events.js';
import { deliverStatusChanged } from './jobs.js';
import { registerLiveStatusProjector } from './projector.js';

vi.mock('../../platform/realtime/server.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  emitAboutPerson: vi.fn(),
}));

/**
 * Step 4 projector (§9.3): `refresh` writes `user_status` and enqueues
 * `live-status.status-changed` for the person, using the CURRENT
 * `app_user` placement as the routing subject (not the record's
 * placement snapshot).
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const ORG = randomUUID();
const DEPT_A = randomUUID();
const DEPT_B = randomUUID();
const TEAM_A = randomUUID();
const TEAM_B = randomUUID();
const POS = randomUUID();
const HR = randomUUID();
const USER = randomUUID();
const DAY = randomUUID();

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
const ist = (local: string) => new Date(`${local}+05:30`);

async function readStatus(userId: string) {
  const rows = (await asOwner(
    'read status',
    sql`SELECT state, work_date::text AS work_date, presence_confidence FROM user_status WHERE user_id = ${userId}`,
  )) as { state: string; workDate: string; presenceConfidence: string }[];
  return rows[0] ?? null;
}

const CONNECTOR = randomUUID();
const DEVICE = randomUUID();

/** A device event names the raw punch it came from (0058); this is that punch, already mapped. */
async function devicePunch(userId: string, local: string): Promise<string> {
  const id = randomUUID();
  await asOwner(
    'receive a punch',
    sql`
    INSERT INTO biometric_punch (id, organization_id, device_id, pin, occurred_at, corrected_at,
                                 applied_offset_seconds, raw_line, direction_at_receipt, meaning,
                                 dry_run_at_receipt, user_id)
    VALUES (${id}, ${ORG}, ${DEVICE}, ${id.slice(0, 8)}, ${ist(local)}, ${ist(local)}, 0, 'test',
            'entry', 'in', false, ${userId})`,
  );
  return id;
}

const arrival = (local: string, device?: string): AttendanceFacade.AppendEventInput => ({
  userId: USER,
  kind: 'in',
  at: ist(local),
  evidence: 'confirmed',
  ...(device === undefined
    ? { source: 'web' as const, remote: true }
    : { source: 'device' as const, biometricPunchId: device }),
});

async function statusChangedRows() {
  return (await asOwner(
    'read outbox rows',
    sql`
    SELECT id, payload, enqueued_at FROM domain_outbox
    WHERE organization_id = ${ORG} AND event_name = ${LIVE_STATUS_EVENTS.STATUS_CHANGED}
    ORDER BY enqueued_at`,
  )) as { id: string; payload: unknown; enqueuedAt: Date }[];
}

async function statusChangedPayloads() {
  const rows = (await asOwner(
    'read outbox',
    sql`
    SELECT payload FROM domain_outbox
    WHERE organization_id = ${ORG} AND event_name = 'live-status.status-changed'
    ORDER BY enqueued_at`,
  )) as { payload: { userId: string } }[];
  return rows.map((r) => r.payload);
}

describe.skipIf(!enabled)('live-status projector (PostgreSQL)', () => {
  beforeAll(async () => {
    registerLiveStatusProjector();
    await asOwner(
      'create organization',
      sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`LS${ORG.slice(0, 6)}`}, 'Live', 'Asia/Kolkata')`,
    );
    await asOwner(
      'departments',
      sql`INSERT INTO department (id, organization_id, code, name, kind)
          VALUES (${DEPT_A}, ${ORG}, 'DA', 'DA', 'operations'),
                 (${DEPT_B}, ${ORG}, 'DB', 'DB', 'operations')`,
    );
    await asOwner(
      'teams',
      sql`INSERT INTO team (id, organization_id, department_id, kind, name)
          VALUES (${TEAM_A}, ${ORG}, ${DEPT_A}, 'sales-team', 'Team A'),
                 (${TEAM_B}, ${ORG}, ${DEPT_B}, 'sales-team', 'Team B')`,
    );
    await asOwner(
      'position',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
          VALUES (${POS}, ${ORG}, ${DEPT_A}, 'OP', 'OP', 20)`,
    );
    for (const [i, id] of [HR, USER].entries()) {
      await asOwner(
        'person',
        sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id, team_id)
            VALUES (${id}, ${ORG}, 'employee', ${`EMP-LS${i}`}, ${`p${i}-${id}@t.io`}, ${`Person ${i}`}, ${POS}, ${DEPT_A}, ${TEAM_A})`,
      );
    }
    await asOwner(
      'shift',
      sql`INSERT INTO shift (id, organization_id, code, name, kind, created_by)
          VALUES (${DAY}, ${ORG}, 'DAY', 'Day', 'fixed', ${HR})`,
    );
    await asOwner(
      'version',
      sql`INSERT INTO shift_version (organization_id, shift_id, effective_from, start_time, end_time, grace_minutes,
                                     full_day_minutes, half_day_minutes, created_by)
          VALUES (${ORG}, ${DAY}, '2026-01-01', '09:00', '18:00', 10, 450, 240, ${HR})`,
    );
    await asOwner(
      'assignment',
      sql`INSERT INTO shift_assignment (organization_id, user_id, kind, shift_id, effective_from, created_by)
          VALUES (${ORG}, ${USER}, 'template', ${DAY}, '2026-09-01', ${HR})`,
    );
    await asOwner(
      'setting',
      sql`INSERT INTO shift_setting (organization_id, effective_from, max_closing_extension_minutes, created_by)
          VALUES (${ORG}, '2026-01-01', 240, ${HR})`,
    );
    await asOwner(
      'a connector',
      sql`INSERT INTO biometric_connector (id, organization_id, kind, name, created_by)
          VALUES (${CONNECTOR}, ${ORG}, 'zk-adms', 'Office', ${HR})`,
    );
    await asOwner(
      'a device',
      sql`INSERT INTO biometric_device (id, organization_id, connector_id, serial_number, name, timezone, created_by)
          VALUES (${DEVICE}, ${ORG}, ${CONNECTOR}, ${`LS${ORG.slice(0, 8)}`}, 'Front door', 'Asia/Kolkata', ${HR})`,
    );
  });

  afterAll(async () => {
    for (const table of [
      'domain_outbox',
      'user_status',
      'attendance_event_assignment',
      'attendance_overlay',
      'attendance_record',
      'attendance_day_open_state',
      'shift_setting',
      'shift_assignment',
      'shift_version',
      'shift',
    ]) {
      await asOwner(`clear ${table}`, sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${ORG}`);
    }
    await asOwner(
      'clear voids',
      sql`DELETE FROM attendance_event WHERE organization_id = ${ORG} AND supersedes_event_id IS NOT NULL`,
    );
    await asOwner('clear events', sql`DELETE FROM attendance_event WHERE organization_id = ${ORG}`);
    for (const table of ['biometric_punch', 'biometric_device', 'biometric_connector']) {
      await asOwner(
        `clear ${table}`,
        sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${ORG}`,
      );
    }
    await asOwner('clear directory', sql`DELETE FROM identity_email_directory WHERE organization_id = ${ORG}`);
    await asOwner('clear people', sql`DELETE FROM app_user WHERE organization_id = ${ORG}`);
    await asOwner('clear position', sql`DELETE FROM position WHERE organization_id = ${ORG}`);
    await asOwner('clear teams', sql`DELETE FROM team WHERE organization_id = ${ORG}`);
    await asOwner('clear departments', sql`DELETE FROM department WHERE organization_id = ${ORG}`);
    await asOwner('clear organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  it('openDay for today registers the projector; a NOT_IN row is written', async () => {
    const clock = fixedClock('2026-10-05T09:00:00+05:30');
    await expect(
      db.transaction(ctx(), (tx) =>
        AttendanceFacade.openDay(tx, USER, date('2026-10-05'), clock),
      ),
    ).resolves.toBeDefined();
    // openDay's Task 4a call to the projector will refresh; verify a row now exists.
    const row = await readStatus(USER);
    expect(row).not.toBeNull();
    expect(row!.state).toBe('NOT_IN');
    expect(row!.workDate).toBe('2026-10-05');
  });

  it('a punch on today produces WORKING and emits one status-changed outbox row', async () => {
    // Clear prior state from the previous case for isolation.
    await asOwner('clear status', sql`DELETE FROM user_status WHERE organization_id = ${ORG}`);
    await asOwner('clear outbox', sql`DELETE FROM domain_outbox WHERE organization_id = ${ORG}`);

    const clock = fixedClock('2026-10-05T09:00:00+05:30');
    await db.transaction(ctx(), (tx) =>
      AttendanceFacade.appendEvent(
        tx,
        {
          userId: USER,
          kind: 'in',
          at: ist('2026-10-05T09:00:00'),
          source: 'web',
          evidence: 'confirmed',
          remote: true,
        },
        clock,
      ),
    );
    const row = await readStatus(USER);
    expect(row).not.toBeNull();
    expect(row!.state).toBe('WORKING');
    expect(row!.workDate).toBe('2026-10-05');
    expect(row!.presenceConfidence).toBe('confirmed');
    const emits = await statusChangedPayloads();
    expect(emits.length).toBeGreaterThanOrEqual(1);
    expect(emits[emits.length - 1]).toMatchObject({ userId: USER });
  });

  it('the row names only the person; delivery routes on where they sit when it is delivered', async () => {
    await asOwner(
      'clear outbox',
      sql`DELETE FROM domain_outbox WHERE organization_id = ${ORG}`,
    );
    await db.transaction(ctx(), async (tx) => {
      await AttendanceFacade.presenceProjector()!.refresh(
        tx,
        USER,
        ist('2026-10-05T10:00:00'),
      );
    });
    const [row] = await statusChangedRows();
    expect(row!.payload).toEqual({ userId: USER });

    // Transferred after the row committed and before it drained.
    await asOwner(
      'transfer',
      sql`UPDATE app_user SET department_id = ${DEPT_B}, team_id = ${TEAM_B} WHERE id = ${USER}`,
    );
    vi.mocked(emitAboutPerson).mockClear();
    await deliverStatusChanged({
      id: row!.id,
      organizationId: ORG,
      name: LIVE_STATUS_EVENTS.STATUS_CHANGED,
      payload: row!.payload,
      enqueuedAt: row!.enqueuedAt,
    });
    expect(emitAboutPerson).toHaveBeenCalledTimes(1);
    expect(emitAboutPerson).toHaveBeenCalledWith(
      ORG,
      STATUS_CHANNEL,
      { userId: USER, departmentId: DEPT_B, teamId: TEAM_B },
      'status:changed',
      { userId: USER }, // RT-4: id-only client payload
    );
  });

  it('a person no longer in the organization is told nothing', async () => {
    vi.mocked(emitAboutPerson).mockClear();
    await deliverStatusChanged({
      id: randomUUID(),
      organizationId: ORG,
      name: LIVE_STATUS_EVENTS.STATUS_CHANGED,
      payload: { userId: randomUUID() },
      enqueuedAt: new Date(),
    });
    expect(emitAboutPerson).not.toHaveBeenCalled();
  });

  it('a retirement on its own changes the board', async () => {
    const clock = fixedClock('2026-10-06T09:30:00+05:30');
    const came = await db.transaction(ctx(), (tx) =>
      AttendanceFacade.appendEvent(tx, arrival('2026-10-06T09:00:00'), clock),
    );
    expect(await readStatus(USER)).toMatchObject({
      state: 'WORKING',
      workDate: '2026-10-06',
    });
    await db.transaction(ctx(), (tx) =>
      AttendanceFacade.retireEvent(tx, came.eventId, clock),
    );
    expect(await readStatus(USER)).toMatchObject({
      state: 'NOT_IN',
      workDate: '2026-10-06',
    });
  });

  it('a replacement writes one status row, after both of its writes', async () => {
    const clock = fixedClock('2026-10-07T09:05:00+05:30');
    const head = await db.transaction(ctx(), async (tx) =>
      AttendanceFacade.appendEvent(
        tx,
        arrival('2026-10-07T09:00:40', await devicePunch(USER, '2026-10-07T09:00:40')),
        clock,
      ),
    );
    await asOwner(
      'clear outbox',
      sql`DELETE FROM domain_outbox WHERE organization_id = ${ORG}`,
    );
    const earlier = await devicePunch(USER, '2026-10-07T09:00:10');
    const replaced = await db.transaction(ctx(), (tx) =>
      AttendanceFacade.replaceDeviceEvent(
        tx,
        head.eventId,
        arrival('2026-10-07T09:00:10', earlier),
        clock,
      ),
    );
    expect(replaced.outcome).toBe('appended');
    expect(await statusChangedPayloads()).toEqual([{ userId: USER }]);
    expect(await readStatus(USER)).toMatchObject({
      state: 'WORKING',
      workDate: '2026-10-07',
    });
  });

  it('retiring an event of an old day leaves the board on the person’s current day', async () => {
    const clock = fixedClock('2026-10-07T09:10:00+05:30');
    const [old] = (await asOwner(
      'the 5 October arrival',
      sql`SELECT id FROM attendance_event
          WHERE user_id = ${USER} AND occurred_at = ${ist('2026-10-05T09:00:00')} AND NOT is_void`,
    )) as { id: string }[];
    const retired = await db.transaction(ctx(), (tx) =>
      AttendanceFacade.retireEvent(tx, old!.id, clock),
    );
    expect(retired.retired).toBe(true);
    expect(await readStatus(USER)).toMatchObject({
      state: 'WORKING',
      workDate: '2026-10-07',
    });
  });
});
