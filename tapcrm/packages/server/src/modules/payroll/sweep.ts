import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { DateOnly } from '@tapcrm/contracts';
import * as AttFacade from '../attendance/facade.js';
import * as BreakFacade from '../break-management/facade.js';
import { openDrift, openFlag, latestPublishedSlip } from './flags.js';

/**
 * Published-period reconciliation sweep.
 * Scans published runs within a bounded window and opens drifts/flags for
 * population changes and blockers found by the facade queries.
 */
export async function sweepPublishedPeriods(
  ctx: RequestContext,
): Promise<{ scanned: number; opened: number }> {
  return db.transaction(ctx, async (tx) => {
    // Find published runs in the last 6 months
    const runs = await tx.query<{ id: string; periodStart: string; periodEnd: string }>(sql`
      SELECT id, period_start::text AS "periodStart", period_end::text AS "periodEnd"
      FROM payroll_run
      WHERE organization_id = ${ctx.organizationId}
        AND status = 'published'
        AND period_start >= (now() - INTERVAL '6 months')::date
      ORDER BY period_start DESC
      LIMIT 20
    `);

    let opened = 0;
    for (const run of runs) {
      // Get all employees in this run's snapshot
      const employees = await tx.query<{ userId: string }>(sql`
        SELECT user_id AS "userId" FROM payroll_run_employee
        WHERE organization_id = ${ctx.organizationId} AND run_id = ${run.id}::uuid
      `);
      const frozenUserIds = employees.map(e => e.userId);
      if (frozenUserIds.length === 0) continue;

      // Check for attendance open items
      const openItems = await AttFacade.openItems(
        tx,
        frozenUserIds as unknown as string[],
        run.periodStart as DateOnly,
        run.periodEnd as DateOnly,
      );

      // Check for unresolved break breaches
      const unresolvedBreaches = await BreakFacade.unresolvedBreaches(
        tx,
        frozenUserIds,
        run.periodStart as DateOnly,
        run.periodEnd as DateOnly,
      );

      // Normalize open items to a common blocker shape
      interface BlockerItem {
        userId: string;
        kind: string;
        sourceId: string;
      }

      const blockers: BlockerItem[] = [
        ...openItems.map(item => ({
          userId: item.userId,
          kind: item.kind,
          sourceId: item.sourceId ?? item.kind,
        })),
        ...unresolvedBreaches.map(b => ({
          userId: b.userId,
          kind: `break:${b.kind}`,
          sourceId: b.id,
        })),
      ];

      for (const blocker of blockers) {
        const slip = await latestPublishedSlip(tx, ctx.organizationId, blocker.userId, run.periodStart);
        if (slip) {
          await openFlag(
            tx,
            ctx.organizationId,
            slip.id,
            blocker.kind,
            blocker.sourceId,
            'blocker',
          );
          opened++;
        } else {
          // No slip yet — open a drift on the run
          const drift = await openDrift(tx, ctx.organizationId, {
            runId: run.id,
            userId: blocker.userId,
            kind: 'blocker',
            sourceType: blocker.kind,
            sourceId: blocker.sourceId,
          });
          if (drift) opened++;
        }
      }
    }

    return { scanned: runs.length, opened };
  });
}
