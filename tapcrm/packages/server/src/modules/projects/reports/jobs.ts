import { defineJob, type JobHandle } from '../../../platform/jobs/runner.js';
import { googleAuthConfigured } from '../../../platform/integrations/google/token.js';
import { toDateOnly } from '../../../platform/time.js';
import { projectsDueForFetch } from './repository.js';
import { observationWindow, syncProjectRanks } from './sync.js';

/**
 * Automatic keyword rank fetching (TECH.md §11).
 *
 *   projects.seo-rank-sweep   daily, per organization — finds the projects with
 *                             keywords due and offers one job each
 *   projects.seo-rank-fetch   one project's fetch, keyed by project and window
 *
 * JB-1: the fetch job's key is `project:windowEnd`, and the observation it
 * writes is unique on the same pair, so a redelivery refreshes that row rather
 * than appending a second one or shifting the rolling rank slots twice.
 *
 * JB-4: a transient Search Console failure throws, so the runner retries with
 * backoff and eventually dead-letters with an alert. A credential or
 * permission failure does NOT throw — it would fail identically on every
 * attempt, so it is recorded against the project for the user to see and fix.
 */

interface FetchPayload {
  readonly projectId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
}

export interface ProjectReportJobs {
  readonly sweep: JobHandle<undefined>;
  readonly fetch: JobHandle<FetchPayload>;
}

export function registerProjectReportJobs(): ProjectReportJobs {
  const fetchJob = defineJob<FetchPayload>({
    name: 'projects.seo-rank-fetch',
    perOrganization: true,
    module: 'projects',
    attempts: 3,
    // Search Console rate-limits per property; a minute is long enough for a
    // quota window to move and short enough to finish inside the day.
    backoffMs: 60_000,
    handler: async ({ ctx, payload }) => {
      const outcome = await syncProjectRanks(ctx, payload.projectId, {
        window: { start: toDateOnly(payload.windowStart), end: toDateOnly(payload.windowEnd) },
        scope: 'due',
      });
      return {
        itemsProcessed: outcome.fetched,
        details: {
          projectId: payload.projectId,
          status: outcome.status,
          unavailable: outcome.unavailable,
          skipped: outcome.skipped,
          ...(outcome.message === null ? {} : { message: outcome.message }),
        },
      };
    },
  });

  const sweepJob = defineJob({
    name: 'projects.seo-rank-sweep',
    perOrganization: true,
    module: 'projects',
    // Early morning. The window already lags by days, so the exact hour is not
    // load-bearing.
    schedule: { pattern: '20 4 * * *' },
    // The next tick offers the same work; retrying the sweep buys nothing.
    attempts: 1,
    handler: async ({ ctx, clock }) => {
      // Registered unconditionally so the schedule exists and the job history
      // stays continuous, but it does nothing without credentials.
      if (!googleAuthConfigured()) return { itemsProcessed: 0, details: { skipped: 'google-search-console-off' } };

      const window = await observationWindow(ctx, clock);
      const projectIds = await projectsDueForFetch(ctx);
      // Enqueued outside any transaction (TX-2); each key is idempotent.
      for (const projectId of projectIds) {
        await fetchJob.enqueue({
          organizationId: ctx.organizationId,
          key: `${projectId}:${window.end}`,
          payload: { projectId, windowStart: window.start, windowEnd: window.end },
        });
      }
      return { itemsProcessed: projectIds.length, details: { windowStart: window.start, windowEnd: window.end } };
    },
  });

  return { sweep: sweepJob, fetch: fetchJob };
}
