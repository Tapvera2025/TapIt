/**
 * Step 3 of Add Employee needs a shift and a weekday schedule. Say so up
 * front, before someone fills in two steps they cannot finish.
 */
export function missingScheduleNotice(
  shiftCount: number,
  weekdayScheduleCount: number,
): string | null {
  const missing = [
    ...(shiftCount === 0 ? ['a shift (Shifts page)'] : []),
    ...(weekdayScheduleCount === 0
      ? ['a weekday schedule (Weekday Schedules page)']
      : []),
  ];
  if (missing.length === 0) return null;
  return `Set up ${missing.join(' and ')} first. You can fill in the details now, but step 3 needs ${missing.length === 1 ? 'it' : 'both'} before you can finish.`;
}
