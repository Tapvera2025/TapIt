import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobContext, systemPrincipal } from '../platform/dal/context.js';
import { db, platformDb } from '../platform/dal/db.js';
import { closePools } from '../platform/dal/pool.js';
import { sql } from '../platform/dal/sql.js';
import {
  fixedClock,
  instantOfDeviceClock,
  toDeviceClockReading,
} from '../platform/time.js';
import { staleRecordIds } from '../modules/attendance/db.test-helpers.js';
import { recalculateRecord } from '../modules/attendance/recalculate.js';
import { ingest } from '../modules/biometric/ingest.js';
import type { NormalizedPunch } from '../modules/biometric/types.js';

/**
 * Acceptance, across modules (design §10.9 "Done when"): a device five
 * minutes fast produces no false lateness once its offset is set. The punch
 * goes the whole way — receipt, processing, attendance, calculation — so this
 * test sits outside any one module and may use each one's own helpers.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const IST = 'Asia/Kolkata';
const ORG = randomUUID();
const DEPT = randomUUID();
const POS = randomUUID();
const HR = randomUUID();
const ALICE = randomUUID();
const BOB = randomUUID();
const SHIFT = randomUUID();
const ZK = randomUUID();
const CORRECTED = randomUUID(); // five minutes fast, offset set
const UNCORRECTED = randomUUID(); // five minutes fast, offset not set

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);
const ctx = () =>
  createJobContext({
    organizationId: ORG,
    principal: systemPrincipal(ORG),
    jobName: 'test',
    runId: randomUUID(),
  });

/** Reader 1 is the way in, reader 2 the way out. */
function line(
  deviceId: string,
  pin: string,
  deviceSays: string,
  readerKey: '1' | '2',
): NormalizedPunch {
  const reading = toDeviceClockReading(deviceSays);
  return {
    deviceId,
    pin,
    deviceLocalTime: reading,
    occurredAt: instantOfDeviceClock(reading, IST).instant,
    statusCode: '0',
    statusKind: null,
    verifyMode: 'fingerprint',
    readerKey,
    externalEventId: null,
    raw: `${pin}\t${deviceSays}\t0\t1\t${readerKey}`,
  };
}

