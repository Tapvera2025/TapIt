import type { SocialPost, SocialPostStatus } from './types.js';

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

type Destination = SocialPost['destinations'][number];

/** A destination whose time has come: it waits only for the publishing worker,
 * which sweeps every 15 seconds. */
function isDue(destination: Destination, now: number): boolean {
  return (
    destination.status === 'scheduled' &&
    destination.nextAttemptAt !== null &&
    Date.parse(destination.nextAttemptAt) <= now
  );
}

/** A destination's status as shown: once due, a scheduled one reads as publishing. */
export function displayDestinationStatus(destination: Destination, now: number): string {
  return isDue(destination, now) ? 'publishing' : destination.status;
}

/**
 * A post's status as shown. "Publish now" queues the post as scheduled for that
 * moment and the worker sends it within seconds, so a scheduled post whose time
 * has come reads as publishing rather than scheduled. A retry still waiting for
 * its next attempt stays scheduled.
 */
export function displayStatus(post: SocialPost, now: number): SocialPostStatus {
  return post.status === 'scheduled' &&
    post.destinations.some((destination) => isDue(destination, now))
    ? 'publishing'
    : post.status;
}

/** How often a list checks again while a post on it is being published. */
export const REFRESH_FAST_MS = 5_000;
/** After two minutes of waiting, a slower check (videos can take minutes). */
export const REFRESH_SLOW_MS = 30_000;
const FAST_FOR_MS = 2 * 60_000;
/** After fifteen minutes, stop: the worker is stuck, and a reload shows why. */
const GIVE_UP_AFTER_MS = 15 * 60_000;
/** A list wakes for a scheduled post due within the hour, not later ones. */
const WAKE_WITHIN_MS = 60 * 60_000;

/**
 * Milliseconds until a list of posts should be loaded again, or null when no
 * post on it is about to change. `waitingSince` is when a post on the list was
 * first seen publishing, or null.
 */
export function nextRefreshDelay(
  posts: readonly SocialPost[],
  now: number,
  waitingSince: number | null,
): number | null {
  if (posts.some((post) => displayStatus(post, now) === 'publishing')) {
    const waited = waitingSince === null ? 0 : now - waitingSince;
    if (waited >= GIVE_UP_AFTER_MS) return null;
    return waited >= FAST_FOR_MS ? REFRESH_SLOW_MS : REFRESH_FAST_MS;
  }
  let next = Infinity;
  for (const post of posts)
    for (const destination of post.destinations)
      if (destination.status === 'scheduled' && destination.nextAttemptAt !== null)
        next = Math.min(next, Date.parse(destination.nextAttemptAt));
  const until = next - now;
  if (!Number.isFinite(until) || until > WAKE_WITHIN_MS) return null;
  // Load just after the time arrives, so the post then reads as publishing.
  return Math.max(until, 0) + 1_000;
}
