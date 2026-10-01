import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import {
  appendEvent,
  currentDayFor,
  replaceDeviceEvent,
  retireEvent,
  type AppendEventInput,
} from './facade.js';

/**
 * Step 3a against real PostgreSQL: the append-only ledger, one record per
 * person and day, stored assignments, and the neighbourhood pass (design §8).
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const ORG = randomUUID();
const DEPT = randomUUID();
const POS = randomUUID();
const HR = randomUUID();
const people = { a: randomUUID(), b: randomUUID(), c: randomUUID(), d: randomUUID() };
const NIGHT = randomUUID();
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

/** Instants written as IST wall-clock time. */
const ist = (local: string) => new Date(`${local}+05:30`);

const punch = (
  userId: string,
  kind: AppendEventInput['kind'],
  local: string,
  extra: Partial<AppendEventInput> = {},
) =>
  db.transaction(ctx(), (tx) =>
    appendEvent(tx, {
      userId,
      kind,
      at: ist(local),
      source: 'web',
      evidence: 'confirmed',
      remote: true,
      ...extra,
    }),
  );

interface RecordRow {
  workDate: string;
  inputVersion: number;
  attributionFlags: string[];
  closeDueAt: Date;
}
const recordsOf = (userId: string) =>
  asOwner(
    'read records',
    sql`
    SELECT work_date::text AS work_date, input_version, attribution_flags, close_due_at
    FROM attendance_record WHERE user_id = ${userId} ORDER BY work_date`,
  ) as Promise<RecordRow[]>;

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

const deviceIn = (
  userId: string,
  local: string,
  biometricPunchId: string,
): AppendEventInput => ({
  userId,
  kind: 'in',
  at: ist(local),
  source: 'device',
  evidence: 'confirmed',
  biometricPunchId,
});

const countOf = async (reason: string, fragment: ReturnType<typeof sql>) =>
  Number(((await asOwner(reason, fragment)) as { count: string }[])[0]!.count);
const eventsOfPunch = (punchId: string) =>
  countOf(
    'events of a punch',
    sql`SELECT count(*) FROM attendance_event WHERE biometric_punch_id = ${punchId}`,
  );
const supersedersOf = (eventId: string) =>
  countOf(
    'rows superseding an event',
    sql`SELECT count(*) FROM attendance_event WHERE supersedes_event_id = ${eventId}`,
  );

const placementOf = async (eventId: string) =>
  (
    (await asOwner(
      'read assignment',
      sql`
    SELECT r.work_date::text AS work_date, a.reason FROM attendance_event_assignment a
    JOIN attendance_record r ON r.id = a.attendance_record_id WHERE a.event_id = ${eventId}`,
    )) as {
      workDate: string;
      reason: string;
    }[]
  )[0];

