import type { PresenceProjector } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import * as AttendanceFacade from '../attendance/facade.js';
import * as ShiftsFacade from '../shifts/facade.js';
import { LIVE_STATUS_EVENTS, type StatusChanged } from './events.js';
import * as repo from './repository.js';
import { deriveRow, type DerivedRow } from './state.js';

/**
 * The `PresenceProjector` port implementation (§9.3).
 *
 * Both entry points are keyed on the PERSON, not on a day (D9). Attendance
 * calls `apply(tx, userId, event)` from `appendEvent`; the projector
 * decides itself whether to shortcut or fall back to `refresh`.
 *
 * Reads:
 *  - `AttendanceFacade.currentDayFor` — the person's current day
 *  - `AttendanceFacade.loadDaySnapshot` — the day's record + effective
 *    events + overlays (stored snapshots ONLY)
 *  - `ShiftsFacade.shiftDays` — the next day's opening for
 *    `rollover_due_at` (`min(closing_cap, next_shift_start)`)
 *
 * Writes: `user_status` via `repo.upsertRow`, and a
 * `live-status.status-changed` outbox row naming the person; the handler
 * routes it on the person's placement at delivery (`jobs.ts`), so the
 * socket audience matches the HTTP board even after a transfer.
 */

async function rebuild(tx: Tx, userId: string, at: Date): Promise<DerivedRow | null> {
  const date = await AttendanceFacade.currentDayFor(tx, userId, at);
  if (date === null) return null; // person is between days with no open session
  const snapshot = await AttendanceFacade.loadDaySnapshot(tx, userId, date);
  if (snapshot === null) return null; // day-open has not landed yet

  const { record, events, overlays } = snapshot;
  const shiftSnapshot = record.shiftSnapshot as {
    start: string | null;
    end: string | null;
    isOvernight: boolean;
    graceMinutes: number | null;
  } | null;

  // Compose shift start/end instants from the snapshot (§8.1). A flexible
  // or no-shift day has null start/end; deriveRow handles nulls.
  const [days] = await Promise.all([
    // Ask shifts for this date + the next date so we get the next shift's start.
    ShiftsFacade.shiftDays(tx, userId, date, addDays(date, 1)),
  ]);
  const today = days.find((d) => d.window.date === date);
  const nextDay = days.find((d) => d.window.date === addDays(date, 1));
  const nextShiftStart = nextDay?.window.shape.start ?? null;

  const leaveOverlay = overlays.find((o) => o.kind.startsWith('leave-'));
  const dayGroup: 'leave' | 'holiday' | null =
    record.dayType === 'holiday' ? 'holiday' : leaveOverlay !== undefined ? 'leave' : null;
  const wfhOverlay = overlays.some((o) => o.kind === 'wfh');

  const shiftStartAt = today?.shift.kind === 'fixed' ? today.window.shape.start : null;
  const shiftEndAt = today?.shift.kind === 'fixed' ? today.window.shape.end : null;

  return deriveRow({
    workDate: date,
    events: events,
    window: {
      start: new Date(record.windowStart),
      end: new Date(record.windowEnd),
      eligibility:
        shiftSnapshot?.start != null && shiftSnapshot?.end != null
          ? {
              from: new Date(record.windowStart).toISOString(),
              to: new Date(record.closeDueAt).toISOString(),
            }
          : null,
    },
    shift: {
      startAt: shiftStartAt,
      endAt: shiftEndAt,
      graceMinutes: shiftSnapshot?.graceMinutes ?? null,
      flexibleTargetMinutes: null,
    },
    isWfh: wfhOverlay,
    dayGroup,
    closingCap: new Date(record.closeDueAt),
    nextShiftStart,
    now: at,
    lastScanDevice: null,
  });
}

// Small local re-export to avoid pulling addDays through the caller chain.
import { addDays } from '../../platform/time.js';

const projector: PresenceProjector<Tx> = {
  async apply(tx, userId, event) {
    // D9 condition 3: fast path only when the event stays on the row's
    // current day. Any other case rebuilds the row from scratch. For
    // this iteration, apply and refresh converge on `refresh` — a
    // targeted state-machine shortcut lands once correction / void /
    // re-attribution detection exists.
    await repo.lockRow(tx, userId);
    await refresh(tx, userId, new Date(event.at));
    // NOTE: With correction/void detection out of scope for this step,
    // we conservatively refresh in both cases. Once the "no correction /
    // void / re-attribution in play" check exists, the fast path here
    // shortcuts to `nextState(row.state, event.kind)` and a targeted
    // upsert without re-reading the day's events.
  },

  async refresh(tx, userId, at) {
    await refresh(tx, userId, at);
  },
};

async function refresh(tx: Tx, userId: string, at: Date): Promise<void> {
  const rebuilt = await rebuild(tx, userId, at);
  if (rebuilt === null) return; // no attendance_record yet
  const subject = await repo.currentRoutingSubject(tx, userId);
  if (subject === null) return; // person no longer in tenant
  await repo.upsertRow(tx, {
    ...rebuilt,
    organizationId: subject.organizationId,
    userId,
  });
  // LS-8: emit AFTER commit via the outbox. Rolled-back transactions
  // never publish. Only the person is recorded: the handler finds where
  // they sit when it delivers, which may be after a transfer.
  const payload: StatusChanged = { userId: subject.userId };
  await tx.query(sql`
    INSERT INTO domain_outbox (organization_id, event_name, payload)
    VALUES (${subject.organizationId}, ${LIVE_STATUS_EVENTS.STATUS_CHANGED},
            ${JSON.stringify(payload)}::jsonb)
  `);
}

export function registerLiveStatusProjector(): void {
  AttendanceFacade.registerPresenceProjector(projector);
}
