import { Queue, UnrecoverableError, Worker, type Job, type RepeatOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { loadConfig } from '../../config.js';
import { createJobContext, systemPrincipal, type RequestContext } from '../dal/context.js';
import { db, platformDb, type Tx } from '../dal/db.js';
import { sql } from '../dal/sql.js';
import { systemClock, type Clock } from '../time.js';
import { decideGeneration, generationKeys, type GenerationDecision } from './generation.js';
import { beginRun, failRun, finishRun, generationRows, type RunOutcome } from './run-record.js';

/**
 * The job runner — attendance design §5.4, TECH §11.
 *
 *   JB-1  Every job is keyed. A key that finished or dead-lettered never runs
 *         again, however often it is delivered.
 *   JB-2  Every run of a per-organization job writes `job_run`.
 *   JB-3  A per-organization job runs once per organization, each with its own
 *         context. Nothing runs with an absent tenant.
 *   JB-4  A failing job retries with backoff, then dead-letters with an alert.
 *
 * `defineJob` registers a handler. A scheduled job gets one BullMQ scheduler,
 * named after the job: `upsertJobScheduler` is idempotent, so every process
 * can declare it and the schedule still exists once per deployment (TapCRM L25).
 * Each tick of a per-organization schedule becomes one job per organization,
 * keyed by the tick's time.
 */

export const JOB_QUEUE = 'tapcrm.jobs';

/** The most attempts any job may have. Also BullMQ's stall limit, see below. */
const MAX_ATTEMPTS = 10;
const DEFAULT_ATTEMPTS = 5;
const DEFAULT_BACKOFF_MS = 30_000;
const DAY_SECONDS = 24 * 60 * 60;

export type JobSchedule =
  | { readonly every: number }
  | { readonly pattern: string; readonly tz?: string };

export interface OrganizationJobRun<P> {
  readonly ctx: RequestContext;
  readonly key: string;
  readonly payload: P;
  /** 1 for the first start of this key, counted in `job_run`. */
  readonly attempt: number;
  readonly clock: Clock;
}

export interface PlatformJobRun<P> {
  readonly key: string;
  readonly payload: P;
  readonly attempt: number;
  readonly clock: Clock;
}

interface CommonDefinition {
  /** `module.verb`, e.g. `attendance.auto-close`. Also the scheduler's id. */
  readonly name: string;
  readonly schedule?: JobSchedule;
  /** At most 10. Default 5. */
  readonly attempts?: number;
  /** First retry delay; each later one doubles. Default 30 seconds. */
  readonly backoffMs?: number;
}

export interface OrganizationJobDefinition<P> extends CommonDefinition {
  readonly perOrganization: true;
  /** Scheduled ticks reach only organizations with this module enabled. */
  readonly module?: string;
  handler(run: OrganizationJobRun<P>): Promise<RunOutcome | void>;
}

/**
 * Platform jobs run once, outside any organization. `job_run` needs an
 * organization, so the runner records nothing for them: a platform job writes
 * its own per-organization rows, as the audit jobs do.
 */
export interface PlatformJobDefinition<P> extends CommonDefinition {
  readonly perOrganization: false;
  handler(run: PlatformJobRun<P>): Promise<void>;
}

export type JobDefinition<P> = OrganizationJobDefinition<P> | PlatformJobDefinition<P>;

export interface JobHandle<P> {
  readonly name: string;
  /**
   * Queue the work under `key`. Idempotent: a key the queue already holds is
   * ignored, and a key that finished or dead-lettered is skipped when it runs.
   * Never call it inside a transaction (TX-2) — write an outbox row instead,
   * and let its handler enqueue after commit.
   */
  enqueue(input: { organizationId?: string; key: string; payload: P }): Promise<void>;
  /** §5.4 — which key, if any, a sweeper should offer for `baseKey` now. */
  nextGeneration(tx: Tx, baseKey: string, now: Date): Promise<GenerationDecision>;
}

interface JobData {
  readonly organizationId?: string;
  readonly key?: string;
  readonly payload?: unknown;
  /** Set on scheduler ticks. */
  readonly tick?: true;
}

const definitions = new Map<string, JobDefinition<unknown>>();
let connection: Redis | null = null;
let queue: Queue<JobData> | null = null;
let worker: Worker<JobData> | null = null;
let clock: Clock = systemClock;

export function defineJob<P = undefined>(definition: JobDefinition<P>): JobHandle<P> {
  if (definitions.has(definition.name)) throw new Error(`Job "${definition.name}" is defined twice`);
  const attempts = definition.attempts ?? DEFAULT_ATTEMPTS;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS) {
    throw new Error(`Job "${definition.name}": attempts must be 1 to ${MAX_ATTEMPTS}`);
  }
  definitions.set(definition.name, definition);
  return {
    name: definition.name,
    async enqueue(input) {
      if (definition.perOrganization && input.organizationId === undefined) {
        throw new Error(`Job "${definition.name}" runs per organization; give an organizationId`);
      }
      await enqueue(definition, {
        ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
        key: input.key,
        payload: input.payload,
      });
    },
    async nextGeneration(tx, baseKey, now) {
      const rows = await generationRows(tx, definition.name, generationKeys(baseKey));
      return decideGeneration(baseKey, rows, now);
    },
  };
}

