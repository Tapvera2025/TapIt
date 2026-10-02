import type { BoardRow } from './repository.js';

export type LiveBoardGroup =
  | 'working'
  | 'possiblyFinished'
  | 'onBreak'
  | 'finished'
  | 'notInDue'
  | 'notInNotYetDue'
  | 'onLeave'
  | 'onHoliday';

/** Each visible person has one group, so the summary and row filter agree. */
export function liveBoardGroup(
  row: Pick<BoardRow, 'dayGroup' | 'state' | 'likelyFinishedAt' | 'shiftStartAt' | 'graceMinutes'>,
  now: Date,
): LiveBoardGroup {
  if (row.dayGroup === 'leave') return 'onLeave';
  if (row.dayGroup === 'holiday') return 'onHoliday';
  if (row.state === 'ON_BREAK') return 'onBreak';
  if (row.state === 'FINISHED') return 'finished';
  if (row.state === 'WORKING') {
    return row.likelyFinishedAt !== null && row.likelyFinishedAt <= now
      ? 'possiblyFinished'
      : 'working';
  }
  return row.shiftStartAt !== null &&
    new Date(row.shiftStartAt.getTime() + (row.graceMinutes ?? 0) * 60_000) <= now
    ? 'notInDue'
    : 'notInNotYetDue';
}
