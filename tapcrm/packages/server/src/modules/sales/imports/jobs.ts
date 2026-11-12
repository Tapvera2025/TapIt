import type { RequestContext } from '../../../platform/dal/context.js';
import { defineJob, type JobHandle } from '../../../platform/jobs/runner.js';
import { runImport, stalledImportIds } from './process.js';

/**
 * Background import.
 *
 *   sales.lead-import.process       one import, queued when it is started.
 *   sales.lead-import.resume-sweep  every 5 minutes: picks up an import whose
 *                                   worker stopped (a deploy, a crash) and
 *                                   carries on from the rows it had not reached.
 *
 * The import claims itself (lead_import.status + heartbeat), so a duplicate
 * job for the same import finds it busy and leaves it alone.
 */

export interface ImportJobPayload {
  readonly importId: string;
}

export let leadImportJob: JobHandle<ImportJobPayload> | null = null;

export function registerLeadImportJobs(): void {
  leadImportJob = defineJob<ImportJobPayload>({
    name: 'sales.lead-import.process',
    perOrganization: true,
    // A failure is recorded on the import, which the person can resume.
    attempts: 1,
    async handler({ ctx, payload, key }) {
      await runImport(ctx, payload.importId, key);
    },
  });

  defineJob<{ tick?: string }>({
    name: 'sales.lead-import.resume-sweep',
    perOrganization: true,
    module: 'lead-imports',
    schedule: { every: 5 * 60 * 1000 },
    attempts: 1,
    async handler({ ctx, key }) {
      for (const importId of await stalledImportIds(ctx)) {
        await runImport(ctx, importId, `${key}:${importId}`);
      }
    },
  });
}

/**
 * Start an import after the caller's transaction has committed. Without a
 * running job queue (a single-process dev server without Redis) it runs in
 * this process instead of waiting for the sweep.
 */
export async function requestImportRun(ctx: RequestContext, importId: string): Promise<'queued' | 'started'> {
  if (leadImportJob) {
    try {
      await leadImportJob.enqueue({ organizationId: ctx.organizationId, key: `${importId}:${Date.now()}`, payload: { importId } });
      return 'queued';
    } catch (error) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'lead import could not be queued; running it in-process',
          importId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  void runImport(ctx, importId, `inline:${Date.now()}`).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'lead import failed',
        importId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  });
  return 'started';
}
