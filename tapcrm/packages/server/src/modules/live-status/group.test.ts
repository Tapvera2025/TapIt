import { describe, expect, it } from 'vitest';
import { liveBoardGroup } from './group.js';

const now = new Date('2026-09-29T10:00:00.000Z');
const row = {
  dayGroup: null,
  state: 'NOT_IN' as const,
  likelyFinishedAt: null,
  shiftStartAt: new Date('2026-09-29T09:45:00.000Z'),
  graceMinutes: 15,
};

describe('liveBoardGroup', () => {
  it('uses the grace boundary and keeps a row in one group', () => {
    expect(liveBoardGroup(row, new Date('2026-09-29T09:59:59.000Z'))).toBe('notInNotYetDue');
    expect(liveBoardGroup(row, now)).toBe('notInDue');
    expect(liveBoardGroup({ ...row, dayGroup: 'leave' }, now)).toBe('onLeave');
    expect(liveBoardGroup({ ...row, dayGroup: 'holiday' }, now)).toBe('onHoliday');
  });

  it('separates likely finished from confirmed departure', () => {
    expect(liveBoardGroup({ ...row, state: 'WORKING', likelyFinishedAt: now }, now)).toBe('possiblyFinished');
    expect(liveBoardGroup({ ...row, state: 'FINISHED', likelyFinishedAt: now }, now)).toBe('finished');
    expect(liveBoardGroup({ ...row, state: 'ON_BREAK' }, now)).toBe('onBreak');
  });
});
