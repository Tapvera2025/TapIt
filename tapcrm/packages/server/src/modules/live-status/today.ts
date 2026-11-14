import type { DateOnly, EventKind } from '@tapcrm/contracts';
import { allowedMoves as allowedFromState } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import * as AttendanceFacade from '../attendance/facade.js';
import * as ShiftsFacade from '../shifts/facade.js';
import { leaveBlocksPunchIn } from './leave-punch.js';
import * as repo from './repository.js';

/**
 * D30 — "A night that was never closed does not block the morning." When
 * the caller's previous session is still open AND the next shift's opening
 * window has begun, offer ONLY the stale-session action set: `scan` and
 * `out` (to close yesterday's shift now — the departure will be flagged
 * unconfirmed for review) plus `in` (to start today's shift).
 *
 * Deliberately not `[break-start, scan, out, in]`: opening a break on
 * yesterday's forgotten session while today's shift is beginning would
 * file the break on the OLD day (attribution rule 3), and is a
 * user-error waiting to happen. §9.2's "Punch out" example is exactly
 * this: give two clear buttons, not four confusing ones.
 */
/**
 * Explains why the UI should not offer a Punch In button. `null` means
 * either `in` is allowed, or the UI already shows an active session and
 * the absence of `in` from `allowedMoves` is self-explanatory.
 */
export type PunchDisabledReason =
  | 'no-shift-today'
  | 'already-finished'
  | 'on-approved-leave';

export async function loadToday(
  tx: Tx,
  userId: string,
  now: Date,
): Promise<{
  row: repo.Row | null;
  allowedMoves: readonly EventKind[];
  disabledReason: PunchDisabledReason | null;
}> {
  // A live read is also a safe recovery point for a delayed auto-close job.
  // Reuse attendance's idempotent closure decision, then refresh the live
  // projection only when the row is overdue or its next rollover is due.
  const overdue = await AttendanceFacade.reconcileOverdueForUser(tx, userId, now);
  let row = await repo.readRow(tx, userId);
  if (row !== null && (overdue.length > 0 || row.rolloverDueAt <= now)) {
    const projector = AttendanceFacade.presenceProjector();
    if (projector !== null) await projector.refresh(tx, userId, now);
    row = await repo.readRow(tx, userId);
  }
  const currentDay = await AttendanceFacade.currentDayFor(tx, userId, now);

  async function reasonForNoIn(workDate: DateOnly): Promise<PunchDisabledReason | null> {
    const shift = await ShiftsFacade.resolve(tx, userId, workDate);
    if (shift.kind === 'none') return 'no-shift-today';
    const overlays = await AttendanceFacade.overlaysForDay(tx, userId, workDate);
    if (leaveBlocksPunchIn(overlays)) return 'on-approved-leave';
    return null;
  }

  // No row yet → only allow punch in if the employee has a shift today.
  if (row === null) {
    const todayWindow = await ShiftsFacade.dayWindowContaining(tx, userId, now);
    const shift = await ShiftsFacade.resolve(tx, userId, todayWindow.date);
    if (shift.kind !== 'none') {
      const overlays = await AttendanceFacade.overlaysForDay(tx, userId, todayWindow.date);
      if (leaveBlocksPunchIn(overlays)) {
        return { row: null, allowedMoves: [], disabledReason: 'on-approved-leave' };
      }
      return { row: null, allowedMoves: ['in'], disabledReason: null };
    }
    return { row: null, allowedMoves: [], disabledReason: 'no-shift-today' };
  }

  // Once a previous day has been auto-closed, the attendance ledger is
  // finished even though currentDayFor intentionally ignores system
  // auto-outs for event attribution. Do not expose the old day's Punch Out;
  // resolve today's shift and offer only today's Punch In.
  if (row.state === 'FINISHED' && currentDay !== null) {
    const todayWindow = await ShiftsFacade.dayWindowContaining(tx, userId, now);
    if (row.workDate < todayWindow.date) {
      const todayShift = await ShiftsFacade.resolve(tx, userId, todayWindow.date);
      if (todayShift.kind !== 'none') {
        const overlays = await AttendanceFacade.overlaysForDay(tx, userId, todayWindow.date);
        if (leaveBlocksPunchIn(overlays)) {
          return { row, allowedMoves: [], disabledReason: 'on-approved-leave' };
        }
        return { row, allowedMoves: ['in'], disabledReason: null };
      }
      return { row, allowedMoves: [], disabledReason: 'no-shift-today' };
    }
  }

  // A stale open session AND the new day's opening window has begun:
  // D30's explicit two-button set, not the state machine's full menu.
  if (currentDay !== null && row.workDate < currentDay) {
    const nextWindow = await ShiftsFacade.dayWindow(tx, userId, currentDay);
    if (nextWindow.start <= now) {
      const nextShift = await ShiftsFacade.resolve(tx, userId, currentDay);
      return {
        row,
        allowedMoves: nextShift.kind !== 'none' ? ['scan', 'out', 'in'] : ['scan', 'out'],
        disabledReason: nextShift.kind === 'none' ? 'no-shift-today' : null,
      };
    }
  }

  const moves = allowedFromState(row.state);
  // Post-rollover NOT_IN state: block punch-in if no shift is assigned today.
  if (moves.includes('in')) {
    const todayWindow = await ShiftsFacade.dayWindowContaining(tx, userId, now);
    const reason = await reasonForNoIn(todayWindow.date);
    if (reason !== null) {
      return { row, allowedMoves: moves.filter((m) => m !== 'in' && m !== 'scan'), disabledReason: reason };
    }
  }
  // Finished today's shift and the day hasn't rolled over yet.
  if (row.state === 'FINISHED' && !moves.includes('in')) {
    return { row, allowedMoves: moves, disabledReason: 'already-finished' };
  }
  return { row, allowedMoves: moves, disabledReason: null };
}