/** BullMQ refuses ':' in a custom id, and keys contain it. */
export function jobIdFor(name: string, organizationId: string | undefined, key: string): string {
  return [name, organizationId ?? 'platform', key].map(encodeURIComponent).join('|');
}

function jobOptions(definition: JobDefinition<unknown>) {
  return {
    attempts: definition.attempts ?? DEFAULT_ATTEMPTS,
    backoff: { type: 'exponential', delay: definition.backoffMs ?? DEFAULT_BACKOFF_MS },
    removeOnComplete: { age: DAY_SECONDS, count: 1_000 },
    removeOnFail: { age: 7 * DAY_SECONDS },
  };
}

async function enqueue(definition: JobDefinition<unknown>, data: JobData): Promise<void> {
  if (queue === null) throw new Error('Jobs are not started');
  await queue.add(definition.name, data, {
    ...jobOptions(definition),
    jobId: jobIdFor(definition.name, data.organizationId, data.key ?? ''),
  });
}

function repeatOptions(schedule: JobSchedule): Omit<RepeatOptions, 'key'> {
  return 'every' in schedule
    ? { every: schedule.every }
    : { pattern: schedule.pattern, ...(schedule.tz === undefined ? {} : { tz: schedule.tz }) };
}

/** The instant a scheduler tick was due, which keys that tick's runs. */
function slotOf(job: Job<JobData>): string {
  return new Date(job.opts.prevMillis ?? job.timestamp).toISOString();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** JB-4 — the alert: an error line the log monitor pages on. */
function alertDeadLetter(name: string, organizationId: string | null, key: string, attempts: number, error: string): void {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'job dead-lettered',
      alert: 'job-dead-lettered',
      job: name,
      organizationId,
      key,
      attempts,
      error,
    }),
  );
}

async function organizationsFor(definition: OrganizationJobDefinition<unknown>): Promise<string[]> {
  const module = definition.module ?? null;
  const rows = await platformDb.query<{ id: string }>(
    'job-scheduling',
    `list organizations for ${definition.name}`,
    sql`
      SELECT o.id FROM organization o
      WHERE o.status <> 'deleted'
        AND (${module}::text IS NULL OR EXISTS (
          SELECT 1 FROM organization_module om JOIN module m ON m.id = om.module_id
          WHERE om.organization_id = o.id AND m.key = ${module} AND om.status = 'enabled'))
      ORDER BY o.id
    `,
  );
  return rows.map((row) => row.id);
}

async function runForOrganization(
  definition: OrganizationJobDefinition<unknown>,
  organizationId: string,
  key: string,
  payload: unknown,
): Promise<void> {
  const ctx = createJobContext({
    organizationId,
    principal: systemPrincipal(organizationId),
    jobName: definition.name,
    runId: key,
  });
  const attempts = definition.attempts ?? DEFAULT_ATTEMPTS;
  const begun = await db.transaction(ctx, (tx) => beginRun(tx, organizationId, definition.name, key));
  if (begun.kind === 'skip') return;

  // A worker that dies mid-job is "stalled": BullMQ runs the job again without
  // counting a failure. Starts are counted here instead, so a job that keeps
  // killing its worker still stops.
  if (begun.attempt > attempts) {
    const message = 'the job stopped without finishing on every attempt';
    await db.transaction(ctx, (tx) => failRun(tx, organizationId, definition.name, key, message, true));
    alertDeadLetter(definition.name, organizationId, key, begun.attempt - 1, message);
    return;
  }

  try {
    const outcome = (await definition.handler({ ctx, key, payload, attempt: begun.attempt, clock })) ?? {};
    await db.transaction(ctx, (tx) => finishRun(tx, organizationId, definition.name, key, outcome));
  } catch (error) {
    const last = begun.attempt >= attempts;
    await db.transaction(ctx, (tx) =>
      failRun(tx, organizationId, definition.name, key, messageOf(error), last),
    );
    if (!last) throw error;
    alertDeadLetter(definition.name, organizationId, key, begun.attempt, messageOf(error));
    throw new UnrecoverableError(messageOf(error));
  }
}

