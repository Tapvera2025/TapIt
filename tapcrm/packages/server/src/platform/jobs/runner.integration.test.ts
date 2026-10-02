import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { createJobContext, systemPrincipal } from '../dal/context.js';
import { db, platformDb } from '../dal/db.js';
import { closePools } from '../dal/pool.js';
import { sql } from '../dal/sql.js';
import { defineJob, startJobs, stopJobs, type JobHandle } from './runner.js';

/**
 * The job runner against real Redis and PostgreSQL (design §5.4).
 *
 *   TAPCRM_INTEGRATION_DB=1 REDIS_URL=… MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const RUN = randomUUID().slice(0, 8);
const ORG = randomUUID();
const QUEUE = `tapcrm.jobs.test-${RUN}`;
const asOwner = (reason: string, fragment: ReturnType<typeof sql>) => platformDb.query('migration', reason, fragment);

interface JobRunRow {
  idempotencyKey: string;
  outcome: string | null;
  attempts: number;
  itemsProcessed: number;
  deadLetteredAt: Date | null;
}

const runsOf = (jobName: string) =>
  asOwner('read test job runs', sql`
    SELECT idempotency_key, outcome, attempts, items_processed, dead_lettered_at
    FROM job_run WHERE organization_id = ${ORG} AND job_name = ${jobName} ORDER BY started_at`) as Promise<JobRunRow[]>;

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

let calls = { counted: 0, failing: 0, scheduled: 0 };
let counted: JobHandle<{ n: number }>;
let failing: JobHandle<undefined>;
const names = {
  counted: `test.counted-${RUN}`,
  failing: `test.failing-${RUN}`,
  scheduled: `test.scheduled-${RUN}`,
};

describe.skipIf(!enabled)('job runner (Redis and PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner('create test organization', sql`
      INSERT INTO organization (id, code, name, timezone)
      VALUES (${ORG}, ${`JR${RUN}`}, 'Job Runner Test', 'Asia/Kolkata')`);
    counted = defineJob<{ n: number }>({
      name: names.counted,
      perOrganization: true,
      handler: async ({ payload }) => {
        calls.counted += 1;
        return { itemsProcessed: payload.n };
      },
    });
    failing = defineJob({
      name: names.failing,
      perOrganization: true,
      attempts: 2,
      backoffMs: 50,
      handler: async () => {
        calls.failing += 1;
        throw new Error('always fails');
      },
    });
    defineJob({
      name: names.scheduled,
      perOrganization: true,
      schedule: { every: 1_000 },
      handler: async () => {
        calls.scheduled += 1;
      },
    });
    await startJobs({ queueName: QUEUE });
  });

  afterAll(async () => {
    await stopJobs();
    const redis = new Redis(loadConfig().REDIS_URL, { maxRetriesPerRequest: null });
    const queue = new Queue(QUEUE, { connection: redis });
    await queue.obliterate({ force: true });
    await queue.close();
    await redis.quit();
    await asOwner('remove test job runs', sql`DELETE FROM job_run WHERE job_name LIKE ${`test.%-${RUN}`}`);
    await asOwner('remove test organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  it('JB-1/JB-2: a key runs once and leaves one job_run row', async () => {
    calls = { ...calls, counted: 0 };
    await counted.enqueue({ organizationId: ORG, key: 'day:2026-09-25', payload: { n: 7 } });
    await counted.enqueue({ organizationId: ORG, key: 'day:2026-09-25', payload: { n: 7 } });
    const rows = await until(() => runsOf(names.counted), (r) => r[0]?.outcome === 'success');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ idempotencyKey: 'day:2026-09-25', outcome: 'success', attempts: 1, itemsProcessed: 7 });

    // Delivered again after it finished: skipped, not run.
    await counted.enqueue({ organizationId: ORG, key: 'day:2026-09-25', payload: { n: 7 } });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(calls.counted).toBe(1);
  });

  it('JB-4: a failing key retries, then dead-letters, and never runs again', async () => {
    await failing.enqueue({ organizationId: ORG, key: 'k1', payload: undefined });
    const rows = await until(() => runsOf(names.failing), (r) => r[0]?.deadLetteredAt != null);
    expect(rows[0]).toMatchObject({ outcome: 'failure', attempts: 2 });
    expect(rows[0]!.deadLetteredAt).toBeInstanceOf(Date);
    expect(calls.failing).toBe(2);

    await failing.enqueue({ organizationId: ORG, key: 'k1', payload: undefined });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(calls.failing).toBe(2);
  });

  it('§5.4: the next generation waits a day after a dead letter', async () => {
    const ctx = createJobContext({ organizationId: ORG, principal: systemPrincipal(ORG), jobName: 'test', runId: RUN });
    const now = new Date();
    const today = await db.transaction(ctx, (tx) => failing.nextGeneration(tx, 'k1', now));
    const tomorrow = await db.transaction(ctx, (tx) =>
      failing.nextGeneration(tx, 'k1', new Date(now.getTime() + 25 * 3_600_000)),
    );
    expect(today).toEqual({ kind: 'wait' });
    expect(tomorrow).toEqual({ kind: 'run', key: 'k1:g2', generation: 2 });
  });

  it('done when: a scheduled job leaves a job_run row for the organization', async () => {
    const rows = await until(() => runsOf(names.scheduled), (r) => r.some((row) => row.outcome === 'success'));
    const row = rows.find((candidate) => candidate.outcome === 'success');
    expect(row).toBeDefined();
    expect(Number.isNaN(Date.parse(row!.idempotencyKey))).toBe(false);
  });
});
