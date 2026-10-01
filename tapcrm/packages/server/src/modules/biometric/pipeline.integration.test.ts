import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import {
  fixedClock,
  instantOfDeviceClock,
  toDeviceClockReading,
  type Clock,
} from '../../platform/time.js';
import { ingest, receivePunches } from './ingest.js';
import { processPunch, processPunchIn } from './pipeline.js';
import type { NormalizedPunch } from './types.js';

/**
 * Step 5b against real PostgreSQL: durable receipt, processing, duplicate
 * bursts across devices and PINs, dry-run, replay of waiting punches, and the
 * attendance they become (step 5 plan, Tasks 4 and 5).
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
const ROBOT = randomUUID(); // a service account: never employed
const CAROL = randomUUID(); // leaves on 15 October
const DAY_SHIFT = randomUUID();
const ZK = randomUUID();
const HIK = randomUUID();
const device = {
  a: randomUUID(), // ZK, entry
  b: randomUUID(), // ZK, entry
  c: randomUUID(), // HIK, entry
  exit: randomUUID(), // ZK, exit
  readers: randomUUID(), // ZK, per-reader directions
  dry: randomUUID(), // ZK, entry, dry-run
  pending: randomUUID(), // ZK, not enabled
};

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);
const ctx = () =>
  createJobContext({
    organizationId: ORG,
    principal: systemPrincipal(ORG),
    jobName: 'test',
    runId: randomUUID(),
  });

/** A line as an adapter would normalize it, read by the device clock in IST. */
function line(
  deviceId: string,
  pin: string,
  local: string,
  extra: Partial<NormalizedPunch> = {},
): NormalizedPunch {
  const reading = toDeviceClockReading(local);
  return {
    deviceId,
    pin,
    deviceLocalTime: reading,
    occurredAt: instantOfDeviceClock(reading, IST).instant,
    statusCode: '0',
    statusKind: null,
    verifyMode: 'fingerprint',
    readerKey: extra.readerKey ?? null,
    externalEventId: null,
    raw: `${pin}\t${local}\t0\t1\t${extra.readerKey ?? ''}`,
    ...extra,
  };
}

/** Received at noon IST on the punch's own day unless told otherwise. */
const noonOf = (local: string) => fixedClock(`${local.slice(0, 10)}T12:00:00+05:30`);

async function store(
  punch: NormalizedPunch,
  clock: Clock = noonOf(punch.deviceLocalTime!),
) {
  const receipt = await receivePunches(
    ctx(),
    { deviceId: punch.deviceId, punches: [punch] },
    clock,
  );
  if (!receipt.stored) throw new Error(`not stored: ${receipt.reason}`);
  return receipt.newPunchIds[0]!;
}

interface PunchState {
  id: string;
  status: string;
  statusReason: string | null;
  duplicateOf: string | null;
  attendanceEventId: string | null;
  userId: string | null;
}
async function stateOf(ids: readonly string[]): Promise<Map<string, PunchState>> {
  const rows = (await asOwner(
    'read punches',
    sql`SELECT id, status, status_reason, duplicate_of, attendance_event_id, user_id
        FROM biometric_punch WHERE id = ANY(${[...ids]}::uuid[])`,
  )) as PunchState[];
  return new Map(rows.map((row) => [row.id, row]));
}

