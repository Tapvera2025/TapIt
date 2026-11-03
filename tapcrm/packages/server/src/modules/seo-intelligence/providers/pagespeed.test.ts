/**
 * Response-parsing tests only. Fetch is mocked via vi.mock so these are pure.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const safeFetchMock = vi.fn();
vi.mock('../crawler/http.js', () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
  FetchError: class FetchError extends Error {},
  FetchTimeoutError: class FetchTimeoutError extends Error {},
  RedirectLoopError: class RedirectLoopError extends Error {},
}));

const { pagespeedFetch } = await import('./pagespeed.js');

function respond(body: unknown, status = 200) {
  const serialized = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    finalUrl: 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed',
    status, headers: {}, body: serialized, byteLength: serialized.length,
    truncated: false, elapsedMs: 10, redirectChain: [],
  };
}

beforeEach(() => safeFetchMock.mockReset());

describe('pagespeedFetch — happy path', () => {
  it('returns ok with a LighthouseReport and scales score from 0..1 to 0..100', async () => {
    safeFetchMock.mockResolvedValueOnce(respond({
      lighthouseResult: {
        categories: { performance: { score: 0.78 } },
        audits: {
          'largest-contentful-paint': { numericValue: 2200 },
          'total-blocking-time': { numericValue: 150 },
          'cumulative-layout-shift': { numericValue: 0.05 },
          'first-contentful-paint': { numericValue: 1100 },
          'speed-index': { numericValue: 1800 },
        },
        lighthouseVersion: '11.5.0',
        userAgent: 'Mozilla/5.0',
        fetchTime: '2026-10-25T00:00:00Z',
      },
    }));
    const result = await pagespeedFetch('https://example.com/');
    expect(result.state).toBe('ok');
    expect(result.data).toMatchObject({
      performanceScore: 78,
      lcp: 2200,
      tbt: 150,
      cls: 0.05,
      fcp: 1100,
      si: 1800,
      runnerVersion: '11.5.0',
    });
    expect(result.usage).toMatchObject({ provider: 'pagespeed', units: 1, costCents: 0 });
  });

  it('rounds the Lighthouse score to an integer 0..100', async () => {
    safeFetchMock.mockResolvedValueOnce(respond({
      lighthouseResult: {
        categories: { performance: { score: 0.8449 } },
        audits: {},
      },
    }));
    const result = await pagespeedFetch('https://example.com/');
    expect(result.state).toBe('ok');
    expect(result.data?.performanceScore).toBe(84);
  });

  it('keeps an unavailable Lighthouse score null', async () => {
    safeFetchMock.mockResolvedValueOnce(respond({
      lighthouseResult: {
        categories: { performance: { score: null } },
        audits: {},
      },
    }));
    const result = await pagespeedFetch('https://example.com/');
    expect(result.state).toBe('ok');
    expect(result.data?.performanceScore).toBeNull();
  });

  it('keeps missing audit metrics null rather than fabricating zero', async () => {
    safeFetchMock.mockResolvedValueOnce(respond({
      lighthouseResult: {
        categories: { performance: { score: 0.5 } },
        audits: {},
      },
    }));
    const result = await pagespeedFetch('https://example.com/');
    expect(result.data?.lcp).toBeNull();
    expect(result.data?.tbt).toBeNull();
    expect(result.data?.cls).toBeNull();
  });
});

describe('pagespeedFetch — error paths', () => {
  it('returns provider_error on a non-200 response', async () => {
    safeFetchMock.mockResolvedValueOnce(respond({}, 500));
    const result = await pagespeedFetch('https://example.com/');
    expect(result.state).toBe('provider_error');
    expect(result.data).toBeNull();
  });

  it('returns provider_error when safeFetch throws', async () => {
    safeFetchMock.mockRejectedValueOnce(new Error('network down'));
    const result = await pagespeedFetch('https://example.com/');
    expect(result.state).toBe('provider_error');
  });

  it('returns provider_error on malformed JSON body', async () => {
    safeFetchMock.mockResolvedValueOnce(respond('<html>not json</html>'));
    const result = await pagespeedFetch('https://example.com/');
    expect(result.state).toBe('provider_error');
  });

  it('returns provider_error when PSI reports an API error field', async () => {
    safeFetchMock.mockResolvedValueOnce(respond({
      error: { code: 400, message: 'invalid URL' },
    }));
    const result = await pagespeedFetch('https://example.com/');
    expect(result.state).toBe('provider_error');
  });

  it('returns provider_error when the performance category is missing', async () => {
    safeFetchMock.mockResolvedValueOnce(respond({
      lighthouseResult: {
        categories: {},
        audits: {},
      },
    }));
    const result = await pagespeedFetch('https://example.com/');
    expect(result.state).toBe('provider_error');
  });
});

describe('pagespeedFetch — request shape', () => {
  it('sets strategy=mobile by default', async () => {
    safeFetchMock.mockResolvedValueOnce(respond({
      lighthouseResult: { categories: { performance: { score: 0.9 } }, audits: {} },
    }));
    await pagespeedFetch('https://example.com/');
    const [calledUrl] = safeFetchMock.mock.calls[0]!;
    expect(calledUrl).toContain('strategy=mobile');
  });

  it('passes strategy=desktop when requested', async () => {
    safeFetchMock.mockResolvedValueOnce(respond({
      lighthouseResult: { categories: { performance: { score: 0.9 } }, audits: {} },
    }));
    await pagespeedFetch('https://example.com/', 'desktop');
    const [calledUrl] = safeFetchMock.mock.calls[0]!;
    expect(calledUrl).toContain('strategy=desktop');
  });

  it('appends api key when PAGESPEED_API_KEY is set', async () => {
    const original = process.env['PAGESPEED_API_KEY'];
    process.env['PAGESPEED_API_KEY'] = 'test-key-123';
    try {
      safeFetchMock.mockResolvedValueOnce(respond({
        lighthouseResult: { categories: { performance: { score: 0.9 } }, audits: {} },
      }));
      await pagespeedFetch('https://example.com/');
      const [calledUrl] = safeFetchMock.mock.calls[0]!;
      expect(calledUrl).toContain('key=test-key-123');
    } finally {
      if (original === undefined) delete process.env['PAGESPEED_API_KEY'];
      else process.env['PAGESPEED_API_KEY'] = original;
    }
  });

  it('omits the key parameter when the env is unset', async () => {
    const original = process.env['PAGESPEED_API_KEY'];
    delete process.env['PAGESPEED_API_KEY'];
    try {
      safeFetchMock.mockResolvedValueOnce(respond({
        lighthouseResult: { categories: { performance: { score: 0.9 } }, audits: {} },
      }));
      await pagespeedFetch('https://example.com/');
      const [calledUrl] = safeFetchMock.mock.calls[0]!;
      expect(calledUrl).not.toContain('key=');
    } finally {
      if (original !== undefined) process.env['PAGESPEED_API_KEY'] = original;
    }
  });
});
