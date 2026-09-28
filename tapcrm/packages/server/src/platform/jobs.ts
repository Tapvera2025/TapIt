import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { purgeAllExpiredGeofenceCoordinates } from '../modules/identity/geofence/privacy.js';
import { markExpiredOverrides } from '../modules/access-management/repository.js';
import { platformDb } from './dal/db.js';
import { sql } from './dal/sql.js';
import { runDailyAuditIntegrityVerification } from '../modules/audit/integrity.js';
import { runAuditRetention } from '../modules/audit/archive.js';
import { pruneExpired } from '../modules/notifications/repository.js';

/** Queue integration point for transactional email/outbox delivery. */
export const PLATFORM_JOBS = {
  SEND_ADMIN_INVITATION: 'platform.send-admin-invitation',
  PURGE_GEOFENCE_COORDINATES: 'identity.purge-geofence-coordinates',
  AUDIT_EXPIRED_ACCESS_OVERRIDES: 'access.audit-expired-overrides',
  AUDIT_CHAIN_VERIFICATION: 'audit.chain-verification',
  AUDIT_RETENTION: 'audit.retention',
  NOTIFICATION_RETENTION: 'notifications.retention',
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
    if (job.name === PLATFORM_JOBS.AUDIT_EXPIRED_ACCESS_OVERRIDES) {
      await auditExpiredAccessOverrides();
    }
    if (job.name === PLATFORM_JOBS.AUDIT_CHAIN_VERIFICATION) {
      await runDailyAuditIntegrityVerification();
    }
    if (job.name === PLATFORM_JOBS.AUDIT_RETENTION) {
      await runAuditRetention();
    }
    if (job.name === PLATFORM_JOBS.NOTIFICATION_RETENTION) {
      await pruneExpiredNotifications();
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
  await queue.upsertJobScheduler(
    'access-override-expiry-audit',
    { every: 24 * 60 * 60 * 1000 },
    { name: PLATFORM_JOBS.AUDIT_EXPIRED_ACCESS_OVERRIDES, data: { runId: randomUUID() } },
  );
  await queue.upsertJobScheduler(
    'audit-chain-verification',
    { every: 24 * 60 * 60 * 1000 },
    { name: PLATFORM_JOBS.AUDIT_CHAIN_VERIFICATION, data: { runId: randomUUID() } },
  );
  await queue.upsertJobScheduler(
    'notification-retention',
    { every: 24 * 60 * 60 * 1000 },
    { name: PLATFORM_JOBS.NOTIFICATION_RETENTION, data: { runId: randomUUID() } },
  );
  await queue.upsertJobScheduler(
    'audit-retention',
    { every: 24 * 60 * 60 * 1000 },
    { name: PLATFORM_JOBS.AUDIT_RETENTION, data: { runId: randomUUID() }, opts: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } } },
  );
}

/**
 * Maintenance only. `authz-adapter` excludes expired rows at read time; this
 * job merely records an idempotent expiry event for review/audit purposes.
 */
async function auditExpiredAccessOverrides(): Promise<void> {
  const organizations = await platformDb.query<{ id: string }>(
    'retention-enforcement',
    'find organizations for access override expiry audit',
    sql`SELECT id FROM organization WHERE status <> 'deleted'`,
  );
  await Promise.all(organizations.map(({ id }) => platformDb.transactionForOrganization(
    id,
    'retention-enforcement',
    'audit expired access overrides',
    async (tx) => {
      const expired = await markExpiredOverrides(tx);
      for (const override of expired) {
        await tx.query(sql`
          INSERT INTO audit_outbox (organization_id, stream, payload)
          VALUES (${id}, 'activity', ${JSON.stringify({
            action: 'access.override_expired',
            actorId: null,
            actorType: 'service',
            targetType: 'user',
            targetId: override.userId,
            before: {
              overrideId: override.id,
              action: override.action,
              allowed: override.allowed,
              scope: override.scope,
              expiresAt: override.expiresAt.toISOString(),
            },
            after: null,
            reason: override.reason,
          })}::jsonb)
        `);
      }
    },
  )));
}

/** NT-8: expired notifications are pruned; the delivery log deliberately outlives them. */
async function pruneExpiredNotifications(): Promise<void> {
  const organizations = await platformDb.query<{ id: string }>(
    'retention-enforcement',
    'find organizations for notification pruning',
    sql`SELECT id FROM organization WHERE status <> 'deleted'`,
  );
  for (const { id } of organizations) {
    await platformDb.transactionForOrganization(id, 'retention-enforcement', 'prune expired notifications', (tx) => pruneExpired(tx, id));
  }
}

export async function stopBackgroundJobs(): Promise<void> {
  await worker?.close();
  await queue?.close();
  await connection?.quit();
  worker = null;
  queue = null;
  connection = null;
}
