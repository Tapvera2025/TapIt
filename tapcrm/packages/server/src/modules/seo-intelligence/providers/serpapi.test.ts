import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../../platform/dal/context.js';
import { ApplicationError } from '../../../errors.js';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), reserve: vi.fn() }));
vi.mock('../crawler/ssrf-guard.js', () => ({ safeFetch: mocks.fetch }));
vi.mock('../serp-allowance.js', () => ({ reserveSerpSearch: mocks.reserve }));
import { createSerpApiProvider } from './serpapi.js';

const ctx = { organizationId: 'org-a' } as RequestContext;
const config = { ctx, apiKey: 'test-key', siteId: 'site-a', keywordId: 'keyword-a', scanRunId: null };
const input = { query: 'agency', targetDomain: 'tapvera.io', market: 'in', language: 'en', device: 'desktop' as const, depth: 10 };
beforeEach(() => { vi.clearAllMocks(); mocks.reserve.mockResolvedValue(undefined); });
describe('SerpApi rank observation', () => {
  it('makes no request without credentials', async () => {
    expect((await createSerpApiProvider({ ...config, apiKey: '' }).observe(input)).state).toBe('not_configured');
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('stops before the provider when the allowance is exhausted', async () => {
    mocks.reserve.mockRejectedValue(new ApplicationError('Limit', 429, 'SEO_SERP_LIMIT'));
    await expect(createSerpApiProvider(config).observe(input)).rejects.toMatchObject({ code: 'SEO_SERP_LIMIT' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('records only a matching host and preserves the returned position', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ organic_results: [{ position: 1, link: 'https://eviltapvera.io/' }, { position: 3, link: 'https://www.tapvera.io/service' }] })));
    const result = await createSerpApiProvider(config).observe(input);
    expect(mocks.reserve).toHaveBeenCalledWith(ctx, 'site-a', 'keyword-a');
    expect(result.data).toMatchObject({ organicRank: 3, observedUrl: 'https://www.tapvera.io/service', snapshotComplete: false });
    const url = new URL(String(mocks.fetch.mock.calls[0]?.[0]));
    expect(url.searchParams.get('gl')).toBe('in');
    expect(url.searchParams.has('num')).toBe(false);
  });
  it('keeps a missing target distinct from a provider failure', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ organic_results: [{ position: 1, link: 'https://other.example/' }] })));
    expect((await createSerpApiProvider(config).observe(input)).data?.organicRank).toBeNull();
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Invalid key' }), { status: 401 }));
    expect((await createSerpApiProvider(config).observe(input)).state).toBe('provider_error');
    // An empty results page is an answer (not ranked), not a provider failure.
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Google hasn't returned any results for this query." }), { status: 200 }));
    const empty = await createSerpApiProvider(config).observe(input);
    expect(empty.state).toBe('ok');
    expect(empty.data?.organicRank).toBeNull();
  });
});
