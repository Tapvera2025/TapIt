import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { startJobs, stopJobs } from '../../platform/jobs/runner.js';
import { drainOrganization } from '../../platform/outbox/drainer.js';
import { retriedUntilDelivered } from '../../platform/outbox/registry.js';
import { appendEvent, type AppendEventInput } from './facade.js';
import { registerAttendanceJobs, type AttendanceJobs } from './jobs.js';
import { recalculateRecord, sweepRefreshRequests, sweepStale } from './recalculate.js';

/**
 * Step 3b against real PostgreSQL and Redis: punches reach the calculator
 * through the outbox and the queue, shift and holiday changes reach past days,
 * and the stale sweeper catches what a lost message would leave (design §8.5).
 *
 *   TAPCRM_INTEGRATION_DB=1 REDIS_URL=… MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const RUN = randomUUID().slice(0, 8);
const QUEUE = `tapcrm.jobs.test-${RUN}`;
const ORG = randomUUID();
const DEPT = randomUUID();
const POS = randomUUID();
const HR = randomUUID();
const people = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
/** No shift of their own: works the department's default, and later moves to sales. */
const MOVER = randomUUID();
const SALES = randomUUID();
const SALES_POS = randomUUID();
const DAY = randomUUID();
const EARLY = randomUUID();
const LATE = randomUUID();
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

const punch = (userId: string, kind: AppendEventInput['kind'], local: string) =>
  db.transaction(ctx(), (tx) =>
    appendEvent(tx, {
      userId,
      kind,
      at: ist(local),
      source: 'web',
      evidence: 'confirmed',
      remote: true,
    }),
  );

async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

interface Day {
  id: string;
  status: string | null;
  presentUnits: number;
  absentUnits: number;
  holidayUnits: number;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes: number;
  flags: string[];
  rulesVersion: string;
  shiftId: string;
  inputVersion: number;
  calculatedInputVersion: number;
  calculationVersion: number;
}

const dayOf = async (userId: string, date: string): Promise<Day | undefined> =>
  (
    (await asOwner(
      'read day',
      sql`
      SELECT id, status, present_units, absent_units, holiday_units, worked_minutes, break_minutes, late_minutes,
             early_exit_minutes, overtime_minutes, flags, rules_version, shift_snapshot->>'shiftId' AS shift_id,
             input_version, calculated_input_version, calculation_version
      FROM attendance_record WHERE user_id = ${userId} AND work_date = ${date}`,
    )) as Day[]
  )[0];

/** Drains the outbox until the day is calculated for its newest inputs and `also` holds. */
async function settled(
  userId: string,
  date: string,
  also: (day: Day) => boolean = () => true,
): Promise<Day> {
  const day = await until(
    async () => {
      await drainOrganization(ORG);
      return dayOf(userId, date);
    },
    (row) =>
      row !== undefined && row.calculatedInputVersion === row.inputVersion && also(row),
  );
  expect(day).toBeDefined();
  return day!;
}

const outbox = async (name: string, payload: unknown) =>
  (
    (await asOwner(
      'write outbox event',
      sql`
      INSERT INTO domain_outbox (organization_id, event_name, payload)
      VALUES (${ORG}, ${name}, ${JSON.stringify(payload)}::jsonb) RETURNING id`,
    )) as { id: string }[]
  )[0]!.id;

const runsOf = (jobName: string, keyPrefix: string) =>
  asOwner(
    'read job runs',
    sql`
    SELECT idempotency_key, outcome FROM job_run
    WHERE organization_id = ${ORG} AND job_name = ${jobName} AND idempotency_key LIKE ${`${keyPrefix}%`}
    ORDER BY idempotency_key`,
  ) as Promise<{ idempotencyKey: string; outcome: string | null }[]>;

interface RefreshRow {
  userId: string;
  completedAt: Date | null;
  failedAt: Date | null;
}

const requestsOf = (eventId: string) =>
  asOwner(
    'read refresh requests',
    sql`
    SELECT user_id, completed_at, failed_at FROM attendance_refresh_request
    WHERE source_event_id = ${eventId} ORDER BY user_id`,
  ) as Promise<RefreshRow[]>;

const requestById = async (id: string) =>
  (
    (await asOwner(
      'read refresh request',
      sql`SELECT user_id, completed_at, failed_at FROM attendance_refresh_request WHERE id = ${id}`,
    )) as RefreshRow[]
  )[0]!;

