/**
 * Perplexity Sonar AI-visibility provider — real citation tracking.
 *
 * Perplexity's Sonar models answer natural-language queries by searching the
 * live web and returning a response alongside a `citations` array of URLs the
 * answer draws from. Perfect fit for "does ChatGPT/Google AI cite our site?"
 *
 * Docs:    https://docs.perplexity.ai/
 * Endpoint: POST https://api.perplexity.ai/chat/completions
 * Auth:    Bearer PERPLEXITY_API_KEY
 *
 * Pricing: Sonar ~$1 per 1k queries; Sonar Pro ~$5. Set via SEO_PERPLEXITY_MODEL
 * (defaults to 'sonar').
 */
import { safeFetch } from '../crawler/http.js';
import { decimal } from '@tapcrm/contracts';
import type { SeoProviderResult, SeoProvenance, AIAnswerSnapshot, AISearchProvider } from './types.js';

const PPLX_ENDPOINT = 'https://api.perplexity.ai/chat/completions';
const PROVENANCE: SeoProvenance = {
  source: 'perplexity',
  retrievedAt: '',
  dataAsOf: null,
  confidence: 'direct',
  isPaid: true,
};

interface PerplexityResponse {
  choices?: Array<{ message?: { content?: string } }>;
  citations?: string[];
  error?: { message: string };
}

export interface PerplexityConfig {
  model?: string;
}

export function createPerplexityProvider(_config: PerplexityConfig = {}): AISearchProvider {
  return {
    async observe(args): Promise<SeoProviderResult<AIAnswerSnapshot>> {
      const apiKey = process.env['PERPLEXITY_API_KEY'];
      if (!apiKey) return notConfigured(args);

      const model = _config.model ?? process.env['SEO_PERPLEXITY_MODEL'] ?? 'sonar';
      const start = Date.now();

      let response;
      try {
        response = await safeFetch(PPLX_ENDPOINT, {
          method: 'POST',
          timeoutMs: 60_000,
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: args.prompt }],
            // Keep answers short; we only need the mention/citation signal.
            max_tokens: 500,
            // Perplexity's default temperature is fine for factual lookups.
          }),
        });
      } catch {
        return providerError(args);
      }
      if (response.status !== 200) return providerError(args);

      let json: PerplexityResponse;
      try { json = JSON.parse(response.body); } catch { return providerError(args); }
      if (json.error) return providerError(args);

      const answerText = json.choices?.[0]?.message?.content ?? '';
      const citations = Array.isArray(json.citations) ? json.citations : [];

      // Extract signals: domain cited? brand mentioned? competitors named?
      const targetDomain = normalizeHost(args.domain);
      const domainCited = citations.some((url) => urlHostMatches(url, targetDomain));
      const brandMentioned = args.brandAliases.length === 0 ? null : args.brandAliases.some(
        (alias) => alias && answerText.toLowerCase().includes(alias.toLowerCase()),
      );
      const competitorMentions: Array<{ domain: string; mentioned: boolean }> = [];
      // No per-competitor list in current args — leave empty. A future enhancement
      // could pass competitor aliases and mark each as mentioned/absent.

      const snapshot: AIAnswerSnapshot = {
        platform: args.platform,
        locale: args.locale,
        promptText: args.prompt,
        brandMentioned,
        domainCited,
        citationUrls: citations.slice(0, 20),
        competitorMentions,
        // We do not persist the full answer text in the main table; a future job
        // can push it to seo_evidence_blobs. For now, leave the pointer null.
        rawAnswerRef: null,
      };

      return {
        state: 'ok',
        data: snapshot,
        provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
        coverage: citations.length,
        usage: {
          provider: 'perplexity',
          operation: 'chat.completions',
          units: 1,
          unitType: 'queries',
          // Approximation — Perplexity charges per 1k requests at list price.
          // Round-up assumes a Sonar query. Pro would be ~5x.
          costCents: decimal('1'),
          elapsedMs: Date.now() - start,
        },
      };
    },
  };
}

function notConfigured(args: { platform: string; locale: string; prompt: string }): SeoProviderResult<AIAnswerSnapshot> {
  return {
    state: 'not_configured',
    data: null,
    provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
    coverage: null,
    usage: null,
  };
  void args;
}
function providerError(args: { platform: string; locale: string; prompt: string }): SeoProviderResult<AIAnswerSnapshot> {
  return {
    state: 'provider_error',
    data: null,
    provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
    coverage: null,
    usage: null,
  };
  void args;
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
