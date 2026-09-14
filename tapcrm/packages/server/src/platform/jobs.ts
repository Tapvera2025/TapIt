import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { purgeAllExpiredGeofenceCoordinates } from '../modules/identity/geofence/privacy.js';

/** Queue integration point for transactional email/outbox delivery. */
export const PLATFORM_JOBS = {
  SEND_ADMIN_INVITATION: 'platform.send-admin-invitation',
  PURGE_GEOFENCE_COORDINATES: 'identity.purge-geofence-coordinates',
} as const;

const RETENTION_QUEUE = 'tapcrm.identity.retention';
let connection: Redis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;

/**
 * Schedules the existing idempotent purge operation. BullMQ owns scheduling;
 * the handler still iterates organizations through platformDb and tenant RLS.
 */
export async function startBackgroundJobs(): Promise<void> {
  connection = new Redis(loadConfig().REDIS_URL, { maxRetriesPerRequest: null });
  queue = new Queue(RETENTION_QUEUE, { connection });
  worker = new Worker(RETENTION_QUEUE, async (job) => {
    if (job.name === PLATFORM_JOBS.PURGE_GEOFENCE_COORDINATES) {
      await purgeAllExpiredGeofenceCoordinates();
    }
  }, { connection });
  worker.on('failed', (job, error) => {
    console.error(JSON.stringify({ level: 'error', msg: 'background job failed', job: job?.name, error: String(error) }));
  });
  await queue.upsertJobScheduler(
    'geofence-coordinate-retention',
    { every: 24 * 60 * 60 * 1000 },
    { name: PLATFORM_JOBS.PURGE_GEOFENCE_COORDINATES, data: { runId: randomUUID() } },
  );
}

export async function stopBackgroundJobs(): Promise<void> {
  await worker?.close();
  await queue?.close();
  await connection?.quit();
  worker = null;
  queue = null;
  connection = null;
}
