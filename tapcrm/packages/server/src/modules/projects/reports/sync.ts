import { loadConfig } from '../../../config.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import {
  SearchConsoleConfigurationError,
  SearchConsoleUnavailableError,
} from '../../../platform/integrations/google/search-console.js';
import { googleAuthConfigured } from '../../../platform/integrations/google/token.js';
import { addDays, localDateOf, type Clock } from '../../../platform/time.js';
import { organizationTimezone } from '../../../platform/organization-time.js';
import type { RankProvider, RankRequest, RankResult, RankWindow } from './rank-provider.js';
import {
  applyAutomaticObservation,
  automatableKeywords,
  dueKeywords,
  findSearchConsoleLink,
  markFetchOutcome,
  recordSyncOutcome,
  type DueKeyword,
  type FetchOutcome,
  type SyncStatus,
} from './repository.js';
import { searchConsoleProvider } from './search-console-provider.js';

/**
 * Fetching ranks for one project.
 *
 * The shape follows TX-2 and TX-3 strictly: everything the database knows is
 * read first, the provider is called with no transaction open, and the results
 * are written in one short transaction afterwards. No HTTP call ever sits
 * inside a business transaction.
 */

/** A ceiling, so one misconfigured project cannot spend an entire job run. */
const MAX_KEYWORDS_PER_RUN = 500;

export interface SyncOutcome {
  readonly status: SyncStatus;
  readonly fetched: number;
  readonly unavailable: number;
  readonly skipped: number;
  readonly message: string | null;
}

/** The only provider today. A second one would be chosen per keyword here. */
export function providerFor(): RankProvider {
  return searchConsoleProvider();
}

/**
 * The window an observation covers, in the organization's own timezone (T-2:
 * never the server's date, never a UTC string).
 *
 * It ends `LAG_DAYS` back because Search Console's most recent days are still
 * being collected, and spans `WINDOW_DAYS` because a single day is sparse — a
 * keyword with a handful of impressions simply vanishes from a one-day query.
 */
export async function observationWindow(ctx: RequestContext, clock: Clock): Promise<RankWindow> {
  const config = loadConfig();
  const zone = await db.transaction(ctx, (tx) => organizationTimezone(tx));
  const today = localDateOf(clock.now(), zone);
  const end = addDays(today, -config.GOOGLE_SEARCH_CONSOLE_LAG_DAYS);
  return { start: addDays(end, -(config.GOOGLE_SEARCH_CONSOLE_WINDOW_DAYS - 1)), end };
}

function toRequest(keyword: DueKeyword): RankRequest {
  return {
    keywordId: keyword.id,
    keyword: keyword.keyword,
    targetUrl: keyword.targetUrl,
    searchEngine: keyword.searchEngine,
    category: keyword.category,
    country: keyword.country,
    city: keyword.city,
    device: keyword.device,
  };
}

function outcomeOf(result: RankResult): { outcome: FetchOutcome; message: string | null } {
  if (result.status === 'available') return { outcome: 'ok', message: null };
  if (result.status === 'skipped') return { outcome: 'skipped', message: result.reason };
  return {
    outcome: 'no-data',
    message:
      result.reason === 'not-ranked'
        ? 'The site did not appear in search results for this keyword, or had too few impressions for Google to report.'
        : 'Search Console returned no data for this window.',
  };
}

/**
 * Fetches and stores ranks for one project.
 *
 * `scope: 'due'` is the scheduled path and honours each keyword's
 * `auto_fetch_frequency`; `scope: 'all'` is the "Sync now" button, which
 * refetches every automatic keyword regardless of when it was last checked.
 */
