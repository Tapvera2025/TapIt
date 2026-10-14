import type { DateOnly } from '@tapcrm/contracts';
import type { SeoCategory, SeoDevice } from './types.js';

/**
 * The seam between "when and where to fetch a rank" and "who answers".
 *
 * Search Console is the only provider today, and it cannot serve every row the
 * keyword table can hold: no Bing, no GMB, no city. A paid SERP API can serve
 * all of them. Keeping the scheduler, the writes and the UI behind this
 * interface means adding one is a new file plus a line in `providerFor`, not a
 * rewrite of the sync path.
 */

/** The shape of a keyword that decides whether a provider can serve it. */
export interface RankTargeting {
  readonly searchEngine: string;
  readonly category: SeoCategory;
  readonly country: string;
  readonly city: string | null;
  readonly device: SeoDevice;
}

export interface RankRequest extends RankTargeting {
  readonly keywordId: string;
  readonly keyword: string;
  readonly targetUrl: string | null;
}

export interface RankWindow {
  readonly start: DateOnly;
  readonly end: DateOnly;
}

/** Why a provider declined a keyword, in words a user reads in the UI. */
export type Support = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export type RankResult =
  | {
      readonly keywordId: string;
      readonly status: 'available';
      /** The rounded rank written to `current_rank`. */
      readonly position: number;
      /** What the provider actually reported, before rounding. */
      readonly exactPosition: number;
      readonly impressions: number;
      readonly clicks: number;
      readonly ctr: number;
    }
  | {
      readonly keywordId: string;
      readonly status: 'unavailable';
      /**
       * `not-ranked`  the provider answered, and this keyword was not in it
       * `no-data`     the provider has nothing for the window at all
       */
      readonly reason: 'not-ranked' | 'no-data';
    }
  | {
      readonly keywordId: string;
      readonly status: 'skipped';
      readonly reason: string;
    };

export interface RankProvider {
  /** Stored on every observation, so a row always says who produced it. */
  readonly name: string;
  /** Checked before any network call; a declined keyword costs nothing. */
  supports(targeting: RankTargeting): Support;
  /**
   * Ranks for every request the provider accepted. Implementations return one
   * result per request and batch their own network calls.
   *
   * Called outside any transaction (TX-2).
   */
  fetchRanks(
    target: { readonly propertyUrl: string },
    requests: readonly RankRequest[],
    window: RankWindow,
  ): Promise<RankResult[]>;
}
