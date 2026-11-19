import { describe, expect, it } from 'vitest';
import {
  displayDestinationStatus,
  displayStatus,
  nextRefreshDelay,
  REFRESH_FAST_MS,
  REFRESH_SLOW_MS,
  SECTION_STATUSES,
  sectionStatusQuery,
} from './planner-model.js';
import type { SocialPost } from './types.js';

describe('Social section filters', () => {
  it('lists a scheduled post under Drafts & Scheduled', () => {
    const query = sectionStatusQuery('drafts', '');
    expect(query.split(',')).toEqual(
      expect.arrayContaining([
        'draft',
        'scheduled',
        'pending_approval',
        'approved',
        'failed',
      ]),
    );
  });

  it('lists partially published posts under Published', () => {
    expect(sectionStatusQuery('published', '')).toBe('published,partially_published');
  });

  it('uses the status chosen in the filter, except in Approvals', () => {
    expect(sectionStatusQuery('drafts', 'scheduled')).toBe('scheduled');
    expect(sectionStatusQuery('approvals', 'draft')).toBe('pending_approval');
    // The planner and calendar list every status.
    expect(sectionStatusQuery('planner', '')).toBe('');
    expect(sectionStatusQuery('calendar', '')).toBe('');
  });

  it('never shows the same status in two of the three lists', () => {
    const drafts = new Set(SECTION_STATUSES['drafts']);
    expect(SECTION_STATUSES['published']!.some((status) => drafts.has(status))).toBe(
      false,
    );
  });
});

const NOW = Date.parse('2026-11-19T10:49:00.000Z');
const at = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();

function post(
  status: SocialPost['status'],
  destinations: { status: string; nextAttemptAt: string | null }[],
): SocialPost {
  return {
    status,
    destinations: destinations.map((destination) => ({ ...destination, attempts: 0 })),
  } as unknown as SocialPost;
}

describe('Publishing status shown in lists', () => {
  it('shows a post queued by "Publish now" as publishing, not scheduled', () => {
    const queued = post('scheduled', [
      { status: 'scheduled', nextAttemptAt: at(-1_000) },
    ]);
    expect(displayStatus(queued, NOW)).toBe('publishing');
    expect(displayDestinationStatus(queued.destinations[0]!, NOW)).toBe('publishing');
  });

  it('keeps a post scheduled for later as scheduled', () => {
    const later = post('scheduled', [
      { status: 'scheduled', nextAttemptAt: at(3_600_000) },
    ]);
    expect(displayStatus(later, NOW)).toBe('scheduled');
  });

  it('leaves every other status as recorded', () => {
    for (const status of ['draft', 'publishing', 'published', 'failed'] as const)
      expect(displayStatus(post(status, []), NOW)).toBe(status);
  });
});

describe('Quiet list refresh', () => {
  const queued = post('scheduled', [{ status: 'scheduled', nextAttemptAt: at(-1_000) }]);

  it('checks every few seconds while a post is publishing', () => {
    expect(nextRefreshDelay([queued], NOW, NOW)).toBe(REFRESH_FAST_MS);
    expect(nextRefreshDelay([post('publishing', [])], NOW, NOW)).toBe(REFRESH_FAST_MS);
  });

  it('slows down after two minutes and stops after fifteen', () => {
    expect(nextRefreshDelay([queued], NOW, NOW - 3 * 60_000)).toBe(REFRESH_SLOW_MS);
    expect(nextRefreshDelay([queued], NOW, NOW - 15 * 60_000)).toBeNull();
  });

  it('wakes just after a scheduled time within the hour', () => {
    const soon = post('scheduled', [{ status: 'scheduled', nextAttemptAt: at(60_000) }]);
    expect(nextRefreshDelay([soon], NOW, null)).toBe(61_000);
  });

  it('does nothing when no post is about to change', () => {
    const later = post('scheduled', [
      { status: 'scheduled', nextAttemptAt: at(2 * 3_600_000) },
    ]);
    expect(nextRefreshDelay([later, post('published', [])], NOW, null)).toBeNull();
    expect(nextRefreshDelay([], NOW, null)).toBeNull();
  });
});
