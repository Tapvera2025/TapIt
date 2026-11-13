import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../crawler/ssrf-guard.js', () => ({ safeFetch: mocks.fetch }));
import { cruxFetch, cruxRating } from './crux.js';
beforeEach(() => vi.clearAllMocks());
describe('CrUX real-user data', () => {
  it('requires a key without sending an anonymous request', async () => {
    expect((await cruxFetch('https://example.com', 'PHONE', '')).state).toBe('not_configured');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('requests origin data and preserves collection dates and p75 measurements', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ record: {
      metrics: { largest_contentful_paint: { percentiles: { p75: 2600 } }, cumulative_layout_shift: { percentiles: { p75: '0.08' } } },
      collectionPeriod: { firstDate: { year: 2026, month: 9, day: 25 }, lastDate: { year: 2026, month: 10, day: 22 } },
    } })));
    const result = await cruxFetch('https://example.com/page', 'PHONE', 'test-key');
    const request = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual({ origin: 'https://example.com', formFactor: 'PHONE' });
    expect(result.data).toMatchObject({ lcp: { p75: 2600, rating: 'needs_improvement' }, cls: { p75: 0.08, rating: 'good' }, inp: null, collectionEnd: '2026-10-22' });
  });
  it('distinguishes no samples from denied API access', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    const missing = await cruxFetch('https://example.com', 'PHONE', 'test-key');
    expect(missing.state).toBe('ok');
    expect(missing.data?.dataAvailable).toBe(false);
    mocks.fetch.mockResolvedValueOnce(new Response('{}', { status: 403 }));
    const blocked = await cruxFetch('https://example.com', 'PHONE', 'test-key');
    expect(blocked.state).toBe('provider_error');
    expect(blocked.message).toContain('API-key restrictions');
    expect(blocked.data).toBeNull();
  });
  it('rates p75 values at the metric thresholds rather than rounding histograms', () => {
    expect(cruxRating(2500, 'lcp')).toBe('good');
    expect(cruxRating(4000, 'lcp')).toBe('needs_improvement');
    expect(cruxRating(4001, 'lcp')).toBe('poor');
    expect(cruxRating(200, 'inp')).toBe('good');
    expect(cruxRating(501, 'inp')).toBe('poor');
    expect(cruxRating(0.25, 'cls')).toBe('needs_improvement');
  });
});
