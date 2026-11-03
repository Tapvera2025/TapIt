import { describe, expect, it } from 'vitest';
import {
  partitionCallbacks,
  partitionHandovers,
  partitionLeads,
  relativeTime,
  summarize,
} from './myWork-helpers.js';

const USER = 'me';
const OTHER = 'someone-else';
const now = new Date('2024-06-10T12:00:00Z');

describe('partitionCallbacks', () => {
  it('splits active own callbacks into overdue vs upcoming today, ignoring other users and non-active statuses', () => {
    const cbs = [
      { id: 'a', ownerId: USER, status: 'pending', scheduledAt: new Date(now.getTime() - 60_000).toISOString() },
      { id: 'b', ownerId: USER, status: 'pending', scheduledAt: new Date(now.getTime() + 3 * 60 * 60_000).toISOString() },
      { id: 'c', ownerId: USER, status: 'completed', scheduledAt: new Date(now.getTime() - 60_000).toISOString() },
      { id: 'd', ownerId: OTHER, status: 'pending', scheduledAt: new Date(now.getTime() - 60_000).toISOString() },
      { id: 'e', ownerId: USER, status: 'pending', scheduledAt: new Date(now.getTime() + 48 * 60 * 60_000).toISOString() },
      { id: 'f', ownerId: USER, status: 'cancelled', scheduledAt: new Date(now.getTime() + 60 * 60_000).toISOString() },
    ];
    const { overdue, upcomingToday } = partitionCallbacks(cbs, USER, now);
    expect(overdue.map((c) => c.id)).toEqual(['a']);
    expect(upcomingToday.map((c) => c.id)).toEqual(['b']);
  });

  it('shows a rescheduled callback once, at its new time', () => {
    // Rescheduling closes the old callback and books a new pending one.
    const cbs = [
      { id: 'old', ownerId: USER, status: 'rescheduled', scheduledAt: new Date(now.getTime() + 60 * 60_000).toISOString() },
      { id: 'new', ownerId: USER, status: 'pending', scheduledAt: new Date(now.getTime() + 2 * 60 * 60_000).toISOString() },
    ];
    const { overdue, upcomingToday } = partitionCallbacks(cbs, USER, now);
    expect(overdue).toEqual([]);
    expect(upcomingToday.map((c) => c.id)).toEqual(['new']);
  });
});

describe('partitionLeads', () => {
  it('surfaces leads owned by me, newly assigned, created within 24h', () => {
    const leads = [
      { id: 'a', ownerId: USER, status: 'assigned', routingStatus: 'assigned', createdAt: new Date(now.getTime() - 2 * 60 * 60_000).toISOString() },
      { id: 'b', ownerId: USER, status: 'contacted', routingStatus: 'assigned', createdAt: new Date(now.getTime() - 2 * 60 * 60_000).toISOString() },
      { id: 'c', ownerId: OTHER, status: 'assigned', routingStatus: 'assigned', createdAt: new Date(now.getTime() - 2 * 60 * 60_000).toISOString() },
      { id: 'd', ownerId: USER, status: 'new', routingStatus: 'unrouted', createdAt: new Date(now.getTime() - 48 * 60 * 60_000).toISOString() },
    ];
    const { newlyAssigned } = partitionLeads(leads, USER, now);
    expect(newlyAssigned.map((l) => l.id)).toEqual(['a']);
  });
});

describe('partitionLeads after a transfer', () => {
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60_000).toISOString();

  it('shows a lead handed to me mid-way until I touch it', () => {
    const leads = [
      { id: 'untouched', ownerId: USER, status: 'contacted', routingStatus: 'assigned', createdAt: hoursAgo(72), assignedAt: hoursAgo(2), updatedAt: hoursAgo(2) },
      { id: 'picked-up', ownerId: USER, status: 'contacted', routingStatus: 'assigned', createdAt: hoursAgo(72), assignedAt: hoursAgo(2), updatedAt: hoursAgo(1) },
    ];
    expect(partitionLeads(leads, USER, now).newlyAssigned.map((l) => l.id)).toEqual(['untouched']);
  });

  it('counts the hand-over time, not when the lead was created', () => {
    const leads = [
      { id: 'old-lead-new-owner', ownerId: USER, status: 'assigned', routingStatus: 'assigned', createdAt: hoursAgo(72), assignedAt: hoursAgo(1), updatedAt: hoursAgo(1) },
      { id: 'handed-over-days-ago', ownerId: USER, status: 'assigned', routingStatus: 'assigned', createdAt: hoursAgo(1), assignedAt: hoursAgo(30), updatedAt: hoursAgo(30) },
    ];
    expect(partitionLeads(leads, USER, now).newlyAssigned.map((l) => l.id)).toEqual(['old-lead-new-owner']);
  });

  it('never shows a converted or lost lead', () => {
    const leads = [
      { id: 'won', ownerId: USER, status: 'converted', routingStatus: 'assigned', createdAt: hoursAgo(1), assignedAt: hoursAgo(1), updatedAt: hoursAgo(1) },
      { id: 'lost', ownerId: USER, status: 'closed_lost', routingStatus: 'assigned', createdAt: hoursAgo(1), assignedAt: hoursAgo(1), updatedAt: hoursAgo(1) },
    ];
    expect(partitionLeads(leads, USER, now).newlyAssigned).toEqual([]);
  });
});

describe('partitionHandovers', () => {
  it('keeps only pending handovers offered to me (including team-queue with null toUserId)', () => {
    const handovers = [
      { id: 'a', toUserId: USER, status: 'pending' },
      { id: 'b', toUserId: null, status: 'pending' },
      { id: 'c', toUserId: USER, status: 'accepted' },
      { id: 'd', toUserId: OTHER, status: 'pending' },
    ];
    expect(partitionHandovers(handovers, USER).pendingForMe.map((h) => h.id)).toEqual(['a', 'b']);
  });
});

describe('relativeTime', () => {
  it('formats future and past differences', () => {
    expect(relativeTime(new Date(now.getTime() + 45 * 60_000).toISOString(), now)).toBe('in 45 min');
    expect(relativeTime(new Date(now.getTime() - 30 * 60_000).toISOString(), now)).toBe('30 min ago');
    expect(relativeTime(new Date(now.getTime() + 2 * 60 * 60_000).toISOString(), now)).toBe('in 2h');
    expect(relativeTime(new Date(now.getTime() - 3 * 24 * 60 * 60_000).toISOString(), now)).toBe('3d ago');
  });
});

describe('summarize', () => {
  it('returns five section counts in priority order with urgency flags', () => {
    const summary = summarize(2, 0, 1, 3, 5);
    expect(summary.map((s) => s.label)).toEqual([
      'Live offers',
      'Overdue',
      'Handovers',
      'Newly assigned',
      'Upcoming',
    ]);
    expect(summary.map((s) => s.urgent)).toEqual([true, false, true, true, false]);
  });
});
