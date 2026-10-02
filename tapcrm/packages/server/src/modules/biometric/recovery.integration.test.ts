import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { platformDb } from '../../platform/dal/db.js';
import type { GenerationDecision } from '../../platform/jobs/generation.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import {
  fixedClock,
  instantOfDeviceClock,
  toDeviceClockReading,
} from '../../platform/time.js';
import { checkDeviceHealth, notifyDeviceAlert, type AlertMailer } from './health.js';
import { receivePunches } from './ingest.js';
import { processPunch } from './pipeline.js';
import {
  runReplayRequest,
  sweepReplayRequests,
  sweepStrandedPunches,
  type SweptQueue,
} from './replay.js';
import type { NormalizedPunch } from './types.js';

/**
 * Step 5b's replay, recovery and health against real PostgreSQL (step 5 plan,
 * Task 6): a replay request worked to the end from its cursor, the sweeper
 * behind lost messages, silence while people are on shift, clock skew from
 * realtime pushes, and the alert mail — sent once, to whoever manages devices
 * for the whole organization.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const IST = 'Asia/Kolkata';

const ORG = randomUUID();
const DEPT = randomUUID();
const POS = { admin: randomUUID(), lead: randomUUID(), staff: randomUUID() };
const HR = randomUUID();
const ADMIN = randomUUID();
const LEAD = randomUUID();
const ALICE = randomUUID();
const SHIFT = randomUUID();
const ZK = randomUUID();
const FRONT = randomUUID(); // live
const QUIET = randomUUID(); // never heard from
const FAST = randomUUID(); // five minutes fast
const HALF = randomUUID(); // thirty minutes slow

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);
const ctx = () =>
  createJobContext({
    organizationId: ORG,
    principal: systemPrincipal(ORG),
    jobName: 'test',
    runId: randomUUID(),
  });

function line(deviceId: string, pin: string, local: string): NormalizedPunch {
  const reading = toDeviceClockReading(local);
  return {
    deviceId,
    pin,
    deviceLocalTime: reading,
    occurredAt: instantOfDeviceClock(reading, IST).instant,
    statusCode: '0',
    statusKind: null,
    verifyMode: 'fingerprint',
    readerKey: null,
    externalEventId: null,
    raw: `${pin}\t${local}\t0\t1`,
  };
}

const at = (local: string) => fixedClock(`${local}+05:30`);

async function statusOf(id: string) {
  const [row] = (await asOwner(
    'a punch',
    sql`SELECT status, status_reason, replay_count FROM biometric_punch WHERE id = ${id}`,
  )) as { status: string; statusReason: string | null; replayCount: number }[];
  return row!;
}

async function openAlerts(deviceId: string) {
  return (await asOwner(
    'open alerts',
    sql`SELECT kind FROM biometric_alert WHERE device_id = ${deviceId} AND resolved_at IS NULL ORDER BY kind`,
  )) as { kind: string }[];
}

/** A queue that records what the sweeper offers, answering from a table of decisions. */
function fakeQueue<P>(decisions: Map<string, GenerationDecision> = new Map()) {
  const offered: { key: string; payload: P }[] = [];
  const queue: SweptQueue<P> = {
    async enqueue({ key, payload }) {
      offered.push({ key, payload });
    },
    async nextGeneration(_tx, baseKey) {
      return decisions.get(baseKey) ?? { kind: 'run', key: baseKey, generation: 1 };
    },
  };
  return { queue, offered };
}

