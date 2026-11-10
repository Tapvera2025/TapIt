import type { SocialPostStatus } from './types.js';

/**
 * What each Social section lists while no status is chosen in its filter.
 * "Drafts & Scheduled" is everything not out yet — including posts waiting for
 * approval, approved, scheduled, publishing now, or failed — so a post never
 * disappears from it on its way to being published.
 */
export const SECTION_STATUSES: Readonly<Record<string, readonly SocialPostStatus[]>> = {
  drafts: ['draft', 'pending_approval', 'approved', 'scheduled', 'publishing', 'failed'],
  published: ['published', 'partially_published'],
  approvals: ['pending_approval'],
};

/** The `status` query for a section: the status chosen in its filter, else the
 * section's own statuses, comma-separated. Approvals always lists pending ones. */
export function sectionStatusQuery(section: string, chosen: string): string {
  if (section === 'approvals') return 'pending_approval';
  if (chosen) return chosen;
  return (SECTION_STATUSES[section] ?? []).join(',');
}

/** The filter's empty choice, named for what it lists. */
export function sectionStatusPlaceholder(section: string): string {
  return section === 'drafts'
    ? 'All drafts & scheduled'
    : section === 'published'
      ? 'All published'
      : 'All statuses';
}
