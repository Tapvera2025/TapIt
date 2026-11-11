/**
 * PageSpeed Insights (hosted Lighthouse) provider — free, optional API key for
 * higher quota. Returns the lab performance score plus the key metric values
 * Lighthouse exposes. Mirrors cruxFetch's shape (SeoProviderResult<T>) so the
 * calling job code can treat all providers uniformly.
 */
import { safeFetch } from '../crawler/http.js';
import { decimal } from '@tapcrm/contracts';
import type { SeoProviderResult, SeoProvenance, LighthouseReport } from './types.js';

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

const PROVENANCE: SeoProvenance = {
  source: 'pagespeed',
  retrievedAt: '',
  dataAsOf: null,
  confidence: 'direct',
  isPaid: false,
};

interface PsiAudit {
  numericValue?: number;
}

interface PsiResponse {
  lighthouseResult?: {
    categories?: {
      performance?: { score: number | null };
    };
    audits?: {
      'largest-contentful-paint'?: PsiAudit;
      'total-blocking-time'?: PsiAudit;
      'cumulative-layout-shift'?: PsiAudit;
      'first-contentful-paint'?: PsiAudit;
      'speed-index'?: PsiAudit;
    };
    lighthouseVersion?: string;
    userAgent?: string;
    fetchTime?: string;
  };
  error?: { code: number; message: string };
}

/**
 * Runs a PSI/Lighthouse audit for a specific URL. Returns provider_error on any
 * failure so callers can skip storage without aborting the whole job.
 */
export async function pagespeedFetch(
  url: string,
  strategy: 'mobile' | 'desktop' = 'mobile',
): Promise<SeoProviderResult<LighthouseReport>> {
  const apiKey = process.env['PAGESPEED_API_KEY'];
  const params = new URLSearchParams({ url, strategy, category: 'performance' });
  if (apiKey) params.set('key', apiKey);
  const endpoint = `${PSI_ENDPOINT}?${params.toString()}`;

  const start = Date.now();

  let body: string;
  try {
    // PSI audits take 15–60s. Give it room; cap at 90s.
    const result = await safeFetch(endpoint, { timeoutMs: 90_000, maxBytes: 10 * 1024 * 1024 });
    if (result.status !== 200) {
      return providerError(result.status === 429 ? 'PageSpeed API quota was reached. Retry later.' : result.status === 403 || result.status === 400 ? 'Google denied PageSpeed access. Enable PageSpeed Insights API and check the API-key restrictions.' : `PageSpeed returned HTTP ${result.status}. Retry later.`);
    }
    body = result.body;
  } catch {
    return providerError();
  }

  let json: PsiResponse;
  try { json = JSON.parse(body) as PsiResponse; } catch { return providerError(); }
  if (json.error || !json.lighthouseResult?.categories?.performance) return providerError();

  const perf = json.lighthouseResult.categories.performance;
  const audits = json.lighthouseResult.audits ?? {};
  // Lighthouse score is 0..1; the DB column is 0..100.
  const performanceScore = perf.score == null ? null : Math.round(perf.score * 100);

  const report: LighthouseReport = {
    performanceScore,
    lcp: audits['largest-contentful-paint']?.numericValue ?? null,
    tbt: audits['total-blocking-time']?.numericValue ?? null,
    cls: audits['cumulative-layout-shift']?.numericValue ?? null,
    fcp: audits['first-contentful-paint']?.numericValue ?? null,
    si: audits['speed-index']?.numericValue ?? null,
    runnerVersion: json.lighthouseResult.lighthouseVersion ?? 'unknown',
    browserProfile: json.lighthouseResult.userAgent ?? strategy,
    runAt: json.lighthouseResult.fetchTime ?? new Date().toISOString(),
  };

  return {
    state: 'ok',
    data: report,
    provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
    coverage: 1,
    usage: {
      provider: 'pagespeed',
      operation: 'runPagespeed',
      units: 1,
      unitType: 'audits',
      costCents: decimal('0'),
      elapsedMs: Date.now() - start,
    },
  };
}

function providerError(message = 'The PageSpeed audit could not be completed. Please retry.'): SeoProviderResult<LighthouseReport> {
  return {
    state: 'provider_error',
    message,
    data: null,
    provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
    coverage: null,
    usage: null,
  };
}