describe.skipIf(!enabled)('biometric replay, recovery and health (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'organization',
      sql`INSERT INTO organization (id, code, name, timezone)
          VALUES (${ORG}, ${`BR${ORG.slice(0, 6)}`}, 'Recovery', ${IST})`,
    );
    await asOwner(
      'department',
      sql`INSERT INTO department (id, organization_id, code, name, kind)
          VALUES (${DEPT}, ${ORG}, 'OPS', 'Operations', 'operations')`,
    );
    await asOwner(
      'positions',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
          VALUES (${POS.admin}, ${ORG}, ${DEPT}, 'HRA', 'HR admin', 50),
                 (${POS.lead}, ${ORG}, ${DEPT}, 'LEAD', 'Lead', 40),
                 (${POS.staff}, ${ORG}, ${DEPT}, 'STF', 'Staff', 20)`,
    );
    for (const [position, scope] of [
      [POS.admin, 'all-people'],
      [POS.lead, 'team'],
    ] as const) {
      await asOwner(
        'grant',
        sql`INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
            VALUES (${ORG}, ${position}, 'biometric:manage', true, ${scope})`,
      );
    }
    await asOwner(
      'setup account',
      sql`INSERT INTO app_user (id, organization_id, account_type, email, full_name)
          VALUES (${HR}, ${ORG}, 'service', ${`hr-${HR}@t.io`}, 'Setup')`,
    );
    const people: [string, string, string][] = [
      [ADMIN, POS.admin, 'admin'],
      [LEAD, POS.lead, 'lead'],
      [ALICE, POS.staff, 'alice'],
    ];
    for (const [index, [id, position, name]] of people.entries()) {
      await asOwner(
        'employee',
        sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
            VALUES (${id}, ${ORG}, 'employee', ${`EMP-BR${index}`}, ${`${name}-${id}@t.io`}, ${name}, ${position}, ${DEPT})`,
      );
    }
    await asOwner(
      'a day shift',
      sql`INSERT INTO shift (id, organization_id, code, name, kind, created_by)
          VALUES (${SHIFT}, ${ORG}, 'DAY', 'Day', 'fixed', ${HR})`,
    );
    await asOwner(
      'its version',
      sql`INSERT INTO shift_version (organization_id, shift_id, effective_from, start_time, end_time, grace_minutes,
                                     full_day_minutes, half_day_minutes, created_by)
          VALUES (${ORG}, ${SHIFT}, '2026-01-01', '09:00', '18:00', 10, 450, 240, ${HR})`,
    );
    await asOwner(
      'setting',
      sql`INSERT INTO shift_setting (organization_id, effective_from, max_closing_extension_minutes, created_by)
          VALUES (${ORG}, '2026-01-01', 240, ${HR})`,
    );
    await asOwner(
      'Alice works days',
      sql`INSERT INTO shift_assignment (organization_id, user_id, kind, shift_id, effective_from, created_by)
          VALUES (${ORG}, ${ALICE}, 'template', ${SHIFT}, '2026-01-01', ${HR})`,
    );
    await asOwner(
      'connector',
      sql`INSERT INTO biometric_connector (id, organization_id, kind, name, created_by)
          VALUES (${ZK}, ${ORG}, 'zk-adms', 'ZK fleet', ${HR})`,
    );
    for (const [id, serial] of [
      [FRONT, 'F'],
      [QUIET, 'Q'],
      [FAST, 'S'],
      [HALF, 'H'],
    ] as const) {
      await asOwner(
        'device',
        sql`INSERT INTO biometric_device (id, organization_id, connector_id, serial_number, name, timezone,
                                          reader_direction, dry_run, status, created_by)
            VALUES (${id}, ${ORG}, ${ZK}, ${`${serial}-${ORG.slice(0, 8)}`}, ${`Door ${serial}`}, ${IST},
                    'entry', false, 'enabled', ${HR})`,
      );
    }
    await asOwner(
      'Alice is 001 everywhere',
      sql`INSERT INTO biometric_pin_mapping (organization_id, connector_id, pin, user_id, effective_from, created_by)
          VALUES (${ORG}, ${ZK}, '001', ${ALICE}, '2026-01-01', ${HR})`,
    );
  });

  afterAll(async () => {
    for (const table of [
      'domain_outbox',
      'biometric_review_item',
      'biometric_alert',
      'biometric_replay_request',
    ]) {
      await asOwner(
        `clear ${table}`,
        sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${ORG}`,
      );
    }
    await asOwner(
      'clear links',
      sql`DELETE FROM attendance_event_assignment WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'clear records',
      sql`DELETE FROM attendance_record WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'clear punches and events',
      sql`WITH voids AS (DELETE FROM attendance_event WHERE organization_id = ${ORG} AND supersedes_event_id IS NOT NULL),
               punches AS (DELETE FROM biometric_punch WHERE organization_id = ${ORG})
          DELETE FROM attendance_event WHERE organization_id = ${ORG} AND supersedes_event_id IS NULL`,
    );
    for (const table of [
      'biometric_pin_mapping',
      'biometric_device',
      'biometric_connector',
      'shift_assignment',
      'shift_setting',
      'shift_version',
      'shift',
      'position_policy',
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
    await asOwner('clear organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  describe('replay', () => {
    it('works through the selection from its cursor, skipping what is already placed', async () => {
      const clock = at('2026-10-05T12:00:00');
      const receipt = await receivePunches(
        ctx(),
        {
          deviceId: FRONT,
          punches: [
            line(FRONT, '900', '2026-10-05 09:00:00'),
            line(FRONT, '900', '2026-10-05 18:00:00'),
            line(FRONT, '900', '2026-10-05 10:00:00'),
            line(FRONT, '001', '2026-10-05 09:05:00'),
          ],
        },
        at('2026-10-05T19:00:00'),
      );
      if (!receipt.stored) throw new Error('not stored');
      for (const id of receipt.newPunchIds) await processPunch(ctx(), id, { clock });
      const [first, second, third, alices] = receipt.newPunchIds;
      expect((await statusOf(first!)).status).toBe('unmapped');
      expect((await statusOf(alices!)).status).toBe('applied');

      await asOwner(
        'HR maps 900',
        sql`INSERT INTO biometric_pin_mapping (organization_id, connector_id, pin, user_id, effective_from, created_by)
            VALUES (${ORG}, ${ZK}, '900', ${ALICE}, '2026-10-01', ${HR})`,
      );
      // A run that died after the first punch left its cursor there.
      const sorted = [first!, second!, third!].sort();
      const [request] = (await asOwner(
        'a replay request',
        sql`INSERT INTO biometric_replay_request (organization_id, requested_by, reason, from_date, to_date,
                                                  selected_count, status, last_punch_id)
            VALUES (${ORG}, ${HR}, 'PIN 900 mapped late', '2026-10-05', '2026-10-05', 3, 'running', ${sorted[0]})
            RETURNING id`,
      )) as { id: string }[];

      expect(await runReplayRequest(ctx(), request!.id, at('2026-10-05T19:05:00'))).toBe(
        2,
      );
      expect((await statusOf(sorted[0]!)).status).toBe('unmapped'); // before the cursor
      for (const id of sorted.slice(1))
        expect(await statusOf(id)).toMatchObject({ replayCount: 1 });
      expect((await statusOf(alices!)).replayCount).toBe(0);
      const [done] = await asOwner(
        'the request',
        sql`SELECT status, processed_count, finished_at IS NOT NULL AS finished FROM biometric_replay_request
            WHERE id = ${request!.id}`,
      );
      expect(done).toEqual({ status: 'done', processedCount: 2, finished: true });
      // Finished requests are not run again.
      expect(await runReplayRequest(ctx(), request!.id)).toBe(0);
    });
  });

  describe('the sweeper', () => {
    it('offers punches still waiting a minute after arrival, and holds one whose retries are spent', async () => {
      const receipt = await receivePunches(
        ctx(),
        {
          deviceId: FRONT,
          punches: [
            line(FRONT, '001', '2026-10-06 09:00:00'),
            line(FRONT, '001', '2026-10-06 13:00:00'),
          ],
        },
        at('2026-10-06T13:30:00'),
      );
      if (!receipt.stored) throw new Error('not stored');
      const [lost, spent] = receipt.newPunchIds;
      const { queue, offered } = fakeQueue<{ punchId: string }>(
        new Map([[`${spent}:0`, { kind: 'exhausted' }]]),
      );

      // Too soon: the first delivery may still be on its way.
      expect(
        await sweepStrandedPunches(ctx(), queue, new Date('2026-10-06T08:00:30Z')),
      ).toBe(0);
      expect(
        await sweepStrandedPunches(ctx(), queue, new Date('2026-10-06T08:05:00Z')),
      ).toBe(1);
      expect(offered).toEqual([{ key: `${lost}:0`, payload: { punchId: lost } }]);
      expect(await statusOf(spent!)).toMatchObject({
        status: 'held',
        statusReason: 'processing-failed',
      });
    });

    it('offers open replay requests again, and fails one whose retries are spent', async () => {
      const [open, spent] = (await asOwner(
        'two requests',
        sql`INSERT INTO biometric_replay_request (organization_id, requested_by, reason, from_date, to_date,
                                                  selected_count, created_at)
            VALUES (${ORG}, ${HR}, 'lost', '2026-10-01', '2026-10-02', 1, '2026-10-06T08:00:00Z'),
                   (${ORG}, ${HR}, 'spent', '2026-10-01', '2026-10-02', 1, '2026-10-06T08:00:00Z')
            RETURNING id`,
      )) as { id: string }[];
      const { queue, offered } = fakeQueue<{ requestId: string }>(
        new Map([[spent!.id, { kind: 'exhausted' }]]),
      );
      await sweepReplayRequests(ctx(), queue, new Date('2026-10-06T09:00:00Z'));
      expect(offered).toContainEqual({ key: open!.id, payload: { requestId: open!.id } });
      const [failed] = await asOwner(
        'the spent request',
        sql`SELECT status, last_error IS NOT NULL AS explained FROM biometric_replay_request WHERE id = ${spent!.id}`,
      );
      expect(failed).toEqual({ status: 'failed', explained: true });
    });
  });

  describe('health', () => {
    it('a device unheard for an hour while someone is on shift opens one silent alert', async () => {
      // Tuesday 6 October, 10:30 IST: Alice is inside her 09:00–18:00 shift.
      expect(
        await checkDeviceHealth(ctx(), at('2026-10-06T10:30:00')),
      ).toBeGreaterThanOrEqual(1);
      expect(await openAlerts(QUIET)).toEqual([{ kind: 'silent' }]);
      const signals = await asOwner(
        'one announcement',
        sql`SELECT count(*)::int AS count FROM domain_outbox
            WHERE organization_id = ${ORG} AND event_name = 'biometric.device-alert'
              AND payload->>'alertId' IN (SELECT id::text FROM biometric_alert WHERE device_id = ${QUIET})`,
      );
      expect(signals).toEqual([{ count: 1 }]);
      // Checked again, it stays one alert.
      await checkDeviceHealth(ctx(), at('2026-10-06T10:45:00'));
      expect(await openAlerts(QUIET)).toEqual([{ kind: 'silent' }]);
    });

    it('stays quiet when nobody is on shift, and any contact ends silence', async () => {
      await asOwner(
        'reset',
        sql`UPDATE biometric_alert SET resolved_at = opened_at WHERE device_id = ${QUIET}`,
      );
      await checkDeviceHealth(ctx(), at('2026-10-06T21:00:00'));
      expect(await openAlerts(QUIET)).toEqual([]);

      await checkDeviceHealth(ctx(), at('2026-10-07T10:30:00'));
      expect(await openAlerts(QUIET)).toEqual([{ kind: 'silent' }]);
      await receivePunches(
        ctx(),
        { deviceId: QUIET, punches: [] },
        at('2026-10-07T10:40:00'),
      );
      expect(await openAlerts(QUIET)).toEqual([]);
    });

    it('a clock five minutes fast opens a skew alert; the right offset resolves it', async () => {
      // Realtime pushes, one line each, arriving the moment the scan happens.
      for (const minute of ['00', '10', '20']) {
        const deviceSays = `2026-10-08 09:${String(Number(minute) + 5).padStart(2, '0')}:00`;
        await receivePunches(
          ctx(),
          { deviceId: FAST, punches: [line(FAST, '001', deviceSays)], realtime: true },
          at(`2026-10-08T09:${minute}:00`),
        );
      }
      expect(await openAlerts(FAST)).toEqual([{ kind: 'skew' }]);
      await asOwner(
        'HR sets the offset',
        sql`UPDATE biometric_device SET clock_offset_seconds = -300 WHERE id = ${FAST}`,
      );
      for (const minute of ['30', '40', '50']) {
        const deviceSays = `2026-10-08 09:${String(Number(minute) + 5).padStart(2, '0')}:00`;
        await receivePunches(
          ctx(),
          { deviceId: FAST, punches: [line(FAST, '001', deviceSays)], realtime: true },
          at(`2026-10-08T09:${minute}:00`),
        );
      }
      expect(await openAlerts(FAST)).toEqual([]);
    });

    it('a backlog never measures skew; half an hour off suggests the timezone', async () => {
      await receivePunches(
        ctx(),
        {
          deviceId: HALF,
          punches: [line(HALF, '001', '2026-10-01 09:00:00')],
          realtime: false,
        },
        at('2026-10-08T09:00:00'),
      );
      const [unchanged] = await asOwner(
        'no sample',
        sql`SELECT cardinality(skew_samples) AS samples FROM biometric_device WHERE id = ${HALF}`,
      );
      expect(unchanged).toEqual({ samples: 0 });
      for (const minute of ['00', '10', '20']) {
        await receivePunches(
          ctx(),
          {
            deviceId: HALF,
            punches: [line(HALF, '001', `2026-10-08 09:${minute}:00`)],
            realtime: true,
          },
          at(`2026-10-08T09:${String(Number(minute) + 30).padStart(2, '0')}:00`),
        );
      }
      expect(await openAlerts(HALF)).toEqual([{ kind: 'timezone-suspect' }]);
    });
  });

  describe('alert mail', () => {
    it('reaches everyone who manages devices tenant-wide, once', async () => {
      const [alert] = (await asOwner(
        'the silent alert',
        sql`SELECT id FROM biometric_alert WHERE device_id = ${QUIET} ORDER BY opened_at LIMIT 1`,
      )) as { id: string }[];
      await asOwner(
        'open it',
        sql`UPDATE biometric_alert SET resolved_at = NULL, notified_at = NULL WHERE id = ${alert!.id}`,
      );
      const sent: { to: string; kind: string; serial: string }[] = [];
      const mailer: AlertMailer = {
        async send(to, details) {
          sent.push({ to, kind: details.kind, serial: details.serialNumber });
        },
      };
      const event = {
        id: randomUUID(),
        organizationId: ORG,
        name: 'biometric.device-alert',
        payload: { alertId: alert!.id },
        enqueuedAt: new Date(),
      };
      expect(await notifyDeviceAlert(event, mailer)).toBe(1);
      expect(sent).toEqual([
        { to: `admin-${ADMIN}@t.io`, kind: 'silent', serial: `Q-${ORG.slice(0, 8)}` },
      ]);
      // Delivered again: already announced, nothing more is sent.
      expect(await notifyDeviceAlert(event, mailer)).toBe(0);
      expect(sent).toHaveLength(1);
    });
  });
});