/** Device events of the person that still stand, by the punch they came from. */
async function standingDeviceEvents(userId: string, day: string) {
  return (await asOwner(
    'standing device events',
    sql`SELECT e.biometric_punch_id, e.kind, e.occurred_at FROM attendance_event e
        WHERE e.user_id = ${userId} AND e.source = 'device' AND NOT e.is_void
          AND (e.occurred_at AT TIME ZONE ${IST})::date = ${day}::date
          AND NOT EXISTS (SELECT 1 FROM attendance_event s WHERE s.supersedes_event_id = e.id)
        ORDER BY e.occurred_at`,
  )) as { biometricPunchId: string; kind: string; occurredAt: Date }[];
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

describe.skipIf(!enabled)('biometric pipeline (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'organization',
      sql`INSERT INTO organization (id, code, name, timezone)
          VALUES (${ORG}, ${`BP${ORG.slice(0, 6)}`}, 'Pipeline', ${IST})`,
    );
    await asOwner(
      'department',
      sql`INSERT INTO department (id, organization_id, code, name, kind)
          VALUES (${DEPT}, ${ORG}, 'OPS', 'Operations', 'operations')`,
    );
    await asOwner(
      'position',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
          VALUES (${POS}, ${ORG}, ${DEPT}, 'OP', 'Operator', 20)`,
    );
    await asOwner(
      'service account',
      sql`INSERT INTO app_user (id, organization_id, account_type, email, full_name)
          VALUES (${HR}, ${ORG}, 'service', ${`hr-${HR}@t.io`}, 'Setup'),
                 (${ROBOT}, ${ORG}, 'service', ${`robot-${ROBOT}@t.io`}, 'Robot')`,
    );
    for (const [index, id] of [ALICE, BOB].entries()) {
      await asOwner(
        'employee',
        sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
            VALUES (${id}, ${ORG}, 'employee', ${`EMP-BP${index}`}, ${`e${index}-${id}@t.io`}, ${`Person ${index}`},
                    ${POS}, ${DEPT})`,
      );
    }
    await asOwner(
      'a leaver',
      sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id,
                                department_id, left_on)
          VALUES (${CAROL}, ${ORG}, 'employee', 'EMP-BP9', ${`carol-${CAROL}@t.io`}, 'Carol', ${POS}, ${DEPT},
                  '2026-10-15')`,
    );
    await asOwner(
      'a day shift',
      sql`INSERT INTO shift (id, organization_id, code, name, kind, created_by)
          VALUES (${DAY_SHIFT}, ${ORG}, 'DAY', 'Day', 'fixed', ${HR})`,
    );
    await asOwner(
      'its version',
      sql`INSERT INTO shift_version (organization_id, shift_id, effective_from, start_time, end_time, grace_minutes,
                                     full_day_minutes, half_day_minutes, created_by)
          VALUES (${ORG}, ${DAY_SHIFT}, '2026-01-01', '09:00', '18:00', 10, 450, 240, ${HR})`,
    );
    await asOwner(
      'closing extension',
      sql`INSERT INTO shift_setting (organization_id, effective_from, max_closing_extension_minutes, created_by)
          VALUES (${ORG}, '2026-01-01', 240, ${HR})`,
    );
    for (const id of [ALICE, BOB]) {
      await asOwner(
        'template',
        sql`INSERT INTO shift_assignment (organization_id, user_id, kind, shift_id, effective_from, created_by)
            VALUES (${ORG}, ${id}, 'template', ${DAY_SHIFT}, '2026-01-01', ${HR})`,
      );
    }
    await asOwner(
      'connectors',
      sql`INSERT INTO biometric_connector (id, organization_id, kind, name, created_by)
          VALUES (${ZK}, ${ORG}, 'zk-adms', 'ZK fleet', ${HR}), (${HIK}, ${ORG}, 'vendor-api', 'Gate', ${HR})`,
    );
    const devices: [string, string, string, string, boolean, string][] = [
      [device.a, ZK, 'A', 'entry', false, 'enabled'],
      [device.b, ZK, 'B', 'entry', false, 'enabled'],
      [device.c, HIK, 'C', 'entry', false, 'enabled'],
      [device.exit, ZK, 'X', 'exit', false, 'enabled'],
      [device.readers, ZK, 'R', 'undirected', false, 'enabled'],
      [device.dry, ZK, 'D', 'entry', true, 'enabled'],
      [device.pending, ZK, 'P', 'entry', true, 'pending'],
    ];
    for (const [id, connector, serial, direction, dryRun, status] of devices) {
      await asOwner(
        'device',
        sql`INSERT INTO biometric_device (id, organization_id, connector_id, serial_number, name, timezone,
                                          reader_direction, dry_run, status, created_by)
            VALUES (${id}, ${ORG}, ${connector}, ${`${serial}-${ORG.slice(0, 8)}`}, ${serial}, ${IST},
                    ${direction}, ${dryRun}, ${status}, ${HR})`,
      );
    }
    await asOwner(
      'readers',
      sql`INSERT INTO biometric_reader (organization_id, device_id, reader_key, label, direction)
          VALUES (${ORG}, ${device.readers}, '1', 'Door in', 'entry'),
                 (${ORG}, ${device.readers}, '2', 'Door out', 'exit'),
                 (${ORG}, ${device.readers}, '3', 'Side in', 'entry')`,
    );
    // Alice is 001 on the ZK fleet and 9001 on the gate terminal; PIN 050 passes to Bob at midnight.
    const mappings: [string, string, string, string, string | null][] = [
      [ZK, '001', ALICE, '2026-01-01', null],
      [HIK, '9001', ALICE, '2026-01-01', null],
      [ZK, '002', BOB, '2026-01-01', null],
      [ZK, '050', ALICE, '2026-01-01', '2026-10-20'],
      [ZK, '050', BOB, '2026-10-20', null],
      [ZK, '404', ROBOT, '2026-01-01', null],
      [ZK, '505', CAROL, '2026-01-01', null],
    ];
    for (const [connector, pin, userId, from, to] of mappings) {
      await asOwner(
        'mapping',
        sql`INSERT INTO biometric_pin_mapping (organization_id, connector_id, pin, user_id, effective_from, effective_to, created_by)
            VALUES (${ORG}, ${connector}, ${pin}, ${userId}, ${from}, ${to}, ${HR})`,
      );
    }
  });

  afterAll(async () => {
    for (const table of ['domain_outbox', 'biometric_review_item', 'biometric_alert', 'attendance_review_item']) {
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
    await asOwner('clear corrections', sql`DELETE FROM attendance_correction WHERE organization_id = ${ORG}`);
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
    await asOwner('clear organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  describe('receipt', () => {
    it('stores each line once with its reading; a resend is accepted and changes nothing', async () => {
      const punch = line(device.a, '001', '2026-10-01 08:30:00');
      const first = await receivePunches(
        ctx(),
        { deviceId: device.a, punches: [punch] },
        noonOf('2026-10-01'),
      );
      expect(first).toMatchObject({ stored: true, accepted: 1 });
      // The device's zone is corrected, and it resends its whole log: no second receipt.
      await asOwner(
        'new timezone',
        sql`UPDATE biometric_device SET timezone = 'Asia/Dubai' WHERE id = ${device.a}`,
      );
      const again = await receivePunches(
        ctx(),
        {
          deviceId: device.a,
          punches: [
            {
              ...punch,
              occurredAt: instantOfDeviceClock(punch.deviceLocalTime!, 'Asia/Dubai')
                .instant,
            },
          ],
        },
        noonOf('2026-10-01'),
      );
      await asOwner(
        'zone back',
        sql`UPDATE biometric_device SET timezone = ${IST} WHERE id = ${device.a}`,
      );
      expect(again).toEqual({ stored: true, accepted: 1, newPunchIds: [] });
      const rows = await asOwner(
        'the receipt',
        sql`SELECT occurred_at FROM biometric_punch WHERE device_id = ${device.a} AND device_local_time = '2026-10-01 08:30:00'`,
      );
      expect(rows).toEqual([{ occurredAt: new Date('2026-10-01T03:00:00Z') }]);
      // Each new receipt queues its processing, after commit.
      const signals = await asOwner(
        'processing signals',
        sql`SELECT payload FROM domain_outbox WHERE organization_id = ${ORG} AND event_name = 'biometric.punches-received'
            AND payload->'punchIds' ? ${first.stored ? first.newPunchIds[0]! : ''}`,
      );
      expect(signals).toHaveLength(1);
    });

    it('a device not yet enabled is heard, but nothing it sends is kept (BI-1)', async () => {
      const receipt = await receivePunches(
        ctx(),
        {
          deviceId: device.pending,
          punches: [line(device.pending, '001', '2026-10-01 09:00:00')],
        },
        noonOf('2026-10-01'),
      );
      expect(receipt).toEqual({ stored: false, reason: 'device-not-enabled' });
      const [row] = await asOwner(
        'the device',
        sql`SELECT last_seen_at, (SELECT count(*)::int FROM biometric_punch WHERE device_id = ${device.pending}) AS punches
            FROM biometric_device WHERE id = ${device.pending}`,
      );
      expect(row).toMatchObject({ punches: 0 });
      expect((row as { lastSeenAt: Date | null }).lastSeenAt).not.toBeNull();
    });

    it('a small push becomes attendance before the answer', async () => {
      const receipt = await ingest(
        ctx(),
        { deviceId: device.a, punches: [line(device.a, '002', '2026-10-01 09:02:00')] },
        noonOf('2026-10-01'),
      );
      const id = receipt.stored ? receipt.newPunchIds[0]! : '';
      expect((await stateOf([id])).get(id)).toMatchObject({
        status: 'applied',
        userId: BOB,
      });
      expect(await standingDeviceEvents(BOB, '2026-10-01')).toEqual([
        {
          biometricPunchId: id,
          kind: 'in',
          occurredAt: new Date('2026-10-01T03:32:00Z'),
        },
      ]);
    });
  });

  describe('duplicate bursts', () => {
    it('a chain across devices, PINs and connectors ends the same in every arrival order', async () => {
      const orders = permutations([0, 1, 2]);
      for (const [index, order] of orders.entries()) {
        const day = `2026-10-0${index + 2}`; // one day per order
        const chain = [
          line(device.a, '001', `${day} 09:00:00`),
          line(device.c, '9001', `${day} 09:00:50`),
          line(device.b, '001', `${day} 09:01:40`),
        ];
        const ids = [];
        for (const punch of chain) ids.push(await store(punch));
        for (const position of order)
          await processPunch(ctx(), ids[position]!, { clock: noonOf(day) });

        const state = await stateOf(ids);
        expect(state.get(ids[0]!), `order ${order.join('')}`).toMatchObject({
          status: 'applied',
        });
        expect(state.get(ids[1]!)).toMatchObject({
          status: 'duplicate',
          duplicateOf: ids[0],
        });
        expect(state.get(ids[2]!)).toMatchObject({
          status: 'duplicate',
          duplicateOf: ids[0],
        });
        expect(await standingDeviceEvents(ALICE, day)).toEqual([
          {
            biometricPunchId: ids[0],
            kind: 'in',
            occurredAt: instantOfDeviceClock(toDeviceClockReading(`${day} 09:00:00`), IST)
              .instant,
          },
        ]);
      }
    });

    it('an in and an out seconds apart on two devices both stand', async () => {
      const came = await store(line(device.a, '001', '2026-10-08 09:00:10'));
      const left = await store(line(device.exit, '001', '2026-10-08 09:00:20'));
      await processPunch(ctx(), left, { clock: noonOf('2026-10-08') });
      await processPunch(ctx(), came, { clock: noonOf('2026-10-08') });
      const state = await stateOf([came, left]);
      expect(state.get(came)!.status).toBe('applied');
      expect(state.get(left)!.status).toBe('applied');
      expect(
        (await standingDeviceEvents(ALICE, '2026-10-08')).map((event) => event.kind),
      ).toEqual(['in', 'out']);
    });

    it('a PIN passed on at midnight: two people, never one burst', async () => {
      const alices = await store(
        line(device.a, '050', '2026-10-19 23:59:40'),
        noonOf('2026-10-20'),
      );
      const bobs = await store(
        line(device.b, '050', '2026-10-20 00:00:20'),
        noonOf('2026-10-20'),
      );
      await processPunch(ctx(), bobs, { clock: noonOf('2026-10-20') });
      await processPunch(ctx(), alices, { clock: noonOf('2026-10-20') });
      const state = await stateOf([alices, bobs]);
      expect(state.get(alices)).toMatchObject({ status: 'applied', userId: ALICE });
      expect(state.get(bobs)).toMatchObject({ status: 'applied', userId: BOB });
    });

    it('two readers in one second: distinct receipts; one burst only where the meaning matches', async () => {
      const at = '2026-10-09 09:00:00';
      const doorIn = await store(line(device.readers, '001', at, { readerKey: '1' }));
      const doorOut = await store(line(device.readers, '001', at, { readerKey: '2' }));
      const sideIn = await store(line(device.readers, '001', at, { readerKey: '3' }));
      for (const id of [sideIn, doorOut, doorIn])
        await processPunch(ctx(), id, { clock: noonOf(at) });
      const state = await stateOf([doorIn, doorOut, sideIn]);
      expect(state.get(doorIn)!.status).toBe('applied'); // reader 1 sorts before reader 3
      expect(state.get(sideIn)).toMatchObject({
        status: 'duplicate',
        duplicateOf: doorIn,
      });
      expect(state.get(doorOut)!.status).toBe('applied');
    });

    it('equal instants lead by provenance, whatever arrives first', async () => {
      const heads = [];
      for (const [index, first] of ([0, 1] as const).entries()) {
        const day = `2026-10-1${index}`;
        const ids = [
          await store(line(device.a, '001', `${day} 10:00:00`)),
          await store(line(device.b, '001', `${day} 10:00:00`)),
        ];
        await processPunch(ctx(), ids[first]!, { clock: noonOf(day) });
        await processPunch(ctx(), ids[1 - first]!, { clock: noonOf(day) });
        const state = await stateOf(ids);
        heads.push(ids.findIndex((id) => state.get(id)!.status === 'applied'));
      }
      expect(heads[0]).toBe(heads[1]);
    });

    it('dry-run punches form their own bursts and never become attendance', async () => {
      const dry1 = await store(line(device.dry, '001', '2026-10-12 09:00:30'));
      const dry2 = await store(line(device.dry, '001', '2026-10-12 09:00:10'));
      const live = await store(line(device.a, '001', '2026-10-12 09:00:20'));
      for (const id of [dry1, live, dry2])
        await processPunch(ctx(), id, { clock: noonOf('2026-10-12') });
      const state = await stateOf([dry1, dry2, live]);
      expect(state.get(dry2)).toMatchObject({
        status: 'dry-run',
        attendanceEventId: null,
      });
      expect(state.get(dry1)).toMatchObject({ status: 'duplicate', duplicateOf: dry2 });
      expect(state.get(live)!.status).toBe('applied');
      expect(
        (await standingDeviceEvents(ALICE, '2026-10-12')).map((e) => e.biometricPunchId),
      ).toEqual([live]);
    });

    it('two devices processed at once for one person give one head', async () => {
      const onA = await store(line(device.a, '001', '2026-10-13 11:00:20'));
      const onC = await store(line(device.c, '9001', '2026-10-13 11:00:05'));
      const settled = await Promise.allSettled([
        processPunch(ctx(), onA, { clock: noonOf('2026-10-13') }),
        processPunch(ctx(), onC, { clock: noonOf('2026-10-13') }),
      ]);
      expect(settled.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
      const state = await stateOf([onA, onC]);
      expect(state.get(onC)!.status).toBe('applied');
      expect(state.get(onA)).toMatchObject({ status: 'duplicate', duplicateOf: onC });
      expect(
        (await standingDeviceEvents(ALICE, '2026-10-13')).map((e) => e.biometricPunchId),
      ).toEqual([onC]);
    });

    it('a head a person corrected is kept; the earlier punch waits for review', async () => {
      const later = fixedClock('2026-10-14T14:00:00+05:30');
      const head = await store(line(device.a, '001', '2026-10-14 13:00:40'), later);
      await processPunch(ctx(), head, { clock: later });
      const { attendanceEventId } = (await stateOf([head])).get(head)!;
      // A correction event points at the approved correction behind it (step 7's key).
      const [approved] = (await asOwner(
        'the approved correction',
        sql`INSERT INTO attendance_correction (organization_id, user_id, work_date, kind, payload, reason, requested_by,
                                               status, decided_by, decided_at)
            VALUES (${ORG}, ${ALICE}, '2026-10-14', 'replace-event', '{}'::jsonb,
                    'Scanner clock ran fast; the real arrival was earlier', ${ALICE}, 'approved', ${HR}, now())
            RETURNING id`,
      )) as { id: string }[];
      await asOwner(
        'HR corrects the head',
        sql`INSERT INTO attendance_event (organization_id, user_id, kind, occurred_at, source, evidence, correction_id,
                                          supersedes_event_id)
            VALUES (${ORG}, ${ALICE}, 'in', '2026-10-14T07:25:00Z', 'correction', 'confirmed', ${approved!.id},
                    ${attendanceEventId})`,
      );
      const earlier = await store(line(device.b, '001', '2026-10-14 13:00:10'), later);
      await expect(processPunch(ctx(), earlier, { clock: later })).resolves.toEqual({
        outcome: 'duplicate',
        headId: head,
      });
      const state = await stateOf([head, earlier]);
      expect(state.get(head)!.status).toBe('applied');
      expect(state.get(earlier)).toMatchObject({
        status: 'duplicate',
        statusReason: 'protected-head',
      });
      const reviews = await asOwner(
        'the review',
        sql`SELECT kind FROM biometric_review_item WHERE punch_id = ${earlier} AND resolved_at IS NULL`,
      );
      expect(reviews).toEqual([{ kind: 'protected-head' }]);
      expect(await standingDeviceEvents(ALICE, '2026-10-14')).toEqual([]); // the correction stands instead
    });

    it('a failure after processing leaves no event, link or signal behind', async () => {
      const id = await store(line(device.a, '001', '2026-10-15 09:05:00'));
      const signalsBefore = await asOwner(
        'signals before',
        sql`SELECT count(*)::int AS count FROM domain_outbox WHERE organization_id = ${ORG}`,
      );
      await expect(
        db.transaction(ctx(), async (tx) => {
          await processPunchIn(tx, ctx(), id, { clock: noonOf('2026-10-15') });
          throw new Error('the worker died');
        }),
      ).rejects.toThrow('the worker died');
      expect((await stateOf([id])).get(id)).toMatchObject({
        status: 'received',
        userId: null,
        attendanceEventId: null,
      });
      expect(await standingDeviceEvents(ALICE, '2026-10-15')).toEqual([]);
      expect(
        await asOwner(
          'signals after',
          sql`SELECT count(*)::int AS count FROM domain_outbox WHERE organization_id = ${ORG}`,
        ),
      ).toEqual(signalsBefore);
    });
  });

  describe('waiting punches and replay', () => {
    it('refuses a punch from the future, holds a backdated one, and a replay may release the hold', async () => {
      const future = await store(
        line(device.a, '001', '2026-10-16 12:06:00'),
        noonOf('2026-10-16'),
      );
      const old = await store(
        line(device.a, '001', '2026-10-12 11:59:00'),
        noonOf('2026-10-16'),
      );
      await expect(
        processPunch(ctx(), future, { clock: noonOf('2026-10-16') }),
      ).resolves.toEqual({
        outcome: 'rejected',
        reason: 'future',
      });
      await expect(
        processPunch(ctx(), old, { clock: noonOf('2026-10-16') }),
      ).resolves.toEqual({
        outcome: 'held',
        reason: 'backdated',
      });
      // A replay without release keeps it held; with release it is applied.
      await processPunch(ctx(), old, {
        clock: noonOf('2026-10-16'),
        replay: { releaseHold: false },
      });
      expect((await stateOf([old])).get(old)!.status).toBe('held');
      await expect(
        processPunch(ctx(), old, {
          clock: noonOf('2026-10-16'),
          replay: { releaseHold: true },
        }),
      ).resolves.toMatchObject({ outcome: 'applied' });
      // A future punch stays refused: a replay never bypasses an impossible time.
      await processPunch(ctx(), future, {
        clock: noonOf('2026-10-16'),
        replay: { releaseHold: true },
      });
      expect((await stateOf([future])).get(future)!.status).toBe('rejected');
    });

    it('an unmapped punch replays with the reading it arrived with', async () => {
      const id = await store(line(device.a, '777', '2026-10-17 09:10:00'));
      await expect(
        processPunch(ctx(), id, { clock: noonOf('2026-10-17') }),
      ).resolves.toEqual({
        outcome: 'unmapped',
        reason: 'no-mapping',
      });
      // The device changes afterwards: another direction, dry-run, another zone.
      await asOwner(
        'the device changes',
        sql`UPDATE biometric_device SET reader_direction = 'exit', dry_run = true, timezone = 'Asia/Dubai'
            WHERE id = ${device.a}`,
      );
      await asOwner(
        'HR maps the PIN',
        sql`INSERT INTO biometric_pin_mapping (organization_id, connector_id, pin, user_id, effective_from, created_by)
            VALUES (${ORG}, ${ZK}, '777', ${BOB}, '2026-10-01', ${HR})`,
      );
      await processPunch(ctx(), id, {
        clock: noonOf('2026-10-17'),
        replay: { releaseHold: false },
      });
      await asOwner(
        'the device back',
        sql`UPDATE biometric_device SET reader_direction = 'entry', dry_run = false, timezone = ${IST}
            WHERE id = ${device.a}`,
      );
      expect((await stateOf([id])).get(id)).toMatchObject({
        status: 'applied',
        userId: BOB,
      });
      expect(await standingDeviceEvents(BOB, '2026-10-17')).toEqual([
        {
          biometricPunchId: id,
          kind: 'in',
          occurredAt: new Date('2026-10-17T03:40:00Z'),
        },
      ]);
    });

    it('a punch after the leaving date is refused; the leaving day itself is not', async () => {
      const lastDay = await store(line(device.a, '505', '2026-10-15 09:00:00'));
      const dayAfter = await store(line(device.a, '505', '2026-10-16 09:00:00'));
      await expect(
        processPunch(ctx(), lastDay, { clock: noonOf('2026-10-15') }),
      ).resolves.toMatchObject({ outcome: 'applied' });
      await expect(
        processPunch(ctx(), dayAfter, { clock: noonOf('2026-10-16') }),
      ).resolves.toEqual({ outcome: 'rejected', reason: 'not-employed' });
    });

    it('a person who is not employed is refused, for review', async () => {
      const id = await store(line(device.a, '404', '2026-10-17 09:00:00'));
      await expect(
        processPunch(ctx(), id, { clock: noonOf('2026-10-17') }),
      ).resolves.toEqual({
        outcome: 'rejected',
        reason: 'not-employed',
      });
      const reviews = await asOwner(
        'the review',
        sql`SELECT kind FROM biometric_review_item WHERE punch_id = ${id}`,
      );
      expect(reviews).toEqual([{ kind: 'not-employed' }]);
    });

    it('a push and a replay at once still give one head', async () => {
      const waiting = await store(
        line(device.a, '778', '2026-10-18 12:00:00'),
        noonOf('2026-10-18'),
      );
      await processPunch(ctx(), waiting, { clock: noonOf('2026-10-18') }); // unmapped
      await asOwner(
        'HR maps the PIN',
        sql`INSERT INTO biometric_pin_mapping (organization_id, connector_id, pin, user_id, effective_from, created_by)
            VALUES (${ORG}, ${ZK}, '778', ${ALICE}, '2026-10-01', ${HR})`,
      );
      const clock = fixedClock('2026-10-18T12:05:00+05:30');
      const [replayed, pushedReceipt] = await Promise.allSettled([
        processPunch(ctx(), waiting, { clock, replay: { releaseHold: false } }),
        ingest(
          ctx(),
          { deviceId: device.b, punches: [line(device.b, '001', '2026-10-18 12:00:30')] },
          clock,
        ),
      ]);
      expect(replayed.status).toBe('fulfilled');
      const receipt = pushedReceipt.status === 'fulfilled' ? pushedReceipt.value : null;
      const pushed = receipt?.stored === true ? receipt.newPunchIds[0]! : '';
      const state = await stateOf([waiting, pushed]);
      expect(state.get(waiting)!.status).toBe('applied');
      expect(state.get(pushed)).toMatchObject({
        status: 'duplicate',
        duplicateOf: waiting,
      });
      expect(
        (await standingDeviceEvents(ALICE, '2026-10-18')).map((e) => e.biometricPunchId),
      ).toEqual([waiting]);
    });
  });
});