/** A refresh request written straight into the table, as if its handler ran and its job was lost. */
const writeRequest = async (userId: string, date: string, requestedAgo: string) =>
  (
    (await asOwner(
      'write refresh request',
      sql`
      INSERT INTO attendance_refresh_request (organization_id, user_id, source_event_id, from_date, to_date,
                                              requested_at)
      VALUES (${ORG}, ${userId}, ${randomUUID()}, ${date}, ${date}, now() - ${requestedAgo}::interval)
      RETURNING id`,
    )) as { id: string }[]
  )[0]!.id;

let jobs: AttendanceJobs;

// Waits give up after 15 seconds (`until`), well inside the test's own limit,
// so a failure shows what the day looked like rather than a timeout.
describe.skipIf(!enabled)(
  'attendance recalculation (PostgreSQL and Redis)',
  { timeout: 30_000 },
  () => {
    beforeAll(async () => {
      await asOwner(
        'create organization',
        sql`
      INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`RC${RUN}`}, 'Recalculation Test', 'Asia/Kolkata')`,
      );
      await asOwner(
        'create department',
        sql`
      INSERT INTO department (id, organization_id, code, name, kind) VALUES (${DEPT}, ${ORG}, 'OPS', 'Operations', 'operations')`,
      );
      await asOwner(
        'create sales',
        sql`
      INSERT INTO department (id, organization_id, code, name, kind) VALUES (${SALES}, ${ORG}, 'SAL', 'Sales', 'sales')`,
      );
      await asOwner(
        'create positions',
        sql`
      INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
      VALUES (${POS}, ${ORG}, ${DEPT}, 'OPS-1', 'Operator', 20),
             (${SALES_POS}, ${ORG}, ${SALES}, 'SAL-1', 'Seller', 20)`,
      );
      for (const [index, id] of [HR, ...Object.values(people), MOVER].entries()) {
        await asOwner(
          'create person',
          sql`
        INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
        VALUES (${id}, ${ORG}, 'employee', ${`EMP-RC${String(index).padStart(3, '0')}`}, ${`p${index}-${id}@t.io`},
                ${`Person ${index}`}, ${POS}, ${DEPT})`,
        );
      }
      // 09:00–18:00 for everyone, an early 07:00–16:00 to move a day onto, and a
      // late 11:00–20:00 for sales. Ten minutes' grace, 450 minutes a full day,
      // 240 a half; no overtime rule.
      await asOwner(
        'shifts',
        sql`
      INSERT INTO shift (id, organization_id, code, name, kind, created_by)
      VALUES (${DAY}, ${ORG}, 'DAY', 'Day', 'fixed', ${HR}), (${EARLY}, ${ORG}, 'EARLY', 'Early', 'fixed', ${HR}),
             (${LATE}, ${ORG}, 'LATE', 'Late', 'fixed', ${HR})`,
      );
      await asOwner(
        'versions',
        sql`
      INSERT INTO shift_version (organization_id, shift_id, effective_from, start_time, end_time, grace_minutes,
                                 full_day_minutes, half_day_minutes, created_by)
      VALUES (${ORG}, ${DAY}, '2026-01-01', '09:00', '18:00', 10, 450, 240, ${HR}),
             (${ORG}, ${EARLY}, '2026-01-01', '07:00', '16:00', 10, 450, 240, ${HR}),
             (${ORG}, ${LATE}, '2026-01-01', '11:00', '20:00', 10, 450, 240, ${HR})`,
      );
      await asOwner(
        'department defaults',
        sql`
      INSERT INTO department_shift_default (organization_id, department_id, shift_id, effective_from, created_by)
      VALUES (${ORG}, ${DEPT}, ${DAY}, '2026-01-01', ${HR}), (${ORG}, ${SALES}, ${LATE}, '2026-01-01', ${HR})`,
      );
      await asOwner(
        'setting',
        sql`
      INSERT INTO shift_setting (organization_id, effective_from, max_closing_extension_minutes, created_by)
      VALUES (${ORG}, '2026-01-01', 240, ${HR})`,
      );
      for (const id of Object.values(people)) {
        await asOwner(
          'day template',
          sql`
        INSERT INTO shift_assignment (organization_id, user_id, kind, shift_id, effective_from, created_by)
        VALUES (${ORG}, ${id}, 'template', ${DAY}, '2026-09-01', ${HR})`,
        );
      }
      jobs = registerAttendanceJobs();
      await startJobs({ queueName: QUEUE });
    });

    afterAll(async () => {
      await stopJobs();
      const redis = new Redis(loadConfig().REDIS_URL, { maxRetriesPerRequest: null });
      const queue = new Queue(QUEUE, { connection: redis });
      await queue.obliterate({ force: true });
      await queue.close();
      await redis.quit();
      await closePools();
    });

    it('never gives up on shift, holiday and employment changes, or on an export request', () => {
      expect(retriedUntilDelivered()).toEqual([
        'attendance.export-requested',
        'employee.employment-changed',
        'holidays.days-changed',
        'shifts.days-changed',
      ]);
    });

    it('calculates a punched day once for two requests, and rebuilds the month', async () => {
      await punch(people.a, 'in', '2026-09-22T09:25:00');
      await punch(people.a, 'out', '2026-09-22T18:00:00');
      const day = await settled(people.a, '2026-09-22');
      expect(day).toMatchObject({
        status: 'present',
        presentUnits: 2,
        absentUnits: 0,
        workedMinutes: 515,
        lateMinutes: 15,
        earlyExitMinutes: 0,
        overtimeMinutes: 0,
        rulesVersion: 'attendance-rules/1',
        calculationVersion: 1,
      });
      expect(day.flags).toEqual(['late', 'remote-without-approval']);
      const runs = await until(
        () => runsOf('attendance.recalculate', day.id),
        (rows) => rows.length === 2 && rows.every((row) => row.outcome === 'success'),
      );
      expect(runs.map((run) => run.idempotencyKey)).toEqual([
        `${day.id}:2`,
        `${day.id}:3`,
      ]);

      const [month] = (await asOwner(
        'read month',
        sql`
      SELECT days, present_units, worked_minutes, late_days, late_minutes, open_days, stale_days
      FROM attendance_month_summary WHERE user_id = ${people.a} AND month = '2026-09-01'`,
      )) as Record<string, number>[];
      expect(month).toEqual({
        days: 1,
        presentUnits: 2,
        workedMinutes: 515,
        lateDays: 1,
        lateMinutes: 15,
        openDays: 1,
        staleDays: 0,
      });
    });

    it('leaves a day alone when its answer is already for its newest inputs', async () => {
      const before = (await dayOf(people.a, '2026-09-22'))!;
      expect(await db.transaction(ctx(), (tx) => recalculateRecord(tx, before.id))).toBe(
        'current',
      );
      expect((await dayOf(people.a, '2026-09-22'))!.calculationVersion).toBe(
        before.calculationVersion,
      );
    });

    it('recalculates when a new input arrives', async () => {
      await punch(people.a, 'break-start', '2026-09-22T13:00:00');
      await punch(people.a, 'break-end', '2026-09-22T13:30:00');
      const day = await settled(people.a, '2026-09-22', (row) => row.breakMinutes === 30);
      // D19: no break policy yet, so the break is paid and the worked time stands.
      expect(day).toMatchObject({
        status: 'present',
        workedMinutes: 515,
        breakMinutes: 30,
        calculationVersion: 2,
      });
    });

    it('a past shift change reaches the day through shifts.days-changed, even once it is closed', async () => {
      await punch(people.b, 'in', '2026-09-23T09:05:00');
      await punch(people.b, 'out', '2026-09-23T18:00:00');
      const first = await settled(people.b, '2026-09-23');
      expect(first).toMatchObject({ status: 'present', lateMinutes: 0, shiftId: DAY });

      await asOwner(
        'close the day',
        sql`UPDATE attendance_record SET state = 'closed', closed_at = now(), closed_by = 'punch-out' WHERE id = ${first.id}`,
      );
      await asOwner(
        'move the day to the early shift',
        sql`
      INSERT INTO shift_override (organization_id, user_id, work_date, kind, shift_id, reason, created_by)
      VALUES (${ORG}, ${people.b}, '2026-09-23', 'shift', ${EARLY}, 'Cover', ${HR})`,
      );
      await outbox('shifts.days-changed', {
        userIds: [people.b],
        from: '2026-09-23',
        to: '2026-09-23',
        reason: 'override',
      });

      const day = await settled(people.b, '2026-09-23', (row) => row.shiftId === EARLY);
      // 09:05 against 07:00 and ten minutes' grace.
      expect(day).toMatchObject({
        status: 'present',
        lateMinutes: 115,
        workedMinutes: 535,
        calculationVersion: 2,
      });
      expect(day.flags).toContain('late');
    });

    it('a holiday declared on a worked day makes it a holiday flagged as worked, and nothing else moves', async () => {
      await punch(people.c, 'in', '2026-09-24T09:00:00');
      await punch(people.c, 'out', '2026-09-24T18:00:00');
      expect((await settled(people.c, '2026-09-24')).status).toBe('present');
      const neighbour = (await dayOf(people.b, '2026-09-23'))!;

      await asOwner(
        'declare a holiday',
        sql`
      INSERT INTO holiday (organization_id, name, type, holiday_date, created_by)
      VALUES (${ORG}, 'Founders Day', 'national', '2026-09-24', ${HR})`,
      );
      const eventId = await outbox('holidays.days-changed', {
        from: '2026-09-24',
        toExclusive: '2026-09-25',
        reason: 'declared',
      });

      const day = await settled(
        people.c,
        '2026-09-24',
        (row) => row.status === 'holiday',
      );
      expect(day).toMatchObject({ holidayUnits: 2, presentUnits: 0, workedMinutes: 540 });
      expect(day.flags).toContain('holiday-worked');

      // Everyone with a day in reach (the 23rd to the 25th) got a refresh
      // request, and each was completed; a's 22nd was not in reach.
      const requests = await until(
        () => requestsOf(eventId),
        (rows) => rows.length === 2 && rows.every((row) => row.completedAt !== null),
      );
      expect(requests.map((row) => row.userId).sort()).toEqual(
        [people.b, people.c].sort(),
      );
      // b's 23rd was refreshed, but none of its facts changed, so it kept its answer.
      expect((await dayOf(people.b, '2026-09-23'))!.calculationVersion).toBe(
        neighbour.calculationVersion,
      );
    });

    it('§8.1: after a transfer, a change to the old department still reaches the days built in it', async () => {
      await punch(MOVER, 'in', '2026-03-10T09:05:00');
      await punch(MOVER, 'out', '2026-03-10T18:00:00');
      await punch(MOVER, 'in', '2026-03-12T09:05:00');
      await punch(MOVER, 'out', '2026-03-12T18:00:00');
      expect(await settled(MOVER, '2026-03-10')).toMatchObject({
        status: 'present',
        shiftId: DAY,
      });
      expect(await settled(MOVER, '2026-03-12')).toMatchObject({
        status: 'present',
        shiftId: DAY,
      });

      await asOwner(
        'move to sales',
        sql`UPDATE app_user SET department_id = ${SALES}, position_id = ${SALES_POS} WHERE id = ${MOVER}`,
      );

      // Operations declares a holiday on the 10th, after the move.
      const holiday = randomUUID();
      await asOwner(
        'an operations holiday',
        sql`
      INSERT INTO holiday (id, organization_id, name, type, holiday_date, created_by)
      VALUES (${holiday}, ${ORG}, 'Operations Day', 'regional', '2026-03-10', ${HR})`,
      );
      await asOwner(
        'scoped to operations',
        sql`INSERT INTO holiday_scope (organization_id, holiday_id, department_id) VALUES (${ORG}, ${holiday}, ${DEPT})`,
      );
      await outbox('holidays.days-changed', {
        departmentIds: [DEPT],
        from: '2026-03-10',
        toExclusive: '2026-03-11',
        reason: 'declared',
      });
      const tenth = await settled(MOVER, '2026-03-10', (row) => row.status === 'holiday');
      expect(tenth).toMatchObject({ status: 'holiday', holidayUnits: 2, shiftId: DAY });
      expect(tenth.flags).toContain('holiday-worked');

      // Operations' default shift becomes the early one from the 12th.
      await asOwner(
        'end the old default',
        sql`UPDATE department_shift_default SET effective_to = '2026-03-12' WHERE department_id = ${DEPT}`,
      );
      await asOwner(
        'the new default',
        sql`
      INSERT INTO department_shift_default (organization_id, department_id, shift_id, effective_from, created_by)
      VALUES (${ORG}, ${DEPT}, ${EARLY}, '2026-03-12', ${HR})`,
      );
      await outbox('shifts.days-changed', {
        departmentId: DEPT,
        from: '2026-03-12',
        to: null,
        reason: 'new default',
      });
      const twelfth = await settled(MOVER, '2026-03-12', (row) => row.shiftId !== DAY);
      // Operations' early shift, not sales' late one: 09:05 against 07:00 and ten minutes' grace.
      expect(twelfth).toMatchObject({
        status: 'present',
        shiftId: EARLY,
        lateMinutes: 115,
      });
    });

    it('the stale sweeper re-offers a day whose request was lost', async () => {
      const day = (await dayOf(people.a, '2026-09-22'))!;
      await asOwner(
        'lose a request',
        sql`
      UPDATE attendance_record SET input_version = input_version + 1, input_changed_at = now() - interval '2 minutes'
      WHERE id = ${day.id}`,
      );
      await jobs.staleSweeper.enqueue({
        organizationId: ORG,
        key: `sweep-${RUN}`,
        payload: undefined,
      });
      const after = await settled(
        people.a,
        '2026-09-22',
        (row) => row.calculationVersion === day.calculationVersion + 1,
      );
      expect(after.calculatedInputVersion).toBe(day.inputVersion + 1);
    });

    it('flags a day whose third generation failed, until a later input succeeds', async () => {
      const day = (await dayOf(people.c, '2026-09-24'))!;
      await asOwner(
        'lose a request',
        sql`
      UPDATE attendance_record SET input_version = input_version + 1, input_changed_at = now() - interval '2 minutes'
      WHERE id = ${day.id}`,
      );
      const base = `${day.id}:${day.inputVersion + 1}`;
      for (const key of [base, `${base}:g2`, `${base}:g3`]) {
        await asOwner(
          'a dead-lettered generation',
          sql`
        INSERT INTO job_run (organization_id, job_name, idempotency_key, started_at, finished_at, outcome, attempts,
                             dead_lettered_at)
        VALUES (${ORG}, 'attendance.recalculate', ${key}, now() - interval '3 days', now() - interval '3 days',
                'failure', 5, now() - interval '2 days')`,
        );
      }
      expect(await sweepStale(ctx(), jobs.recalculate, new Date())).toEqual({
        offered: 0,
        flagged: 1,
      });
      const flagged = (await dayOf(people.c, '2026-09-24'))!;
      expect(flagged.flags).toContain('recalculation-failed');
      expect(flagged.calculatedInputVersion).toBeLessThan(flagged.inputVersion);

      await punch(people.c, 'break-start', '2026-09-24T13:00:00');
      await punch(people.c, 'break-end', '2026-09-24T13:15:00');
      const recovered = await settled(
        people.c,
        '2026-09-24',
        (row) => row.breakMinutes === 15,
      );
      expect(recovered.flags).not.toContain('recalculation-failed');
    });

    it('the stale sweeper runs a refresh request whose job was lost', async () => {
      const id = await writeRequest(people.a, '2026-09-22', '2 minutes');
      expect(await sweepRefreshRequests(ctx(), jobs.refreshDays, new Date())).toEqual({
        offered: 1,
        flagged: 0,
      });
      const done = await until(
        () => requestById(id),
        (row) => row.completedAt !== null,
      );
      expect(done.completedAt).toBeInstanceOf(Date);
    });

    it('a refresh request whose third generation failed waits for a person, and runs once re-armed', async () => {
      const id = await writeRequest(people.b, '2026-09-23', '3 days');
      for (const key of [id, `${id}:g2`, `${id}:g3`]) {
        await asOwner(
          'a dead-lettered generation',
          sql`
          INSERT INTO job_run (organization_id, job_name, idempotency_key, started_at, finished_at, outcome,
                               attempts, dead_lettered_at)
          VALUES (${ORG}, 'attendance.refresh-days', ${key}, now() - interval '3 days',
                  now() - interval '3 days', 'failure', 5, now() - interval '2 days')`,
        );
      }
      expect(await sweepRefreshRequests(ctx(), jobs.refreshDays, new Date())).toEqual({
        offered: 0,
        flagged: 1,
      });
      expect((await requestById(id)).failedAt).toBeInstanceOf(Date);

      // A person re-arms it: a new key, so its generations start again.
      await asOwner(
        're-arm the request',
        sql`UPDATE attendance_refresh_request SET failed_at = NULL, replays = replays + 1 WHERE id = ${id}`,
      );
      expect(await sweepRefreshRequests(ctx(), jobs.refreshDays, new Date())).toEqual({
        offered: 1,
        flagged: 0,
      });
      const done = await until(
        () => requestById(id),
        (row) => row.completedAt !== null,
      );
      expect(done).toMatchObject({ failedAt: null });
    });
  },
);
