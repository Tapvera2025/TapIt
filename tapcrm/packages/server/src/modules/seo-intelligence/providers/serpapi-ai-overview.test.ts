/**
 * Response-parsing tests for the SerpAPI AI Overview provider.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const safeFetchMock = vi.fn();
vi.mock('../crawler/http.js', () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
  FetchError: class FetchError extends Error {},
  FetchTimeoutError: class FetchTimeoutError extends Error {},
  RedirectLoopError: class RedirectLoopError extends Error {},
}));

const { createSerpApiAiOverviewProvider } = await import('./serpapi-ai-overview.js');

function respond(body: unknown, status = 200) {
  const serialized = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    finalUrl: 'https://serpapi.com/search.json',
    status, headers: {}, body: serialized, byteLength: serialized.length,
    truncated: false, elapsedMs: 100, redirectChain: [],
  };
}

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const originals: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) originals[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

const args = {
  prompt: 'what is the best CRM for a software agency',
  platform: 'google_ai_overview',
  locale: 'en-US',
  language: 'en',
  brandAliases: ['Tapvera', 'TapCRM'],
  domain: 'tapvera.io',
};

beforeEach(() => safeFetchMock.mockReset());

describe('SerpAPI AI Overview provider — gating', () => {
  it('returns not_configured when SERPAPI_API_KEY is missing', async () => {
    await withEnv({ SERPAPI_API_KEY: undefined }, async () => {
      const result = await createSerpApiAiOverviewProvider().observe(args);
      expect(result.state).toBe('not_configured');
      expect(safeFetchMock).not.toHaveBeenCalled();
    });
  });
});

describe('SerpAPI AI Overview provider — no overview case', () => {
  it('returns ok with empty citations when Google skipped the AI Overview', async () => {
    await withEnv({ SERPAPI_API_KEY: 'k' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({ organic_results: [{ link: 'https://example.com/' }] }));
      const result = await createSerpApiAiOverviewProvider().observe(args);
      expect(result.state).toBe('ok');
      expect(result.data?.citationUrls).toEqual([]);
      expect(result.data?.brandMentioned).toBe(false);
      expect(result.data?.domainCited).toBe(false);
      expect(result.coverage).toBe(0);
    });
  });
});

describe('SerpAPI AI Overview provider — happy path', () => {
  it('extracts citations and detects domain match', async () => {
    await withEnv({ SERPAPI_API_KEY: 'k' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({
        ai_overview: {
          text_blocks: [{ type: 'paragraph', snippet: 'Several options exist, including Tapvera and others.' }],
          references: [
            { link: 'https://tapvera.io/crm', title: 'TapCRM' },
            { link: 'https://g2.com/tapvera-review', title: 'G2 review' },
          ],
        },
      }));
      const result = await createSerpApiAiOverviewProvider().observe(args);
      expect(result.state).toBe('ok');
      expect(result.data?.domainCited).toBe(true);
      expect(result.data?.brandMentioned).toBe(true);
      expect(result.data?.citationUrls).toHaveLength(2);
    });
  });

  it('matches citations on www and subdomain variants', async () => {
    await withEnv({ SERPAPI_API_KEY: 'k' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({
        ai_overview: {
          text_blocks: [{ snippet: '...' }],
          references: [{ link: 'https://www.tapvera.io/' }, { link: 'https://blog.tapvera.io/x' }],
        },
      }));
      const result = await createSerpApiAiOverviewProvider().observe(args);
      expect(result.data?.domainCited).toBe(true);
    });
  });

  it('does not false-match on a domain that contains the brand name', async () => {
    await withEnv({ SERPAPI_API_KEY: 'k' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({
        ai_overview: {
          text_blocks: [{ snippet: '...' }],
          references: [{ link: 'https://not-tapvera-io.example.com/' }],
        },
      }));
      const result = await createSerpApiAiOverviewProvider().observe(args);
      expect(result.data?.domainCited).toBe(false);
    });
  });

  it('reports brandMentioned=null when no aliases provided', async () => {
    await withEnv({ SERPAPI_API_KEY: 'k' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({
        ai_overview: {
          text_blocks: [{ snippet: 'generic answer' }],
          references: [{ link: 'https://a.com/' }],
        },
      }));
      const result = await createSerpApiAiOverviewProvider().observe({ ...args, brandAliases: [] });
      expect(result.data?.brandMentioned).toBeNull();
    });
  });

  it('caps citation list to 20 URLs', async () => {
    await withEnv({ SERPAPI_API_KEY: 'k' }, async () => {
      const references = Array.from({ length: 50 }, (_, i) => ({ link: `https://example-${i}.com/` }));
      safeFetchMock.mockResolvedValueOnce(respond({
        ai_overview: { text_blocks: [{ snippet: '...' }], references },
      }));
      const result = await createSerpApiAiOverviewProvider().observe(args);
      expect(result.data?.citationUrls).toHaveLength(20);
    });
  });

  it('appends api_key and locale to the request', async () => {
    await withEnv({ SERPAPI_API_KEY: 'test-key' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({ ai_overview: { text_blocks: [], references: [] } }));
      await createSerpApiAiOverviewProvider().observe({ ...args, locale: 'en-GB', language: 'en' });
      const [calledUrl] = safeFetchMock.mock.calls[0]!;
      expect(calledUrl).toContain('api_key=test-key');
      expect(calledUrl).toContain('gl=gb');
      expect(calledUrl).toContain('hl=en');
    });
  });
});

describe('SerpAPI AI Overview provider — error paths', () => {
  it('returns provider_error on non-200', async () => {
    await withEnv({ SERPAPI_API_KEY: 'k' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({}, 429));
      const result = await createSerpApiAiOverviewProvider().observe(args);
      expect(result.state).toBe('provider_error');
    });
  });

  it('returns provider_error on fetch exception', async () => {
    await withEnv({ SERPAPI_API_KEY: 'k' }, async () => {
      safeFetchMock.mockRejectedValueOnce(new Error('timeout'));
      const result = await createSerpApiAiOverviewProvider().observe(args);
      expect(result.state).toBe('provider_error');
    });
  });

  it('returns provider_error when SerpAPI reports an error field', async () => {
    await withEnv({ SERPAPI_API_KEY: 'k' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({ error: 'invalid query' }));
      const result = await createSerpApiAiOverviewProvider().observe(args);
      expect(result.state).toBe('provider_error');
    });
  });
});
