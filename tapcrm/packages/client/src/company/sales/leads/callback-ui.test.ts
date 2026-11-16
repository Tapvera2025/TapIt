import { describe, expect, it } from 'vitest';
import {
  anHourLater,
  callbackOwnerOptions,
  callbacksByDay,
  callbackStatusLabel,
  filterCallbacks,
  isOverdueCallback,
  monthGrid,
  organizationDayKey,
  organizationLocalToIso,
  organizationNowLocal,
  sentenceLabel,
  shiftMonth,
  sortCallbacks,
} from './callback-ui.js';

describe('callback organization timezone conversion', () => {
  it('converts organization-local handover callback time to an instant', () => {
    expect(organizationLocalToIso('2026-09-29T11:00', 'Asia/Kolkata')).toBe('2026-09-29T05:30:00.000Z');
  });

  it('gives the current organization-local time for the earliest bookable slot', () => {
    expect(organizationNowLocal('Asia/Kolkata', new Date('2026-11-03T05:00:30Z'))).toBe('2026-11-03T10:30');
  });
});

describe('quick reschedule', () => {
  const now = new Date('2026-11-03T05:00:00Z');

  it('moves a future callback an hour later', () => {
    expect(anHourLater('2026-11-03T08:00:00.000Z', now)).toBe('2026-11-03T09:00:00.000Z');
  });

  it('moves an overdue callback to an hour from now, not into the past', () => {
    expect(anHourLater('2026-11-03T02:00:00.000Z', now)).toBe('2026-11-03T06:00:00.000Z');
  });
});

describe('callback filters', () => {
  const callbacks = [
    {
      id: 'a',
      ownerId: 'u2',
      ownerName: 'Ravi',
      leadNumber: '154',
      leadContactName: 'Asha Mehta',
    },
    {
      id: 'b',
      ownerId: 'u1',
      ownerName: 'Neha',
      leadNumber: '155',
      leadContactName: 'Rohit Shah',
    },
    {
      id: 'c',
      ownerId: 'u2',
      ownerName: 'Ravi',
      leadNumber: '1540',
      leadContactName: 'Kiran Rao',
    },
  ];

  it('lists each owner once, by name', () => {
    expect(callbackOwnerOptions(callbacks)).toEqual([
      { value: 'u1', label: 'Neha' },
      { value: 'u2', label: 'Ravi' },
    ]);
  });

  it('keeps owners already offered when other filters hide their callbacks', () => {
    const [, neha] = callbacks;
    expect(
      callbackOwnerOptions(neha ? [neha] : [], [{ value: 'u2', label: 'Ravi' }]),
    ).toEqual([
      { value: 'u1', label: 'Neha' },
      { value: 'u2', label: 'Ravi' },
    ]);
  });

  it('finds callbacks by owner, lead name or lead number', () => {
    expect(filterCallbacks(callbacks, 'u2', '').map((c) => c.id)).toEqual(['a', 'c']);
    expect(filterCallbacks(callbacks, '', 'mehta').map((c) => c.id)).toEqual(['a']);
    expect(filterCallbacks(callbacks, '', '#154').map((c) => c.id)).toEqual(['a']);
    expect(filterCallbacks(callbacks, 'u1', 'asha')).toEqual([]);
  });

  it('labels statuses and outcomes in plain words', () => {
    expect(callbackStatusLabel('not_reachable')).toBe('Not reachable');
    expect(callbackStatusLabel('pending')).toBe('Pending');
    expect(sentenceLabel('follow_up_required')).toBe('Follow up required');
  });
});

describe('callback order', () => {
  const callbacks = [
    { id: 'a', scheduledAt: '2026-11-10T05:00:00.000Z', createdAt: '2026-11-09T05:00:00.000Z' },
    { id: 'b', scheduledAt: '2026-11-20T05:00:00.000Z', createdAt: '2026-11-01T05:00:00.000Z' },
    { id: 'c', scheduledAt: '2026-11-14T05:00:00.000Z', createdAt: '2026-11-13T05:00:00.000Z' },
  ];

  it('puts the callback booked most recently at the top by default', () => {
    expect(sortCallbacks(callbacks).map((callback) => callback.id)).toEqual(['c', 'a', 'b']);
  });

  it('can order by the callback time either way', () => {
    expect(sortCallbacks(callbacks, 'latest_time').map((callback) => callback.id)).toEqual(['b', 'c', 'a']);
    expect(sortCallbacks(callbacks, 'soonest_time').map((callback) => callback.id)).toEqual(['a', 'c', 'b']);
  });

  it('falls back to the callback time when the booking time is missing', () => {
    const undated = callbacks.map(({ id, scheduledAt }) => ({ id, scheduledAt }));
    expect(sortCallbacks(undated).map((callback) => callback.id)).toEqual(['b', 'c', 'a']);
  });

  it('does not reorder the list it was given', () => {
    sortCallbacks(callbacks);
    expect(callbacks.map((callback) => callback.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('callback calendar', () => {
  it('flags only pending callbacks whose time has passed as overdue', () => {
    const now = new Date('2026-11-13T05:00:00Z');
    expect(isOverdueCallback({ status: 'pending', scheduledAt: '2026-11-13T04:00:00Z' }, now)).toBe(true);
    expect(isOverdueCallback({ status: 'pending', scheduledAt: '2026-11-13T06:00:00Z' }, now)).toBe(false);
    expect(isOverdueCallback({ status: 'missed', scheduledAt: '2026-11-13T04:00:00Z' }, now)).toBe(false);
  });

  it('puts a callback on the organization-local day', () => {
    expect(organizationDayKey('2026-11-13T20:00:00Z', 'Asia/Kolkata')).toBe('2026-11-14');
    expect(organizationDayKey('2026-11-13T20:00:00Z', 'UTC')).toBe('2026-11-13');
  });

  it('lays a month out in Monday-first weeks', () => {
    const november = monthGrid(2026, 11);
    expect(november).toHaveLength(6);
    expect(november[0]![0]).toEqual({ key: '2026-10-26', day: 26, inMonth: false });
    expect(november[0]![6]).toEqual({ key: '2026-11-01', day: 1, inMonth: true });
    expect(november[5]![0]).toEqual({ key: '2026-11-30', day: 30, inMonth: true });
    expect(november.every((week) => week.length === 7)).toBe(true);
  });

  it('moves between months across the year end', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('groups callbacks by day, earliest first within the day', () => {
    const days = callbacksByDay([
      { id: 'late', scheduledAt: '2026-11-13T10:00:00Z' },
      { id: 'early', scheduledAt: '2026-11-13T04:00:00Z' },
      { id: 'next', scheduledAt: '2026-11-14T04:00:00Z' },
    ], 'Asia/Kolkata');
    expect(days.get('2026-11-13')?.map((callback) => callback.id)).toEqual(['early', 'late']);
    expect(days.get('2026-11-14')?.map((callback) => callback.id)).toEqual(['next']);
  });
});