describe.skipIf(!enabled)(
  'a device five minutes fast, once its offset is set (PostgreSQL)',
  () => {
    beforeAll(async () => {
      await asOwner(
        'organization',
        sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`AC${ORG.slice(0, 6)}`}, 'Acceptance', ${IST})`,
      );
      await asOwner(
        'department',
        sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${DEPT}, ${ORG}, 'OPS', 'Operations', 'operations')`,
      );
      await asOwner(
        'position',
        sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
          VALUES (${POS}, ${ORG}, ${DEPT}, 'OP', 'Operator', 20)`,
      );
      await asOwner(
        'setup account',
        sql`INSERT INTO app_user (id, organization_id, account_type, email, full_name)
          VALUES (${HR}, ${ORG}, 'service', ${`hr-${HR}@t.io`}, 'Setup')`,
      );
      for (const [index, id] of [ALICE, BOB].entries()) {
        await asOwner(
          'employee',
          sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
            VALUES (${id}, ${ORG}, 'employee', ${`EMP-AC${index}`}, ${`a${index}-${id}@t.io`}, ${`Person ${index}`}, ${POS}, ${DEPT})`,
        );
      }
      await asOwner(
        'the shift',
        sql`INSERT INTO shift (id, organization_id, code, name, kind, created_by)
          VALUES (${SHIFT}, ${ORG}, 'DAY', 'Day', 'fixed', ${HR})`,
      );
      await asOwner(
        'its version: 09:00–18:00, ten minutes grace',
        sql`INSERT INTO shift_version (organization_id, shift_id, effective_from, start_time, end_time, grace_minutes,
                                     full_day_minutes, half_day_minutes, created_by)
          VALUES (${ORG}, ${SHIFT}, '2026-01-01', '09:00', '18:00', 10, 450, 240, ${HR})`,
      );
      await asOwner(
        'setting',
        sql`INSERT INTO shift_setting (organization_id, effective_from, max_closing_extension_minutes, created_by)
          VALUES (${ORG}, '2026-01-01', 240, ${HR})`,
      );
      for (const id of [ALICE, BOB]) {
        await asOwner(
          'template',
          sql`INSERT INTO shift_assignment (organization_id, user_id, kind, shift_id, effective_from, created_by)
            VALUES (${ORG}, ${id}, 'template', ${SHIFT}, '2026-01-01', ${HR})`,
        );
      }
      await asOwner(
        'connector',
        sql`INSERT INTO biometric_connector (id, organization_id, kind, name, created_by)
          VALUES (${ZK}, ${ORG}, 'zk-adms', 'ZK', ${HR})`,
      );
      for (const [id, serial, offset] of [
        [CORRECTED, 'C', -300],
        [UNCORRECTED, 'U', 0],
      ] as const) {
        await asOwner(
          'a live entry device, five minutes fast',
          sql`INSERT INTO biometric_device (id, organization_id, connector_id, serial_number, name, timezone,
                                          reader_direction, dry_run, status, clock_offset_seconds, created_by)
            VALUES (${id}, ${ORG}, ${ZK}, ${`${serial}-${ORG.slice(0, 8)}`}, ${serial}, ${IST}, 'undirected', false,
                    'enabled', ${offset}, ${HR})`,
        );
        await asOwner(
          'its readers',
          sql`INSERT INTO biometric_reader (organization_id, device_id, reader_key, label, direction)
            VALUES (${ORG}, ${id}, '1', 'In', 'entry'), (${ORG}, ${id}, '2', 'Out', 'exit')`,
        );
      }
      await asOwner(
        'PINs',
        sql`INSERT INTO biometric_pin_mapping (organization_id, connector_id, device_id, pin, user_id, effective_from, created_by)
          VALUES (${ORG}, ${ZK}, ${CORRECTED}, '001', ${ALICE}, '2026-01-01', ${HR}),
                 (${ORG}, ${ZK}, ${UNCORRECTED}, '002', ${BOB}, '2026-01-01', ${HR})`,
      );
    });

    afterAll(async () => {
      for (const table of [
        'domain_outbox',
        'attendance_event_assignment',
        'attendance_record',
        'attendance_month_summary',
      ]) {
        await asOwner(
          `clear ${table}`,
          sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${ORG}`,
        );
      }
      await asOwner(
        'clear punches and events',
        sql`WITH voids AS (DELETE FROM attendance_event WHERE organization_id = ${ORG} AND supersedes_event_id IS NOT NULL),
               punches AS (DELETE FROM biometric_punch WHERE organization_id = ${ORG})
          DELETE FROM attendance_event WHERE organization_id = ${ORG} AND supersedes_event_id IS NULL`,
      );
      for (const table of [
        'biometric_pin_mapping',
        'biometric_reader',
        'biometric_device',
        'biometric_connector',
        'shift_assignment',
        'shift_setting',
        'shift_version',
        'shift',
        'identity_email_directory',
        'app_user',
        'position',
        'department',
      ]) {
        await asOwner(
          `clear ${table}`,
          sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${ORG}`,
        );
      }
      await asOwner(
        'clear organization',
        sql`DELETE FROM organization WHERE id = ${ORG}`,
      );
      await closePools();
    });

    it('arrives on time by the true clock, and the day says so', async () => {
      // Both arrive at 09:08 true time, inside the grace; both devices show 09:13.
      for (const [deviceId, pin] of [
        [CORRECTED, '001'],
        [UNCORRECTED, '002'],
      ] as const) {
        await ingest(
          ctx(),
          {
            deviceId,
            punches: [line(deviceId, pin, '2026-10-05 09:13:00', '1')],
            realtime: true,
          },
          fixedClock('2026-10-05T09:08:00+05:30'),
        );
        await ingest(
          ctx(),
          {
            deviceId,
            punches: [line(deviceId, pin, '2026-10-05 18:05:00', '2')],
            realtime: true,
          },
          fixedClock('2026-10-05T18:00:00+05:30'),
        );
      }
      // Close the day as auto-close will (step 7), and calculate it.
      await asOwner(
        'close the day',
        sql`UPDATE attendance_record
          SET state = 'closed', closed_at = now(), closed_by = 'auto-close',
              input_version = input_version + 1, input_changed_at = now()
          WHERE organization_id = ${ORG}`,
      );
      for (const id of await staleRecordIds(ORG))
        await db.transaction(ctx(), (tx) => recalculateRecord(tx, id));

      const days = (await asOwner(
        'the calculated days',
        sql`SELECT user_id, arrival_at, late_minutes, status FROM attendance_record
          WHERE organization_id = ${ORG} AND work_date = '2026-10-05'`,
      )) as { userId: string; arrivalAt: Date; lateMinutes: number; status: string }[];
      const alice = days.find((day) => day.userId === ALICE)!;
      const bob = days.find((day) => day.userId === BOB)!;
      // Offset set: 09:08 by the true clock, inside the ten minutes' grace.
      expect(alice).toMatchObject({
        arrivalAt: new Date('2026-10-05T03:38:00Z'),
        lateMinutes: 0,
        status: 'present',
      });
      // Offset not set: the fast clock turns the same arrival into three minutes late.
      expect(bob).toMatchObject({
        arrivalAt: new Date('2026-10-05T03:43:00Z'),
        lateMinutes: 3,
      });
    });
  },
);
