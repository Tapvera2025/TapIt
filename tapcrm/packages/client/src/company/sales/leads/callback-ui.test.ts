import { describe, expect, it } from 'vitest';
import {
  anHourLater,
  callbackOwnerOptions,
  callbackStatusLabel,
  filterCallbacks,
  organizationLocalToIso,
  organizationNowLocal,
  sentenceLabel,
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
