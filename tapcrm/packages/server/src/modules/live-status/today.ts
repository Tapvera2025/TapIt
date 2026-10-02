import type { EventKind } from '@tapcrm/contracts';
import { allowedMoves as allowedFromState } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import * as AttendanceFacade from '../attendance/facade.js';
import * as ShiftsFacade from '../shifts/facade.js';
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
export async function loadToday(
  tx: Tx,
  userId: string,
  now: Date,
): Promise<{ row: repo.Row | null; allowedMoves: readonly EventKind[] }> {
  const row = await repo.readRow(tx, userId);
  const currentDay = await AttendanceFacade.currentDayFor(tx, userId, now);

  // No row yet → only allow punch in if the employee has a shift today.
  if (row === null) {
    const todayWindow = await ShiftsFacade.dayWindowContaining(tx, userId, now);
    const shift = await ShiftsFacade.resolve(tx, userId, todayWindow.date);
    return { row: null, allowedMoves: shift.kind !== 'none' ? ['in'] : [] };
  }

  // A stale open session AND the new day's opening window has begun:
  // D30's explicit two-button set, not the state machine's full menu.
  if (currentDay !== null && row.workDate < currentDay) {
    const nextWindow = await ShiftsFacade.dayWindow(tx, userId, currentDay);
    if (nextWindow.start <= now) {
      const nextShift = await ShiftsFacade.resolve(tx, userId, currentDay);
      return { row, allowedMoves: nextShift.kind !== 'none' ? ['scan', 'out', 'in'] : ['scan', 'out'] };
    }
  }

  const moves = allowedFromState(row.state);
  // Post-rollover NOT_IN state: block punch-in if no shift is assigned today.
  if (moves.includes('in')) {
    const todayWindow = await ShiftsFacade.dayWindowContaining(tx, userId, now);
    const shift = await ShiftsFacade.resolve(tx, userId, todayWindow.date);
    if (shift.kind === 'none') {
      return { row, allowedMoves: moves.filter((m) => m !== 'in' && m !== 'scan') };
    }
  }
  return { row, allowedMoves: moves };
}
