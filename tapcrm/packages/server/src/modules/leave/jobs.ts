import type { DateOnly } from '@tapcrm/contracts';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { defineJob } from '../../platform/jobs/runner.js';
import { organizationToday } from '../../platform/organization-time.js';
import { addDays } from '../../platform/time.js';
import * as CalendarFacade from '../holidays/facade.js';
import * as repo from './repository.js';
import { reconcileWfhForDate } from './service.js';

const ADVANCE_DAYS = 60;

/**
 * Testable inner function — accepts an injected `today` so the job test is
 * not tied to the wall clock and Dec-range fixtures are always within range.
 */
export async function advanceStandingWfhForDate(
  organizationId: string,
  today: DateOnly,
): Promise<void> {
  const ctx = createJobContext({
    organizationId,
    principal: systemPrincipal(organizationId),
    jobName: 'leave.standing-wfh-advance',
    runId: `manual:${today}`,
  });
  await db.transaction(ctx, async (tx) => {
    const horizon  = addDays(today, ADVANCE_DAYS);
    const requests = await repo.findActiveStandingWfhRequests(tx, today);

    for (const req of requests) {
      const start = req.fromDate > today ? req.fromDate : today;
      const end   = req.recurrenceEnd < horizon ? req.recurrenceEnd : horizon;
      if (start > end) continue;

      for (let date = start; date <= end; date = addDays(date, 1)) {
        const resolved = await CalendarFacade.dayType(tx, req.userId, date);
        if (resolved.type !== 'working') continue;
        await reconcileWfhForDate(tx, req.userId, date, organizationId);
      }
    }
  });
}

/** Production wrapper: resolves today per-org (T-2) then delegates. */
export async function advanceStandingWfh(organizationId: string): Promise<void> {
  const ctx = createJobContext({
    organizationId,
    principal: systemPrincipal(organizationId),
    jobName: 'leave.standing-wfh-advance',
    runId: 'scheduled',
  });
  const today = await db.transaction(ctx, (tx) => organizationToday(tx));
  await advanceStandingWfhForDate(organizationId, today);
}

export function registerLeaveJobs(): void {
  defineJob({
    name: 'leave.standing-wfh-advance',
    perOrganization: true,
    module: 'leave',
    schedule: { pattern: '0 1 * * *' },
    attempts: 1,
    handler: async ({ ctx, clock }) => {
      const today = await db.transaction(ctx, (tx) => organizationToday(tx, clock));
      await advanceStandingWfhForDate(ctx.organizationId, today);
      return { itemsProcessed: 1 };
    },
  });
}
