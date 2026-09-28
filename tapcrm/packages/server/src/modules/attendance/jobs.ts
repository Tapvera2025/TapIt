import type { DateOnly } from '@tapcrm/contracts';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { defineJob, type JobHandle } from '../../platform/jobs/runner.js';
import { onOutboxEvent, type OutboxEvent } from '../../platform/outbox/registry.js';
import { organizationToday } from '../../platform/organization-time.js';
import { addDays } from '../../platform/time.js';
import * as EmployeeFacade from '../employee/facade.js';
import * as CalendarFacade from '../holidays/facade.js';
import * as ShiftsFacade from '../shifts/facade.js';
import { openDaysForOrganization, openMissingDays } from './day-open.js';
import {
  ATTENDANCE_EVENTS,
  type ExportRequested,
  type RecalcRequested,
} from './events.js';
import { runExport } from './export.js';
import { applyCloseDecision } from './ledger.js';
import * as repo from './repository.js';
import {
  recalculateRecord,
  recalculationKey,
  recordRefresh,
  refreshKey,
  runRefreshRequest,
  sweepRefreshRequests,
  sweepStale,
  type AffectedScope,
} from './recalculate.js';

/**
 * Attendance's jobs and outbox handlers (design §5.4, §5.5, §8.5, §15).
 *
 *   attendance.recalculate     one record, keyed by record and input version
 *   attendance.refresh-days    one refresh request: a person's days after a shift or calendar change
 *   attendance.stale-sweeper   every five minutes, re-offers stale days and open refresh requests
 *
 * Nothing is queued inside a transaction (TX-2): each trigger writes an outbox
 * row, and the handlers below queue the job after it commits.
 */

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** The handles, for callers outside the schedule: tests, and an operator re-running a sweep. */
export interface AttendanceJobs {
  readonly recalculate: JobHandle<{ recordId: string }>;
  readonly refreshDays: JobHandle<{ requestId: string }>;
  readonly staleSweeper: JobHandle<undefined>;
  readonly dayOpen: JobHandle<undefined>;
  readonly export: JobHandle<{ requestId: string }>;
  readonly autoCloseItem: JobHandle<{ recordId: string; userId: string; workDate: DateOnly; inputVersion: number }>;
  readonly autoClose: JobHandle<undefined>;
}

