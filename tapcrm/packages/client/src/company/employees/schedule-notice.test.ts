import { describe, expect, it } from 'vitest';
import { missingScheduleNotice } from './schedule-notice.js';

describe('Add Employee schedule notice', () => {
  it('says nothing when a shift and a weekday schedule exist', () => {
    expect(missingScheduleNotice(2, 1)).toBeNull();
  });

  it('names what is missing before step 3', () => {
    expect(missingScheduleNotice(1, 0)).toBe(
      'Set up a weekday schedule (Weekday Schedules page) first. You can fill in the details now, but step 3 needs it before you can finish.',
    );
    expect(missingScheduleNotice(0, 0)).toContain(
      'a shift (Shifts page) and a weekday schedule (Weekday Schedules page)',
    );
    expect(missingScheduleNotice(0, 0)).toContain('needs both');
  });
});