export async function syncProjectRanks(
  ctx: RequestContext,
  projectId: string,
  options: { readonly window: RankWindow; readonly scope: 'due' | 'all' },
): Promise<SyncOutcome> {
  if (!googleAuthConfigured()) {
    return { status: 'failed', fetched: 0, unavailable: 0, skipped: 0, message: 'Google Search Console is not configured on this server.' };
  }

  const link = await findSearchConsoleLink(ctx, projectId);
  if (link === null) {
    return { status: 'failed', fetched: 0, unavailable: 0, skipped: 0, message: 'This project is not linked to a Search Console property.' };
  }

  const keywords = options.scope === 'all'
    ? await automatableKeywords(ctx, projectId, MAX_KEYWORDS_PER_RUN)
    : await dueKeywords(ctx, projectId, MAX_KEYWORDS_PER_RUN);
  if (keywords.length === 0) {
    return { status: 'ok', fetched: 0, unavailable: 0, skipped: 0, message: 'No keywords were due for an automatic fetch.' };
  }

  // Keywords the provider cannot serve are decided here, before any network
  // call: a Bing or GMB keyword costs nothing and still gets told why.
  const provider = providerFor();
  const accepted: RankRequest[] = [];
  const declined: RankResult[] = [];
  for (const keyword of keywords) {
    const support = provider.supports(keyword);
    if (support.ok) accepted.push(toRequest(keyword));
    else declined.push({ keywordId: keyword.id, status: 'skipped', reason: support.reason });
  }

  // TX-2 — outside any transaction.
  let fetched: RankResult[] = [];
  let failure: string | null = null;
  if (accepted.length > 0) {
    try {
      fetched = await provider.fetchRanks({ propertyUrl: link.propertyUrl }, accepted, options.window);
    } catch (cause) {
      if (cause instanceof SearchConsoleUnavailableError) {
        // Transient. Record nothing and let the job runner's backoff retry;
        // a half-written run would make the rolling past/previous slots meaningless.
        await db.transaction(ctx, (tx) => recordSyncOutcome(tx, ctx, projectId, 'failed', `Search Console is unavailable: ${cause.message}`, 0));
        throw cause;
      }
      if (!(cause instanceof SearchConsoleConfigurationError)) throw cause;
      // A configuration fault fails identically on every retry, so it is
      // reported to the user rather than retried.
      failure = cause.message;
    }
  }

  const results = [...declined, ...fetched];
  let available = 0;
  let unavailable = 0;

  // One computation, used both for the stored row and the response: 'partial'
  // means some keywords of this project cannot be fetched automatically.
  const status: SyncStatus = failure !== null ? 'failed' : declined.length > 0 ? 'partial' : 'ok';
  const message = failure ?? (declined.length > 0 ? `${declined.length} keyword(s) cannot be fetched automatically.` : null);

  await db.transaction(ctx, async (tx) => {
    for (const result of results) {
      if (result.status === 'available') {
        available += 1;
        await applyAutomaticObservation(tx, ctx, {
          keywordId: result.keywordId,
          provider: provider.name,
          windowStart: options.window.start,
          windowEnd: options.window.end,
          rank: result.position,
          exactPosition: result.exactPosition,
          impressions: result.impressions,
          clicks: result.clicks,
          ctr: result.ctr,
          unavailableReason: null,
        });
      } else if (result.status === 'unavailable') {
        unavailable += 1;
        await applyAutomaticObservation(tx, ctx, {
          keywordId: result.keywordId,
          provider: provider.name,
          windowStart: options.window.start,
          windowEnd: options.window.end,
          rank: null,
          exactPosition: null,
          impressions: null,
          clicks: null,
          ctr: null,
          unavailableReason: result.reason,
        });
      }
      const { outcome, message } = outcomeOf(result);
      await markFetchOutcome(tx, ctx, result.keywordId, outcome, message);
    }

    // A failed fetch leaves the accepted keywords untouched and due again next
    // tick; they are not marked, so nothing looks checked when it was not.
    await recordSyncOutcome(tx, ctx, projectId, status, message, available);
  });

  return { status, fetched: available, unavailable, skipped: declined.length, message };
}
