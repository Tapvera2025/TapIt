/** Real-user field measurements. The CrUX API requires an enabled API key. */
import { safeFetch } from '../crawler/ssrf-guard.js';
import { decimal } from '@tapcrm/contracts';
import type { SeoProviderResult, CruxMetrics } from './types.js';

interface Metric { percentiles?: { p75?: number | string } }
interface CruxResponse {
  record?: { metrics?: Record<string, Metric>; collectionPeriod?: {
    firstDate?: { year: number; month: number; day: number };
    lastDate?: { year: number; month: number; day: number };
  } };
}

export function cruxRating(value: number, metric: 'lcp' | 'inp' | 'cls'): 'good' | 'needs_improvement' | 'poor' {
  const [good, poor] = metric === 'lcp' ? [2500, 4000] : metric === 'inp' ? [200, 500] : [0.1, 0.25];
  return value <= good ? 'good' : value <= poor ? 'needs_improvement' : 'poor';
}
function reading(metric: Metric | undefined): number | null {
  const raw = metric?.percentiles?.p75;
  if (raw === undefined) return null;
  const value = typeof raw === 'string' ? Number(raw) : raw;
  return Number.isFinite(value) && value >= 0 ? value : null;
}
function dateString(date: { year: number; month: number; day: number } | undefined): string | null {
  return date ? `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}` : null;
}
export async function cruxFetch(url: string, formFactor: 'PHONE' | 'DESKTOP' | 'TABLET' = 'PHONE', apiKey = process.env['CRUX_API_KEY'] || process.env['PAGESPEED_API_KEY']): Promise<SeoProviderResult<CruxMetrics>> {
  const provenance = { source: 'crux', retrievedAt: new Date().toISOString(), dataAsOf: null, confidence: 'direct' as const, isPaid: false };
  const failure = (state: 'not_configured' | 'provider_error', message: string): SeoProviderResult<CruxMetrics> => ({ state, message, data: null, provenance, coverage: null, usage: null });
  if (!apiKey) return failure('not_configured', 'A Google API key with Chrome UX Report API access is required for real-user Core Web Vitals.');
  let response: Response;
  const started = Date.now();
  try {
    response = await safeFetch('https://chromeuxreport.googleapis.com/v1/records:queryRecord?' + new URLSearchParams({ key: apiKey }).toString(), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: new URL(url).origin, formFactor }), signal: AbortSignal.timeout(20_000),
    });
  } catch { return failure('provider_error', 'The Chrome UX Report request failed or timed out. Please retry.'); }
  if (response.status === 404) return { state: 'ok', data: { dataAvailable: false, lcp: null, inp: null, cls: null, fcp: null, ttfb: null }, message: 'Google has no CrUX record for this origin and device. There may be insufficient eligible real-user samples.', provenance, coverage: 0, usage: null };
  if (!response.ok) return failure('provider_error', response.status === 403 || response.status === 400
    ? 'Google denied the CrUX request. Enable Chrome UX Report API in the key’s Google Cloud project and check API-key restrictions.'
    : response.status === 429 ? 'The CrUX API quota was reached. Retry later.' : `Google CrUX returned HTTP ${response.status}. Retry later.`);
  const body = await response.json().catch(() => null) as CruxResponse | null;
  const metrics = body?.record?.metrics;
  if (!metrics) return failure('provider_error', 'Google returned an invalid CrUX response.');
  const lcp = reading(metrics['largest_contentful_paint']);
  const inp = reading(metrics['interaction_to_next_paint']);
  const cls = reading(metrics['cumulative_layout_shift']);
  const fcp = reading(metrics['first_contentful_paint']);
  const ttfb = reading(metrics['experimental_time_to_first_byte']);
  const collectionStart = dateString(body?.record?.collectionPeriod?.firstDate);
  const collectionEnd = dateString(body?.record?.collectionPeriod?.lastDate);
  return { state: 'ok', provenance: { ...provenance, dataAsOf: collectionEnd }, coverage: 1,
    data: { dataAvailable: lcp !== null || inp !== null || cls !== null,
      lcp: lcp === null ? null : { p75: lcp, rating: cruxRating(lcp, 'lcp') },
      inp: inp === null ? null : { p75: inp, rating: cruxRating(inp, 'inp') },
      cls: cls === null ? null : { p75: cls, rating: cruxRating(cls, 'cls') },
      fcp: fcp === null ? null : { p75: fcp }, ttfb: ttfb === null ? null : { p75: ttfb }, collectionStart, collectionEnd },
    usage: { provider: 'crux', operation: 'queryRecord', units: 1, unitType: 'requests', costCents: decimal('0'), elapsedMs: Date.now() - started } };
}