async function runPlatform(definition: PlatformJobDefinition<unknown>, job: Job<JobData>, key: string): Promise<void> {
  const attempts = definition.attempts ?? DEFAULT_ATTEMPTS;
  const attempt = job.attemptsMade + 1;
  try {
    await definition.handler({ key, payload: job.data.payload, attempt, clock });
  } catch (error) {
    if (attempt < attempts) throw error;
    alertDeadLetter(definition.name, null, key, attempt, messageOf(error));
    throw new UnrecoverableError(messageOf(error));
  }
}

async function processJob(job: Job<JobData>): Promise<void> {
  const definition = definitions.get(job.name);
  if (definition === undefined) throw new UnrecoverableError(`No job is defined as "${job.name}"`);

  if (job.data.tick === true) {
    const slot = slotOf(job);
    if (!definition.perOrganization) return runPlatform(definition, job, slot);
    for (const organizationId of await organizationsFor(definition)) {
      await enqueue(definition, { organizationId, key: slot });
    }
    return;
  }

  const key = job.data.key ?? '';
  if (!definition.perOrganization) return runPlatform(definition, job, key);
  if (job.data.organizationId === undefined) {
    throw new UnrecoverableError(`Job "${job.name}" arrived without an organization`);
  }
  return runForOrganization(definition, job.data.organizationId, key, job.data.payload);
}

/** Removes the schedulers of the old single-switch worker (`platform/jobs.ts`). */
async function retireLegacyQueue(redis: Redis): Promise<void> {
  const legacy = new Queue('tapcrm.identity.retention', { connection: redis });
  try {
    for (const id of [
      'geofence-coordinate-retention',
      'access-override-expiry-audit',
      'audit-chain-verification',
      'audit-retention',
    ]) {
      await legacy.removeJobScheduler(id);
    }
  } finally {
    await legacy.close();
  }
}

export interface StartJobsOptions {
  readonly queueName?: string;
  readonly redisUrl?: string;
  readonly clock?: Clock;
  readonly concurrency?: number;
}

export async function startJobs(options: StartJobsOptions = {}): Promise<void> {
  if (queue !== null) return;
  const queueName = options.queueName ?? JOB_QUEUE;
  clock = options.clock ?? systemClock;
  const redis = new Redis(options.redisUrl ?? loadConfig().REDIS_URL, { maxRetriesPerRequest: null });
  connection = redis;
  queue = new Queue<JobData>(queueName, { connection: redis });
  worker = new Worker<JobData>(queueName, processJob, {
    connection: redis,
    concurrency: options.concurrency ?? 4,
    // Let the start count above decide when a stalling job stops. With
    // BullMQ's default of 1, a job that stalled twice would fail without
    // reaching the runner, and its `job_run` row would say "started" for ever.
    maxStalledCount: MAX_ATTEMPTS,
  });
  worker.on('failed', (job, error) => {
    console.error(
      JSON.stringify({ level: 'error', msg: 'job attempt failed', job: job?.name, jobId: job?.id, error: messageOf(error) }),
    );
  });

  const scheduled = [...definitions.values()].filter((definition) => definition.schedule !== undefined);
  for (const definition of scheduled) {
    await queue.upsertJobScheduler(definition.name, repeatOptions(definition.schedule!), {
      name: definition.name,
      data: { tick: true },
      opts: jobOptions(definition),
    });
  }
  // A job that was renamed or removed must not keep its schedule.
  const wanted = new Set(scheduled.map((definition) => definition.name));
  for (const existing of await queue.getJobSchedulers()) {
    if (!wanted.has(existing.key)) await queue.removeJobScheduler(existing.key);
  }
  if (queueName === JOB_QUEUE) await retireLegacyQueue(redis);
}

export async function stopJobs(): Promise<void> {
  await worker?.close();
  await queue?.close();
  await connection?.quit();
  worker = null;
  queue = null;
  connection = null;
}

/** Tests only. */
export function __resetJobDefinitions(): void {
  definitions.clear();
}
