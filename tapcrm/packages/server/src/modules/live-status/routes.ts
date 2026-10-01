import { z } from 'zod';
import { visibilityFilter } from '@tapcrm/authz';
import { db } from '../../platform/dal/db.js';
import { route } from '../../platform/http/route.js';
import { systemClock } from '../../platform/time.js';
import * as repo from './repository.js';
import { liveBoardGroup, type LiveBoardGroup } from './group.js';
import { loadToday } from './today.js';
import { punch } from './punch-route.js';

/**
 * Live-status HTTP: one endpoint, two shapes.
 *
 *   GET /api/attendance/live          → the board (scope-filtered)
 *   GET /api/attendance/live?self=true → the caller's own row + allowedMoves
 *
 * The board goes through the `userStatus` policy filter; `?self=true`
 * is exactly the caller and needs no filter — it always answers for the
 * request's principal.
 */

const querySchema = z
  .object({ self: z.enum(['true', 'false']).optional() })
  .transform((q) => ({ self: q.self === 'true' }));

export function registerLiveStatusRoutes(): void {
  // G1: an employee's own punch — in, out, break start and break end.
  route({
    method: 'POST',
    path: '/api/status/punch',
    action: 'status:punch',
    module: 'live-status',
    status: 200,
    handler: async ({ ctx, body }) => punch(ctx, body),
  });

  route({
    method: 'GET',
    path: '/api/attendance/live',
    action: 'attendance:view-live',
    module: 'live-status',
    handler: async ({ ctx, query }) => {
      const { self } = querySchema.parse(query);
      if (self) {
        // Own view — `/today`. Always for the caller, no scope filter.
        return db.transaction(ctx, async (tx) => {
          const now = systemClock.now();
          const { row, allowedMoves } = await loadToday(tx, ctx.principal.id, now);
          return { row, allowedMoves };
        });
      }
      // Board — scope-filtered by the `userStatus` policy.
      const visibility = await visibilityFilter(ctx, 'attendance:view-live', 'userStatus');
      return db.transaction(ctx, async (tx) => {
        const now = systemClock.now();
        const rows = await repo.listBoard(tx, visibility);
        const groupedRows = rows.map((row) => ({ ...row, displayGroup: liveBoardGroup(row, now) }));
        const groups: Record<LiveBoardGroup, number> = {
          working: 0,
          possiblyFinished: 0,
          onBreak: 0,
          finished: 0,
          notInDue: 0,
          notInNotYetDue: 0,
          onLeave: 0,
          onHoliday: 0,
        };
        for (const row of groupedRows) groups[row.displayGroup] += 1;
        return {
          rows: groupedRows,
          asOf: now,
          groups,
        };
      });
    },
  });
}
