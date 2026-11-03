/**
 * SerpApi SERP rank provider — paid, requires API key.
 * Returns state='not_configured' when no key is set, never fabricates rank data.
 */
import { safeFetch } from '../crawler/ssrf-guard.js';
import { reserveSerpSearch } from '../serp-allowance.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import type { SeoProvenance, SerpSnapshot, SearchRankProvider } from './types.js';

const SERPAPI_ENDPOINT = 'https://serpapi.com/search.json';
const PROVENANCE: SeoProvenance = {
  source: 'serpapi',
  retrievedAt: '',
  dataAsOf: null,
  confidence: 'direct',
  isPaid: true,
};

interface SerpApiResult {
  organic_results?: Array<{
    position: number;
    link: string;
    result_type?: string;
  }>;
  error?: string;
}

export function createSerpApiProvider(config: {
  ctx: RequestContext;
  apiKey: string;
  siteId: string;
  keywordId: string;
  scanRunId: string | null;
}): SearchRankProvider {
  return {
    async observe(args) {
      if (!config.apiKey) {
        return {
          state: 'not_configured',
          data: null,
          provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
          coverage: null,
          usage: null,
        };
      }

      await reserveSerpSearch(config.ctx, config.siteId, config.keywordId);

      const params = new URLSearchParams({
        engine: 'google',
        q: args.query,
        gl: args.market,
        hl: args.language,
        device: args.device,
        api_key: config.apiKey,
        output: 'json',
      });

      let response: Response;
      try {
        response = await safeFetch(`${SERPAPI_ENDPOINT}?${params.toString()}`, { signal: AbortSignal.timeout(45_000) });
      } catch {
        return {
          state: 'provider_error',
          data: null,
          provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
          coverage: null,
          usage: null,
        };
      }

      const json = (await response.json().catch(() => ({ error: 'Invalid provider response' }))) as SerpApiResult;
      if (json.error || !response.ok) {
        return {
          state: 'provider_error',
          data: null,
          provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
          coverage: null,
          usage: null,
        };
      }

      const organic = json.organic_results ?? [];
      const normalizedTarget = args.targetDomain.replace(/^www\./, '').toLowerCase();
      const match = organic.find((r) => {
        try {
          return new URL(r.link).hostname.replace(/^www\./, '').toLowerCase() === normalizedTarget;
        } catch {
          return false;
        }
      });

      const snapshot: SerpSnapshot = {
        engine: 'google',
        country: args.market,
        device: args.device,
        query: args.query,
        organicRank: match?.position ?? null,
        observedUrl: match?.link ?? null,
        resultType: match?.result_type ?? null,
        snapshotComplete: false,
      };


      return {
        state: 'ok',
        data: snapshot,
        provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
        coverage: organic.length,
        usage: null,
      };
    },
  };
}
