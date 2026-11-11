/**
 * Response-parsing tests for the Perplexity AI-visibility provider.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const safeFetchMock = vi.fn();
vi.mock('../crawler/http.js', () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
  FetchError: class FetchError extends Error {},
  FetchTimeoutError: class FetchTimeoutError extends Error {},
  RedirectLoopError: class RedirectLoopError extends Error {},
}));

const { createPerplexityProvider } = await import('./perplexity.js');

function respond(body: unknown, status = 200) {
  const serialized = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    finalUrl: 'https://api.perplexity.ai/chat/completions',
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
  prompt: 'What are the best CRM platforms for small business?',
  platform: 'perplexity',
  locale: 'en-US',
  language: 'en',
  brandAliases: ['Tapvera', 'TapCRM'],
  domain: 'tapvera.io',
};

beforeEach(() => safeFetchMock.mockReset());

describe('perplexity provider — gating', () => {
  it('returns not_configured when PERPLEXITY_API_KEY is missing', async () => {
    await withEnv({ PERPLEXITY_API_KEY: undefined }, async () => {
      const result = await createPerplexityProvider().observe(args);
      expect(result.state).toBe('not_configured');
      expect(safeFetchMock).not.toHaveBeenCalled();
    });
  });
});

describe('perplexity provider — happy path', () => {
  it('detects a cited domain (exact host match)', async () => {
    await withEnv({ PERPLEXITY_API_KEY: 'key' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({
        choices: [{ message: { content: 'Tapvera is a good option…' } }],
        citations: ['https://tapvera.io/services', 'https://other.com/x'],
      }));
      const result = await createPerplexityProvider().observe(args);
      expect(result.state).toBe('ok');
      expect(result.data?.domainCited).toBe(true);
      expect(result.data?.citationUrls).toContain('https://tapvera.io/services');
    });
  });

  it('matches citations on www- and subdomain variants', async () => {
    await withEnv({ PERPLEXITY_API_KEY: 'key' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({
        choices: [{ message: { content: '…' } }],
        citations: ['https://www.tapvera.io/', 'https://blog.tapvera.io/post-1'],
      }));
      const result = await createPerplexityProvider().observe(args);
      expect(result.data?.domainCited).toBe(true);
    });
  });

  it('does not false-match on a different domain containing the brand', async () => {
    await withEnv({ PERPLEXITY_API_KEY: 'key' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({
        choices: [{ message: { content: '…' } }],
        citations: ['https://not-tapvera-io.example.com/x'],
      }));
      const result = await createPerplexityProvider().observe(args);
      expect(result.data?.domainCited).toBe(false);
    });
  });

  it('detects brand mention in the answer text (case-insensitive)', async () => {
    await withEnv({ PERPLEXITY_API_KEY: 'key' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({
        choices: [{ message: { content: 'tapvera and other platforms stand out.' } }],
        citations: [],
      }));
      const result = await createPerplexityProvider().observe(args);
      expect(result.data?.brandMentioned).toBe(true);
    });
  });

  it('reports brandMentioned=null when no aliases provided', async () => {
    await withEnv({ PERPLEXITY_API_KEY: 'key' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({
        choices: [{ message: { content: 'answer here' } }],
        citations: [],
      }));
      const result = await createPerplexityProvider().observe({ ...args, brandAliases: [] });
      expect(result.data?.brandMentioned).toBeNull();
    });
  });

  it('caps citation list to 20 URLs', async () => {
    await withEnv({ PERPLEXITY_API_KEY: 'key' }, async () => {
      const citations = Array.from({ length: 50 }, (_, i) => `https://example-${i}.com/`);
      safeFetchMock.mockResolvedValueOnce(respond({
        choices: [{ message: { content: '…' } }],
        citations,
      }));
      const result = await createPerplexityProvider().observe(args);
      expect(result.data?.citationUrls).toHaveLength(20);
    });
  });

  it('sends bearer auth header', async () => {
    await withEnv({ PERPLEXITY_API_KEY: 'test-pplx-key' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({ choices: [{ message: { content: '' } }], citations: [] }));
      await createPerplexityProvider().observe(args);
      const [, opts] = safeFetchMock.mock.calls[0]!;
      const headers = (opts as { headers: Record<string, string> }).headers;
      expect(headers['authorization']).toBe('Bearer test-pplx-key');
    });
  });

  it('respects SEO_PERPLEXITY_MODEL env for model selection', async () => {
    await withEnv({ PERPLEXITY_API_KEY: 'k', SEO_PERPLEXITY_MODEL: 'sonar-pro' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({ choices: [{ message: { content: '' } }], citations: [] }));
      await createPerplexityProvider().observe(args);
      const [, opts] = safeFetchMock.mock.calls[0]!;
      const body = JSON.parse((opts as { body: string }).body);
      expect(body.model).toBe('sonar-pro');
    });
  });
});

describe('perplexity provider — error paths', () => {
  it('returns provider_error on non-200', async () => {
    await withEnv({ PERPLEXITY_API_KEY: 'k' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({}, 429));
      const result = await createPerplexityProvider().observe(args);
      expect(result.state).toBe('provider_error');
    });
  });

  it('returns provider_error on fetch exception', async () => {
    await withEnv({ PERPLEXITY_API_KEY: 'k' }, async () => {
      safeFetchMock.mockRejectedValueOnce(new Error('timeout'));
      const result = await createPerplexityProvider().observe(args);
      expect(result.state).toBe('provider_error');
    });
  });

  it('returns provider_error on API error field', async () => {
    await withEnv({ PERPLEXITY_API_KEY: 'k' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({ error: { message: 'rate limited' } }));
      const result = await createPerplexityProvider().observe(args);
      expect(result.state).toBe('provider_error');
    });
  });

  it('returns provider_error on malformed JSON', async () => {
    await withEnv({ PERPLEXITY_API_KEY: 'k' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond('not json'));
      const result = await createPerplexityProvider().observe(args);
      expect(result.state).toBe('provider_error');
    });
  });
});
