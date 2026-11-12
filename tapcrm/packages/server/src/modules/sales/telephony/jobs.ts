import type { RequestContext } from '../../../platform/dal/context.js';
import { defineJob, type JobHandle } from '../../../platform/jobs/runner.js';
import { listSyncableConnectionIds } from './repository.js';
import { runConnectionSync } from './sync.js';
import type { SyncTrigger } from './types.js';

/**
 * Background sync.
 *
 *   telephony.sync-sweep       every 15 minutes, per organization with Call
 *                              Analytics enabled: syncs each live connection.
 *   telephony.sync-connection  one connection, now — after connecting and on
 *                              "Sync now". Keyed per request, so two clicks are
 *                              two runs, and the connection claim makes the
 *                              second wait for the first.
 *
 * A sync records its own failure on the connection and the run row, so both
 * jobs take one attempt: the next tick is the retry.
 */

export interface SyncConnectionPayload {
  readonly connectionId: string;
  readonly trigger: SyncTrigger;
  readonly requestedBy: string | null;
}

export const SYNC_INTERVAL_MS = 15 * 60 * 1000;

export let telephonySyncSweepJob: JobHandle<{ tick?: string }> | null = null;
export let telephonySyncConnectionJob: JobHandle<SyncConnectionPayload> | null = null;

export function registerTelephonyJobs(): void {
  telephonySyncSweepJob = defineJob<{ tick?: string }>({
    name: 'telephony.sync-sweep',
    perOrganization: true,
    module: 'telephony',
    schedule: { every: SYNC_INTERVAL_MS },
    attempts: 1,
    async handler({ ctx }) {
      for (const connectionId of await listSyncableConnectionIds(ctx)) {
        await runConnectionSync(ctx, connectionId, 'schedule', null);
      }
    },
  });

  telephonySyncConnectionJob = defineJob<SyncConnectionPayload>({
    name: 'telephony.sync-connection',
    perOrganization: true,
    attempts: 1,
    async handler({ ctx, payload }) {
      await runConnectionSync(ctx, payload.connectionId, payload.trigger, payload.requestedBy);
    },
  });
}

/**
 * Start a sync after the caller's transaction has committed (never inside
 * one). Without a running job queue — a single-process dev server without
 * Redis — the sync runs in this process instead of being lost.
 */
export async function requestSync(ctx: RequestContext, connectionId: string, trigger: SyncTrigger): Promise<'queued' | 'started'> {
  const payload: SyncConnectionPayload = { connectionId, trigger, requestedBy: ctx.principal.id };
  if (telephonySyncConnectionJob) {
    try {
      await telephonySyncConnectionJob.enqueue({
        organizationId: ctx.organizationId,
        key: `${connectionId}:${trigger}:${Date.now()}`,
        payload,
      });
      return 'queued';
    } catch (error) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'telephony sync could not be queued; running it in-process',
          connectionId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  void runConnectionSync(ctx, connectionId, trigger, ctx.principal.id).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'telephony in-process sync failed',
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  });
  return 'started';
}