describe.skipIf(!enabled)('attendance ledger (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'create organization',
      sql`
      INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`AT${ORG.slice(0, 6)}`}, 'Ledger Test', 'Asia/Kolkata')`,
    );
    await asOwner(
      'create department',
      sql`
      INSERT INTO department (id, organization_id, code, name, kind) VALUES (${DEPT}, ${ORG}, 'OPS', 'Operations', 'operations')`,
    );
    await asOwner(
      'create position',
      sql`
      INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
      VALUES (${POS}, ${ORG}, ${DEPT}, 'OPS-1', 'Operator', 20)`,
    );
    const everyone = [HR, ...Object.values(people)];
    for (const [index, id] of everyone.entries()) {
      await asOwner(
        'create person',
        sql`
        INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
        VALUES (${id}, ${ORG}, 'employee', ${`EMP-AT${String(index).padStart(3, '0')}`}, ${`p${index}-${id}@t.io`},
                ${`Person ${index}`}, ${POS}, ${DEPT})`,
      );
    }
    await asOwner(
      'a connector',
      sql`
      INSERT INTO biometric_connector (id, organization_id, kind, name, created_by)
      VALUES (${CONNECTOR}, ${ORG}, 'zk-adms', 'Office', ${HR})`,
    );
    await asOwner(
      'a device',
      sql`
      INSERT INTO biometric_device (id, organization_id, connector_id, serial_number, name, timezone, created_by)
      VALUES (${DEVICE}, ${ORG}, ${CONNECTOR}, ${`AT${ORG.slice(0, 8)}`}, 'Front door', 'Asia/Kolkata', ${HR})`,
    );
    // A 20:00–05:00 night every day, a 09:00–18:00 morning on Monday 28 September,
    // a 4-hour closing extension (Q3) and the default 3-hour early window.
    await asOwner(
      'shifts',
      sql`
      INSERT INTO shift (id, organization_id, code, name, kind, created_by)
      VALUES (${NIGHT}, ${ORG}, 'NIGHT', 'Night', 'fixed', ${HR}), (${DAY}, ${ORG}, 'DAY', 'Day', 'fixed', ${HR})`,
    );
    await asOwner(
      'versions',
      sql`
      INSERT INTO shift_version (organization_id, shift_id, effective_from, start_time, end_time, grace_minutes,
                                 full_day_minutes, half_day_minutes, created_by)
      VALUES (${ORG}, ${NIGHT}, '2026-01-01', '20:00', '05:00', 10, 450, 240, ${HR}),
             (${ORG}, ${DAY}, '2026-01-01', '09:00', '18:00', 10, 450, 240, ${HR})`,
    );
    await asOwner(
      'setting',
      sql`
      INSERT INTO shift_setting (organization_id, effective_from, max_closing_extension_minutes, created_by)
      VALUES (${ORG}, '2026-01-01', 240, ${HR})`,
    );
    for (const id of Object.values(people)) {
      await asOwner(
        'night template',
        sql`
        INSERT INTO shift_assignment (organization_id, user_id, kind, shift_id, effective_from, created_by)
        VALUES (${ORG}, ${id}, 'template', ${NIGHT}, '2026-09-01', ${HR})`,
      );
      await asOwner(
        'monday morning',
        sql`
        INSERT INTO shift_override (organization_id, user_id, work_date, kind, shift_id, reason, created_by)
        VALUES (${ORG}, ${id}, '2026-09-28', 'shift', ${DAY}, 'Rotation', ${HR})`,
      );
    }
  });

  afterAll(async () => {
    for (const table of [
      'domain_outbox',
      'attendance_event_assignment',
      'attendance_record',
      'shift_override',
      'shift_assignment',
      'shift_setting',
      'shift_version',
      'shift',
    ]) {
      await asOwner(
        `clear ${table}`,
        sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${ORG}`,
      );
    }
    // Review items point at events; they go first.
    await asOwner('clear review items', sql`DELETE FROM attendance_review_item WHERE organization_id = ${ORG}`);
    // The ledger is append-only for the app role; the owner clears it, voids first.
    await asOwner(
      'clear voids',
      sql`DELETE FROM attendance_event WHERE organization_id = ${ORG} AND supersedes_event_id IS NOT NULL`,
    );
    await asOwner(
      'clear events',
      sql`DELETE FROM attendance_event WHERE organization_id = ${ORG}`,
    );
    await asOwner('clear corrections', sql`DELETE FROM attendance_correction WHERE organization_id = ${ORG}`);
    for (const table of ['biometric_punch', 'biometric_device', 'biometric_connector']) {
      await asOwner(
        `clear ${table}`,
        sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${ORG}`,
      );
    }
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

  it('a punch lands on the day that owns it, and the day is materialised with its facts', async () => {
    const arrival = await punch(people.a, 'in', '2026-09-27T19:55:00');
    expect(arrival).toMatchObject({
      workDate: '2026-09-27',
      reason: 'midpoint',
      replayed: false,
    });
    const [sunday] = await recordsOf(people.a);
    // closingCap = min(05:00 + 4 h, Monday 09:00) = 09:00 on Monday.
    expect(sunday).toMatchObject({ workDate: '2026-09-27' });
    expect(sunday!.closeDueAt).toEqual(ist('2026-09-28T09:00:00'));
  });

  it('§5.2: a 07:30 out with the night still open belongs to the night (closing extension)', async () => {
    const out = await punch(people.a, 'out', '2026-09-28T07:30:00');
    expect(out).toMatchObject({ workDate: '2026-09-27', reason: 'closing-extension' });
  });

  it('currentDayFor: with the night open at 07:00 the person is still in Sunday', async () => {
    await punch(people.d, 'in', '2026-09-27T19:58:00');
    const day = await db.transaction(ctx(), (tx) =>
      currentDayFor(tx, people.d, ist('2026-09-28T07:00:00')),
    );
    expect(day).toBe('2026-09-27');
  });

  it('§8.4 step 9: retiring the 05:02 out moves the 07:30 out from Monday back to the night', async () => {
    await punch(people.b, 'in', '2026-09-27T19:55:00');
    const early = await punch(people.b, 'out', '2026-09-28T05:02:00');
    const late = await punch(people.b, 'out', '2026-09-28T07:30:00');
    expect(late).toMatchObject({ workDate: '2026-09-28', reason: 'midpoint' });
    const before = await recordsOf(people.b);

    const retired = await db.transaction(ctx(), (tx) => retireEvent(tx, early.eventId));
    expect(retired.retired).toBe(true);
    expect(await placementOf(late.eventId)).toEqual({
      workDate: '2026-09-27',
      reason: 'closing-extension',
    });

    // Both days gained or lost an event, so both have a new input version and a recalculation request.
    const after = await recordsOf(people.b);
    for (const date of ['2026-09-27', '2026-09-28']) {
      const was = before.find((r) => r.workDate === date)!.inputVersion;
      expect(after.find((r) => r.workDate === date)!.inputVersion).toBeGreaterThan(was);
    }
    const requests = (await asOwner(
      'recalc requests',
      sql`
      SELECT count(*)::int AS n FROM domain_outbox
      WHERE organization_id = ${ORG} AND event_name = 'attendance.recalc-requested' AND payload->>'userId' = ${people.b}`,
    )) as {
      n: number;
    }[];
    expect(requests[0]!.n).toBeGreaterThan(0);

    // An event is retired once: the second attempt changes nothing.
    await expect(
      db.transaction(ctx(), (tx) => retireEvent(tx, early.eventId)),
    ).resolves.toEqual({
      retired: false,
      reason: 'already-superseded',
    });
  });

  it('D30: an 08:50 arrival after a night never closed starts Monday and flags the night', async () => {
    const morning = await punch(people.d, 'in', '2026-09-28T08:50:00');
    expect(morning).toMatchObject({
      workDate: '2026-09-28',
      reason: 'next-shift-started',
    });
    const sunday = (await recordsOf(people.d)).find((r) => r.workDate === '2026-09-27')!;
    expect(sunday.attributionFlags).toEqual(['previous-session-unconfirmed']);
  });

  it('a later pass that only reaches a flagged day from outside keeps its flag', async () => {
    // A Friday punch re-attributes Thursday to Saturday and locks Wednesday to
    // Sunday. Sunday is outside the pass, so its flag must stay.
    await punch(people.d, 'in', '2026-09-25T19:55:00');
    const sunday = (await recordsOf(people.d)).find((r) => r.workDate === '2026-09-27')!;
    expect(sunday.attributionFlags).toEqual(['previous-session-unconfirmed']);
  });

  it('TX-7: a retried client event returns the first answer; the same key for another punch is 409', async () => {
    const first = await punch(people.c, 'in', '2026-09-27T19:50:00', {
      clientEventId: 'offline-1',
      clientRequestHash: 'h1',
    });
    const again = await punch(people.c, 'in', '2026-09-27T19:50:00', {
      clientEventId: 'offline-1',
      clientRequestHash: 'h1',
    });
    expect(again).toEqual({ ...first, replayed: true });
    await expect(
      punch(people.c, 'out', '2026-09-28T05:00:00', {
        clientEventId: 'offline-1',
        clientRequestHash: 'h2',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'ATTENDANCE_CLIENT_EVENT_REUSED' });
  });

  it('AT-6: the app role cannot update or delete an event', async () => {
    await expect(
      db.query(
        ctx(),
        sql`UPDATE attendance_event SET occurred_at = occurred_at WHERE organization_id = ${ORG}`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(ctx(), sql`DELETE FROM attendance_event WHERE organization_id = ${ORG}`),
    ).rejects.toThrow(/permission denied/);
  });

  it('T-6: an instant with a fraction of a second is refused', async () => {
    await expect(
      asOwner(
        'fractional',
        sql`
        INSERT INTO attendance_event (organization_id, user_id, kind, occurred_at, source, evidence)
        VALUES (${ORG}, ${people.c}, 'in', '2026-09-29T09:00:00.500+05:30', 'web', 'confirmed')`,
      ),
    ).rejects.toThrow(/violates check constraint/);
  });

  it('D34: an assignment joining one person’s event to another person’s day is refused', async () => {
    const [event] = (await asOwner(
      'an event of a',
      sql`
      SELECT id FROM attendance_event WHERE user_id = ${people.a} LIMIT 1`,
    )) as { id: string }[];
    const [record] = (await asOwner(
      'a record of b',
      sql`
      SELECT id FROM attendance_record WHERE user_id = ${people.b} LIMIT 1`,
    )) as { id: string }[];
    await expect(
      asOwner(
        'move the assignment to another person’s day',
        sql`
        UPDATE attendance_event_assignment SET attendance_record_id = ${record!.id} WHERE event_id = ${event!.id}`,
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('one chain, never a fork: a second row superseding the same event is refused', async () => {
    const [target] = (await asOwner(
      'an event',
      sql`
      SELECT supersedes_event_id AS id FROM attendance_event WHERE user_id = ${people.b} AND is_void`,
    )) as { id: string }[];
    await expect(
      asOwner(
        'second void',
        sql`
        INSERT INTO attendance_event (organization_id, user_id, kind, occurred_at, source, evidence, supersedes_event_id, is_void)
        VALUES (${ORG}, ${people.b}, 'out', '2026-09-28T05:02:00+05:30', 'system', 'confirmed', ${target!.id}, true)`,
      ),
    ).rejects.toThrow(/ux_attendance_event_supersedes/);
  });

  describe('device punches (step 5 prerequisites)', () => {
    it('a punch delivered again returns its first event, even after that event was retired', async () => {
      const punchId = await devicePunch(people.d, '2026-10-06T20:00:40');
      const input = deviceIn(people.d, '2026-10-06T20:00:40', punchId);
      const first = await db.transaction(ctx(), (tx) => appendEvent(tx, input));
      expect(first).toMatchObject({ workDate: '2026-10-06', replayed: false });
      const again = await db.transaction(ctx(), (tx) => appendEvent(tx, input));
      expect(again).toEqual({ ...first, replayed: true });

      await db.transaction(ctx(), (tx) => retireEvent(tx, first.eventId));
      const afterRetirement = await db.transaction(ctx(), (tx) => appendEvent(tx, input));
      expect(afterRetirement).toMatchObject({ eventId: first.eventId, replayed: true });
      expect(await eventsOfPunch(punchId)).toBe(1);
    });

    it('the database keeps one event per punch, and the punch’s own person', async () => {
      const punchId = await devicePunch(people.d, '2026-10-06T21:00:00');
      await db.transaction(ctx(), (tx) =>
        appendEvent(tx, deviceIn(people.d, '2026-10-06T21:00:00', punchId)),
      );
      await expect(
        asOwner(
          'a second event for the punch',
          sql`
          INSERT INTO attendance_event (organization_id, user_id, kind, occurred_at, source, evidence, biometric_punch_id)
          VALUES (${ORG}, ${people.d}, 'in', '2026-10-06T21:00:00+05:30', 'device', 'confirmed', ${punchId})`,
        ),
      ).rejects.toThrow(/ux_attendance_event_device_punch/);
      await expect(
        asOwner(
          'another person’s event for the punch',
          sql`
          INSERT INTO attendance_event (organization_id, user_id, kind, occurred_at, source, evidence, biometric_punch_id)
          VALUES (${ORG}, ${people.c}, 'in', '2026-10-06T21:00:00+05:30', 'device', 'confirmed', ${punchId})`,
        ),
      ).rejects.toThrow(
        /attendance_event_biometric_punch_fkey|ux_attendance_event_device_punch/,
      );
    });

    it('an earlier punch replaces the burst head as one unit: both writes or neither', async () => {
      const headPunch = await devicePunch(people.d, '2026-10-07T20:00:40');
      const head = await db.transaction(ctx(), (tx) =>
        appendEvent(tx, deviceIn(people.d, '2026-10-07T20:00:40', headPunch)),
      );
      const earlierPunch = await devicePunch(people.d, '2026-10-07T20:00:10');
      const earlier = deviceIn(people.d, '2026-10-07T20:00:10', earlierPunch);

      await expect(
        db.transaction(ctx(), async (tx) => {
          const result = await replaceDeviceEvent(tx, head.eventId, earlier);
          expect(result.outcome).toBe('appended');
          throw new Error('the caller failed afterwards');
        }),
      ).rejects.toThrow('the caller failed afterwards');
      expect(await supersedersOf(head.eventId)).toBe(0);
      expect(await eventsOfPunch(earlierPunch)).toBe(0);

      const replaced = await db.transaction(ctx(), (tx) =>
        replaceDeviceEvent(tx, head.eventId, earlier),
      );
      expect(replaced).toMatchObject({
        outcome: 'appended',
        workDate: '2026-10-07',
        replayed: false,
      });
      expect(await supersedersOf(head.eventId)).toBe(1);
      expect(await placementOf(head.eventId)).toMatchObject({ workDate: '2026-10-07' });

      // The same replacement delivered again is the same answer, and writes nothing.
      const again = await db.transaction(ctx(), (tx) =>
        replaceDeviceEvent(tx, head.eventId, earlier),
      );
      expect(again).toMatchObject({ outcome: 'appended', replayed: true });
      expect(await supersedersOf(head.eventId)).toBe(1);
      expect(await eventsOfPunch(earlierPunch)).toBe(1);
    });

    it('refuses another person’s event, a manual event, and a head a correction already replaced', async () => {
      const newPunch = await devicePunch(people.d, '2026-10-08T20:00:10');
      const incoming = deviceIn(people.d, '2026-10-08T20:00:10', newPunch);
      const replace = (displacedEventId: string) =>
        db.transaction(ctx(), (tx) => replaceDeviceEvent(tx, displacedEventId, incoming));

      const colleague = await db.transaction(ctx(), async (tx) =>
        appendEvent(
          tx,
          deviceIn(
            people.c,
            '2026-10-08T20:00:40',
            await devicePunch(people.c, '2026-10-08T20:00:40'),
          ),
        ),
      );
      await expect(replace(colleague.eventId)).resolves.toEqual({
        outcome: 'refused',
        reason: 'other-person',
      });

      const manual = await punch(people.d, 'in', '2026-10-08T20:01:00');
      await expect(replace(manual.eventId)).resolves.toEqual({
        outcome: 'refused',
        reason: 'not-a-device-event',
      });

      const headPunch = await devicePunch(people.d, '2026-10-08T20:00:30');
      const head = await db.transaction(ctx(), (tx) =>
        appendEvent(tx, deviceIn(people.d, '2026-10-08T20:00:30', headPunch)),
      );
      // A correction event points at the approved correction behind it (step 7's key).
      const [approved] = (await asOwner(
        'the approved correction',
        sql`
        INSERT INTO attendance_correction (organization_id, user_id, work_date, kind, payload, reason, requested_by,
                                           status, decided_by, decided_at)
        VALUES (${ORG}, ${people.d}, '2026-10-08', 'replace-event', '{}'::jsonb,
                'The device clock ran half a minute fast that evening', ${people.d}, 'approved', ${HR}, now())
        RETURNING id`,
      )) as { id: string }[];
      const [correction] = (await asOwner(
        'HR corrects the head',
        sql`
        INSERT INTO attendance_event (organization_id, user_id, kind, occurred_at, source, evidence, correction_id,
                                      supersedes_event_id)
        VALUES (${ORG}, ${people.d}, 'in', '2026-10-08T20:00:00+05:30', 'correction', 'confirmed', ${approved!.id},
                ${head.eventId})
        RETURNING id`,
      )) as { id: string }[];
      await expect(replace(head.eventId)).resolves.toEqual({
        outcome: 'refused',
        reason: 'already-superseded',
      });
      // Nothing was appended, and the human decision still stands.
      expect(await eventsOfPunch(newPunch)).toBe(0);
      expect(await supersedersOf(head.eventId)).toBe(1);
      expect(await supersedersOf(correction!.id)).toBe(0);
    });
  });
});