export function registerAttendanceJobs(): AttendanceJobs {
  const recalculateJob = defineJob<{ recordId: string }>({
    name: 'attendance.recalculate',
    perOrganization: true,
    handler: async ({ ctx, payload }) => {
      const outcome = await db.transaction(ctx, (tx) =>
        recalculateRecord(tx, payload.recordId),
      );
      return { itemsProcessed: outcome === 'calculated' ? 1 : 0, details: { outcome } };
    },
  });

  const refreshDaysJob = defineJob<{ requestId: string }>({
    name: 'attendance.refresh-days',
    perOrganization: true,
    handler: async ({ ctx, payload }) => ({
      itemsProcessed: await runRefreshRequest(ctx, payload.requestId),
    }),
  });

  const staleSweeperJob = defineJob({
    name: 'attendance.stale-sweeper',
    perOrganization: true,
    module: 'attendance',
    schedule: { every: FIVE_MINUTES_MS },
    // The next tick is five minutes away; retrying sooner buys nothing.
    attempts: 1,
    handler: async ({ ctx, clock }) => {
      const now = clock.now();
      const days = await sweepStale(ctx, recalculateJob, now);
      const refreshes = await sweepRefreshRequests(ctx, refreshDaysJob, now);
      return {
        itemsProcessed: days.offered + refreshes.offered,
        details: { daysFlagged: days.flagged, refreshesFailed: refreshes.flagged },
      };
    },
  });

  // Idempotent: the job's key is the record and the input version, so a second
  // delivery, or a second request for the same version, is the same job (AT-I4).
  // An ordinary event: if its delivery is lost, the stale sweeper finds the day.
  onOutboxEvent(ATTENDANCE_EVENTS.RECALC_REQUESTED, async (event) => {
    const request = event.payload as RecalcRequested;
    await recalculateJob.enqueue({
      organizationId: event.organizationId,
      key: recalculationKey(request.recordId, request.inputVersion),
      payload: { recordId: request.recordId },
    });
  });

  /** Writes the change's refresh requests, then queues each one still open. */
  async function queueRefresh(
    event: OutboxEvent,
    scope: AffectedScope,
    from: DateOnly,
    to: DateOnly | null,
  ) {
    const ctx = createJobContext({
      organizationId: event.organizationId,
      principal: systemPrincipal(event.organizationId),
      jobName: refreshDaysJob.name,
      runId: event.id,
    });
    const requests = await db.transaction(ctx, (tx) =>
      recordRefresh(tx, event.organizationId, event.id, scope, from, to),
    );
    for (const request of requests) {
      await refreshDaysJob.enqueue({
        organizationId: event.organizationId,
        key: refreshKey(request),
        payload: { requestId: request.id },
      });
    }
  }

  // Idempotent: one request per event and person (a unique key), and each job
  // is keyed by its request. Retried until delivered: until its requests are
  // written, this event is the only record of the change, and nothing else
  // would notice it missing.
  onOutboxEvent(
    ShiftsFacade.SHIFT_EVENTS.DAYS_CHANGED,
    async (event) => {
      const change = event.payload as ShiftsFacade.DaysChanged;
      const scope: AffectedScope = {
        ...(change.userIds === undefined ? {} : { userIds: change.userIds }),
        ...(change.departmentId === undefined
          ? {}
          : { departmentIds: [change.departmentId] }),
        ...(change.shiftId === undefined ? {} : { shiftIds: [change.shiftId] }),
      };
      await queueRefresh(event, scope, change.from, change.to);
    },
    { retryUntilDelivered: true },
  );

  // As above. Holidays send an exclusive end; the refresh takes an inclusive
  // one (see holidays/events.ts).
  onOutboxEvent(
    CalendarFacade.HOLIDAY_EVENTS.DAYS_CHANGED,
    async (event) => {
      const change = event.payload as CalendarFacade.DaysChanged;
      const scope: AffectedScope = {
        ...(change.departmentIds === undefined
          ? {}
          : { departmentIds: change.departmentIds }),
        ...(change.shiftIds === undefined ? {} : { shiftIds: change.shiftIds }),
      };
      const to = change.toExclusive === null ? null : addDays(change.toExclusive, -1);
      await queueRefresh(event, scope, change.from, to);
    },
    { retryUntilDelivered: true },
  );

  // A joining or leaving date moved: the person's days in the range are
  // re-judged — a day outside the window becomes not-employed, one back
  // inside it is judged normally. Same path and guarantees as above.
  onOutboxEvent(
    EmployeeFacade.EMPLOYEE_EVENTS.EMPLOYMENT_CHANGED,
    async (event) => {
      const change = event.payload as EmployeeFacade.EmploymentChanged;
      await queueRefresh(event, { userIds: [change.userId] }, change.from, change.to);
    },
    { retryUntilDelivered: true },
  );

  /**
   * Day-open (§8.6): fires every hour, does work only when the organization's
   * today is beyond `materialised_through`. In-handler zone check because a
   * cron `tz` on the schedule is a single string; each organization has its
   * own timezone.
   */
  const dayOpenJob = defineJob({
    name: 'attendance.day-open',
    perOrganization: true,
    module: 'attendance',
    schedule: { pattern: '5 * * * *' }, // once per hour, at :05
    attempts: 1, // the next hour offers the same run; retries buy nothing
    handler: async ({ ctx, clock }) => {
      const { today, state } = await db.transaction(ctx, async (tx) => {
        await repo.ensureDayOpenStateRow(tx, ctx.organizationId);
        return {
          today: await organizationToday(tx, clock),
          state: await repo.readDayOpenState(tx, ctx.organizationId),
        };
      });
      if (state === null) return { itemsProcessed: 0 };
      // Caught up: only people who became employed today after the day opened.
      if (state.materialisedThrough >= today)
        return { itemsProcessed: await openMissingDays(ctx, today) };
      const startFrom = addDays(state.materialisedThrough, 1);
      const result = await openDaysForOrganization(ctx, startFrom, today);
      if ('skipped' in result)
        return { itemsProcessed: 0, details: { skipped: result.skipped } };
      return {
        itemsProcessed: 1,
        details: {
          materialisedThrough: result.materialisedThrough,
          firstFailedDate: result.firstFailedDate,
        },
      };
    },
  });

  const EXPORT_ATTEMPTS = 3;
  const exportJob = defineJob<{ requestId: string }>({
    name: 'attendance.export',
    perOrganization: true,
    attempts: EXPORT_ATTEMPTS,
    handler: async ({ ctx, payload, attempt }) => ({
      itemsProcessed: await runExport(ctx, payload.requestId, attempt >= EXPORT_ATTEMPTS),
    }),
  });

  // Idempotent: the job is keyed by the request. Retried until delivered: a
  // request whose job was never queued would stay "queued" for ever.
  onOutboxEvent(
    ATTENDANCE_EVENTS.EXPORT_REQUESTED,
    async (event) => {
      const { requestId } = event.payload as ExportRequested;
      await exportJob.enqueue({
        organizationId: event.organizationId,
        key: requestId,
        payload: { requestId },
      });
    },
    { retryUntilDelivered: true },
  );

  const AUTO_CLOSE_PAGE = 500;

  const autoCloseItemJob = defineJob<{ recordId: string; userId: string; workDate: DateOnly; inputVersion: number }>({
    name: 'attendance.auto-close-item',
    perOrganization: true,
    module: 'attendance',
    attempts: 3,
    handler: async ({ ctx, payload, clock }) => {
      await db.transaction(ctx, async (tx) => {
        await repo.lockPerson(tx, payload.userId);
        const record = await repo.findRecordForClosure(tx, payload.userId, payload.workDate);
        if (record === null) return;
        if (record.state === 'closed') return;
        if (record.id !== payload.recordId) return;
        if (record.inputVersion !== payload.inputVersion) return;
        if (record.closeDueAt > clock.now()) return;
        await applyCloseDecision(tx, payload.userId, payload.workDate, clock);
      });
      return { itemsProcessed: 1 };
    },
  });

  const autoCloseJob = defineJob({
    name: 'attendance.auto-close',
    perOrganization: true,
    module: 'attendance',
    schedule: { pattern: '30 * * * *' }, // at :30 every hour
    attempts: 1,
    handler: async ({ ctx, clock }) => {
      const now = clock.now();
      let after: { closeDueAt: Date; id: string } | null = null;
      let offered = 0;

      for (;;) {
        interface OfferRow { key: string; record: { id: string; userId: string; workDate: DateOnly; inputVersion: number } }
        const cursor = after;
        const offers: OfferRow[] = [];
        await db.transaction(ctx, async (tx) => {
          const rows = await repo.closeDueRecords(tx, now, cursor, AUTO_CLOSE_PAGE);
          for (const record of rows) {
            const baseKey = `auto-close:${record.id}:${record.inputVersion}`;
            const next = await autoCloseItemJob.nextGeneration(tx, baseKey, now);
            if (next.kind === 'exhausted') {
              await repo.upsertReviewItem(tx, ctx.organizationId, {
                userId: record.userId,
                workDate: record.workDate,
                kind: 'auto-close-failed',
                detail: { recordId: record.id, inputVersion: record.inputVersion, generations: 3 },
              });
            } else if (next.kind === 'run') {
              offers.push({ key: next.key, record });
            }
          }
          if (rows.length > 0) {
            const last = rows[rows.length - 1]!;
            after = { closeDueAt: last.closeDueAt, id: last.id };
          }
          if (rows.length < AUTO_CLOSE_PAGE) after = null; // sentinel: done
        });
        // Enqueue after commit (TX-2).
        for (const offer of offers) {
          await autoCloseItemJob.enqueue({
            organizationId: ctx.organizationId,
            key: offer.key,
            payload: {
              recordId: offer.record.id,
              userId: offer.record.userId,
              workDate: offer.record.workDate,
              inputVersion: offer.record.inputVersion,
            },
          });
          offered += 1;
        }
        if (after === null) break; // no more pages
      }
      return { itemsProcessed: offered };
    },
  });

  return {
    recalculate: recalculateJob,
    refreshDays: refreshDaysJob,
    staleSweeper: staleSweeperJob,
    dayOpen: dayOpenJob,
    export: exportJob,
    autoCloseItem: autoCloseItemJob,
    autoClose: autoCloseJob,
  };
}
