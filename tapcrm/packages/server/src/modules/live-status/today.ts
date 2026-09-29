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

  // No row yet → the person can only punch in.
  if (row === null) return { row: null, allowedMoves: ['in'] };

  // A stale open session AND the new day's opening window has begun:
  // D30's explicit two-button set, not the state machine's full menu.
  if (currentDay !== null && row.workDate < currentDay) {
    const nextWindow = await ShiftsFacade.dayWindow(tx, userId, currentDay);
    if (nextWindow.start <= now) {
      return { row, allowedMoves: ['scan', 'out', 'in'] };
    }
  }

  return { row, allowedMoves: allowedFromState(row.state) };
}
