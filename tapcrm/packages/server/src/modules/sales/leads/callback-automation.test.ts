import { describe, expect, it } from 'vitest';
import { reminderAt, reminderToSend, selectSalesSupervisor } from './callback-automation.js';

describe('callback reminder timing', () => {
  it('generates the three reminder instants from the persisted callback instant', () => {
    const callback = new Date('2026-09-29T05:30:00.000Z');
    expect(reminderAt(callback, 60).toISOString()).toBe('2026-09-29T04:30:00.000Z');
    expect(reminderAt(callback, 15).toISOString()).toBe('2026-09-29T05:15:00.000Z');
    expect(reminderAt(callback, 0).toISOString()).toBe('2026-09-29T05:30:00.000Z');
  });
});

describe('which callback reminder to send', () => {
  const callback = new Date('2026-09-29T05:30:00.000Z');
  const bookedTheDayBefore = new Date('2026-09-28T10:00:00.000Z');
  const at = (iso: string) => new Date(iso);

  it('sends each reminder in turn for a callback booked well ahead', () => {
    expect(reminderToSend(callback, bookedTheDayBefore, at('2026-09-29T04:00:00.000Z'))).toBeNull();
    expect(reminderToSend(callback, bookedTheDayBefore, at('2026-09-29T04:30:30.000Z'))?.type).toBe('t_minus_60');
    expect(reminderToSend(callback, bookedTheDayBefore, at('2026-09-29T05:15:10.000Z'))?.type).toBe('t_minus_15');
    expect(reminderToSend(callback, bookedTheDayBefore, at('2026-09-29T05:30:05.000Z'))?.type).toBe('due');
  });

  it('sends only the latest one when several came due together', () => {
    const late = reminderToSend(callback, bookedTheDayBefore, at('2026-09-29T05:40:00.000Z'));
    expect(late).toEqual({ type: 'due', at: callback });
  });

  it('skips advance reminders whose time had passed when the callback was booked', () => {
    const bookedTenMinutesAhead = at('2026-09-29T05:20:00.000Z');
    expect(reminderToSend(callback, bookedTenMinutesAhead, at('2026-09-29T05:21:00.000Z'))).toBeNull();
    expect(reminderToSend(callback, bookedTenMinutesAhead, at('2026-09-29T05:30:00.000Z'))?.type).toBe('due');
    const bookedFortyMinutesAhead = at('2026-09-29T04:50:00.000Z');
    expect(reminderToSend(callback, bookedFortyMinutesAhead, at('2026-09-29T04:51:00.000Z'))).toBeNull();
    expect(reminderToSend(callback, bookedFortyMinutesAhead, at('2026-09-29T05:15:00.000Z'))?.type).toBe('t_minus_15');
  });

  it('still says "call now" for a callback booked a moment in the past', () => {
    const bookedJustAfter = at('2026-09-29T05:30:20.000Z');
    expect(reminderToSend(callback, bookedJustAfter, at('2026-09-29T05:31:00.000Z'))?.type).toBe('due');
  });
});

describe('missed callback supervisory routing', () => {
  it('selects the nearest eligible Sales supervisor or team lead, not an arbitrary manager', () => {
    expect(selectSalesSupervisor([
      { id: 'manager', positionCode: 'engineering-manager', depth: 1 },
      { id: 'team-lead', positionCode: 'sales-team-lead', depth: 2 },
      { id: 'supervisor', positionCode: 'sales-supervisor', depth: 3 },
    ])).toBe('team-lead');
    expect(selectSalesSupervisor([])).toBeNull();
  });

  it('routes callbacks owned by Sales leadership to the next eligible Sales supervisor', () => {
    expect(selectSalesSupervisor([{ id: 'supervisor', positionCode: 'sales-supervisor', depth: 1 }])).toBe('supervisor');
    expect(selectSalesSupervisor([{ id: 'team-lead', positionCode: 'sales-team-lead', depth: 1 }, { id: 'supervisor', positionCode: 'sales-supervisor', depth: 2 }])).toBe('team-lead');
  });
});
