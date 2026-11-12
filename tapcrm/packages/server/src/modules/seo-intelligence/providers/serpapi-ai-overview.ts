/**
 * AI Visibility via SerpAPI's Google AI Overview response.
 *
 * When Google serves an AI Overview for a query, SerpAPI returns an
 * `ai_overview` field containing `text_blocks` (what the AI said) and
 * `references` (the pages it cited). Perfect fit for "does Google's AI
 * mention us?" — and it reuses the existing SERPAPI_API_KEY so no new
 * credentials are needed.
 *
 * Docs: https://serpapi.com/google-ai-overview
 *
 * Important: Google only serves AI Overviews for a subset of queries — mostly
 * informational, "how/why/what is X" patterns. Commercial / navigational
 * queries often return no overview. When that happens we record a successful
 * observation with empty citations rather than a failure, so the denominator
 * ("prompts observed") stays honest.
 */
import { safeFetch } from '../crawler/http.js';
import { decimal } from '@tapcrm/contracts';
import type { SeoProviderResult, SeoProvenance, AIAnswerSnapshot, AISearchProvider } from './types.js';

const SERPAPI_ENDPOINT = 'https://serpapi.com/search.json';
const PROVENANCE: SeoProvenance = {
  source: 'serpapi-ai-overview',
  retrievedAt: '',
  dataAsOf: null,
  confidence: 'direct',
  isPaid: true,
};

interface SerpApiAiOverview {
  text_blocks?: Array<{
    type?: string;
    snippet?: string;
    reference_indexes?: number[];
  }>;
  references?: Array<{
    link?: string;
    title?: string;
    source?: string;
  }>;
}

interface SerpApiResponse {
  ai_overview?: SerpApiAiOverview;
  error?: string;
}

export function createSerpApiAiOverviewProvider(): AISearchProvider {
  return {
    async observe(args): Promise<SeoProviderResult<AIAnswerSnapshot>> {
      const apiKey = process.env['SERPAPI_API_KEY'];
      if (!apiKey) return notConfigured();

      const start = Date.now();
      const params = new URLSearchParams({
        engine: 'google',
        q: args.prompt,
        hl: args.language,
        gl: localeToCountry(args.locale),
        api_key: apiKey,
        output: 'json',
      });

      let response;
      try {
        response = await safeFetch(`${SERPAPI_ENDPOINT}?${params.toString()}`, {
          timeoutMs: 30_000,
        });
      } catch {
        return providerError();
      }
      if (response.status !== 200) return providerError();

      let json: SerpApiResponse;
      try { json = JSON.parse(response.body); } catch { return providerError(); }
      if (json.error) return providerError();

      // No AI Overview for this query — Google chose not to generate one.
      // Record as a successful observation with no citations rather than a
      // failure, so the denominator ("prompts observed") stays honest.
      if (!json.ai_overview) {
        return {
          state: 'ok',
          data: {
            platform: args.platform,
            locale: args.locale,
            promptText: args.prompt,
            brandMentioned: false,
            domainCited: false,
            citationUrls: [],
            competitorMentions: [],
            rawAnswerRef: null,
          },
          provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
          coverage: 0,
          usage: usage(start),
        };
      }

      const overview = json.ai_overview;
      const answerText = (overview.text_blocks ?? [])
        .map((b) => b.snippet ?? '')
        .filter(Boolean)
        .join(' ');
      const citations = (overview.references ?? [])
        .map((r) => r.link)
        .filter((link): link is string => typeof link === 'string' && link.length > 0);

      const targetDomain = normalizeHost(args.domain);
      const domainCited = citations.some((url) => urlHostMatches(url, targetDomain));
      const brandMentioned = args.brandAliases.length === 0
        ? null
        : args.brandAliases.some((alias) => alias && answerText.toLowerCase().includes(alias.toLowerCase()));

      return {
        state: 'ok',
        data: {
          platform: args.platform,
          locale: args.locale,
          promptText: args.prompt,
          brandMentioned,
          domainCited,
          citationUrls: citations.slice(0, 20),
          competitorMentions: [],
          rawAnswerRef: null,
        },
        provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
        coverage: citations.length,
        usage: usage(start),
      };
    },
  };
}

function notConfigured(): SeoProviderResult<AIAnswerSnapshot> {
  return {
    state: 'not_configured',
    data: null,
    provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
    coverage: null,
    usage: null,
  };
}
function providerError(): SeoProviderResult<AIAnswerSnapshot> {
  return {
    state: 'provider_error',
    data: null,
    provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
    coverage: null,
    usage: null,
  };
}
function usage(startedAt: number) {
  return {
    provider: 'serpapi-ai-overview',
    operation: 'google.ai_overview',
    units: 1,
    unitType: 'searches',
    // Billed as a regular SerpAPI Google search. Approximation only.
    costCents: decimal('5'),
    elapsedMs: Date.now() - startedAt,
  };
}
function localeToCountry(locale: string): string {
  // Locale is e.g. "en-US" → "us". Fallback to "us" when ambiguous.
  const parts = locale.split('-');
  const region = parts[1];
  return (region ?? 'US').toLowerCase();
}
function normalizeHost(input: string): string {
  try {
    const host = new URL(input.startsWith('http') ? input : `https://${input}`).hostname;
    return host.replace(/^www\./, '').toLowerCase();
  } catch {
    return input.replace(/^www\./, '').toLowerCase();
  }
}
function urlHostMatches(url: string, targetHost: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return h === targetHost || h.endsWith(`.${targetHost}`);
  } catch { return false; }
}
