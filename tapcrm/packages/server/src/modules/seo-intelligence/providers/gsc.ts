/**
 * GSC provider adapter — wraps the existing platform search-console integration.
 * Returns SeoProviderResult<SearchAnalyticsRow[]> with state 'not_configured' when
 * Google auth is not set up, so callers never display fabricated zeros.
 */
import {
  querySearchAnalytics,
  SearchConsoleConfigurationError,
  SearchConsoleUnavailableError,
  type SearchAnalyticsRow,
  type SearchAnalyticsRequest,
} from '../../../platform/integrations/google/search-console.js';
import type { SeoProviderResult, SeoProvenance } from './types.js';

const PROVENANCE: SeoProvenance = {
  source: 'google_search_console',
  retrievedAt: '',
  dataAsOf: null,
  confidence: 'direct',
  isPaid: false,
};

export async function gscFetch(
  propertyUrl: string,
  request: SearchAnalyticsRequest,
): Promise<SeoProviderResult<SearchAnalyticsRow[]>> {
  const start = Date.now();
  try {
    const rows = await querySearchAnalytics(propertyUrl, request);
    return {
      state: 'ok',
      data: rows,
      provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
      coverage: rows.length,
      usage: { provider: 'gsc', operation: 'searchAnalytics', units: rows.length, unitType: 'rows', costCents: 0, elapsedMs: Date.now() - start },
    };
  } catch (err) {
    if (err instanceof SearchConsoleConfigurationError) {
      return {
        state: 'not_configured',
        data: null,
        provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
        coverage: null,
        usage: null,
      };
    }
    if (err instanceof SearchConsoleUnavailableError) {
      return {
        state: 'provider_error',
        data: null,
        provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
        coverage: null,
        usage: null,
      };
    }
    throw err;
  }
}
