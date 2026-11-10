import { describe, expect, it } from 'vitest';
import { dayKey, describeHistory, groupSlotsByDay, joinableNow } from './format.js';

const IST = 'Asia/Kolkata';

describe('meeting formatting', () => {
  it('groups free times by the local day', () => {
    const days = groupSlotsByDay([
      { startsAt: '2026-11-09T18:00:00Z', endsAt: '2026-11-09T18:30:00Z' }, // 11:30 pm Mon in IST
      { startsAt: '2026-11-09T18:45:00Z', endsAt: '2026-11-09T19:15:00Z' }, // 12:15 am Tue in IST
      { startsAt: '2026-11-10T04:30:00Z', endsAt: '2026-11-10T05:00:00Z' },
    ], IST);
    expect(days.map((day) => [day.key, day.slots.length])).toEqual([['2026-11-09', 1], ['2026-11-10', 2]]);
    expect(dayKey('2026-11-09T18:45:00Z', IST)).toBe('2026-11-10');
  });

  it('describes each step of a meeting in plain words', () => {
    const base = { actorKind: 'staff' as const, actorName: 'Priya', at: '2026-11-08T05:00:00Z' };
    expect(describeHistory({ ...base, actorKind: 'client', actorName: 'Riya', event: 'requested', detail: { startsAt: '2026-11-10T05:30:00Z', askedFor: 'anyone' } }, IST))
      .toBe('Riya asked for a meeting on Tue, 10 Nov, 11:00 am with anyone on the team');
    expect(describeHistory({ ...base, event: 'declined', detail: { reason: 'On leave that week', onBehalfOf: 'Arjun' } }, IST))
      .toBe('Priya declined for Arjun: On leave that week');
    expect(describeHistory({ ...base, event: 'proposed', detail: { from: 'confirmed', times: ['2026-11-11T05:30:00Z'], note: null } }, IST))
      .toBe('Priya moved it and offered Wed, 11 Nov, 11:00 am');
    expect(describeHistory({ ...base, actorKind: 'system', actorName: null, event: 'expired', detail: { from: 'requested' } }, IST))
      .toBe('Lapsed: nobody answered in time');
  });

  it('opens the join button from 15 minutes before until the end', () => {
    const startsAt = '2026-11-10T05:30:00Z';
    const endsAt = '2026-11-10T06:00:00Z';
    expect(joinableNow(startsAt, endsAt, Date.parse('2026-11-10T05:10:00Z'))).toBe(false);
    expect(joinableNow(startsAt, endsAt, Date.parse('2026-11-10T05:16:00Z'))).toBe(true);
    expect(joinableNow(startsAt, endsAt, Date.parse('2026-11-10T06:01:00Z'))).toBe(false);
  });
});
