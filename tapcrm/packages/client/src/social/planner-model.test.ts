import { describe, expect, it } from 'vitest';
import { SECTION_STATUSES, sectionStatusQuery } from './planner-model.js';

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
