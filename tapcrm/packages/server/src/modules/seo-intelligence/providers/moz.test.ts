/**
 * Response-parsing tests for the Moz Links API provider. Fetch is mocked.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const safeFetchMock = vi.fn();
vi.mock('../crawler/http.js', () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
  FetchError: class FetchError extends Error {},
  FetchTimeoutError: class FetchTimeoutError extends Error {},
  RedirectLoopError: class RedirectLoopError extends Error {},
}));

const { mozFetchBacklinks } = await import('./moz.js');

function respond(body: unknown, status = 200) {
  const serialized = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    finalUrl: 'https://lsapi.seomoz.com/v2/links',
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

beforeEach(() => safeFetchMock.mockReset());

describe('mozFetchBacklinks — gating', () => {
  it('returns not_configured when MOZ_ACCESS_ID is missing', async () => {
    await withEnv({ MOZ_ACCESS_ID: undefined, MOZ_SECRET_KEY: 'secret' }, async () => {
      const result = await mozFetchBacklinks('example.com');
      expect(result.state).toBe('not_configured');
      expect(result.data).toBeNull();
      expect(safeFetchMock).not.toHaveBeenCalled();
    });
  });

  it('returns not_configured when MOZ_SECRET_KEY is missing', async () => {
    await withEnv({ MOZ_ACCESS_ID: 'id', MOZ_SECRET_KEY: undefined }, async () => {
      const result = await mozFetchBacklinks('example.com');
      expect(result.state).toBe('not_configured');
      expect(safeFetchMock).not.toHaveBeenCalled();
    });
  });
});

describe('mozFetchBacklinks — happy path', () => {
  it('maps a Moz response into BacklinkPage shape', async () => {
    await withEnv({ MOZ_ACCESS_ID: 'id', MOZ_SECRET_KEY: 'secret' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({
        results: [
          {
            source: {
              page: 'https://news.example.com/story-1',
              root_domain: 'news.example.com',
              page_authority: 50,
              domain_authority: 65,
            },
            target: { page: 'https://tapvera.io/' },
            anchor_text: 'tapvera technologies',
            rel_canonical: null,
            flags: [],
            first_seen: '2024-05-01',
            last_seen: '2026-10-20',
          },
          {
            source: {
              page: 'https://directory.example.org/listings/tapvera',
              root_domain: 'directory.example.org',
              page_authority: 20,
              domain_authority: 32,
            },
            target: { page: 'https://tapvera.io/services' },
            anchor_text: 'Tapvera',
            rel_canonical: null,
            flags: ['nofollow'],
            first_seen: '2024-06-15',
            last_seen: '2026-10-20',
          },
        ],
        next_token: 'cursor-xyz',
      }));

      const result = await mozFetchBacklinks('tapvera.io');
      expect(result.state).toBe('ok');
      expect(result.data?.links).toHaveLength(2);
      expect(result.data?.links[0]).toMatchObject({
        sourceUrl: 'https://news.example.com/story-1',
        sourceDomain: 'news.example.com',
        anchorText: 'tapvera technologies',
        relValues: [],
        domainAuthority: 65,
      });
      expect(result.data?.links[1]!.relValues).toContain('nofollow');
      expect(result.data?.cursor).toBe('cursor-xyz');
    });
  });

  it('passes source_cursor on paginated calls', async () => {
    await withEnv({ MOZ_ACCESS_ID: 'id', MOZ_SECRET_KEY: 'secret' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({ results: [], next_token: null }));
      await mozFetchBacklinks('tapvera.io', 'opaque-cursor');
      const [, opts] = safeFetchMock.mock.calls[0]!;
      const body = JSON.parse((opts as { body: string }).body);
      expect(body.source_cursor).toBe('opaque-cursor');
    });
  });

  it('sends basic auth from env credentials', async () => {
    await withEnv({ MOZ_ACCESS_ID: 'moz-id', MOZ_SECRET_KEY: 'moz-secret' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({ results: [] }));
      await mozFetchBacklinks('tapvera.io');
      const [, opts] = safeFetchMock.mock.calls[0]!;
      const headers = (opts as { headers: Record<string, string> }).headers;
      expect(headers['authorization']).toBe(`Basic ${Buffer.from('moz-id:moz-secret').toString('base64')}`);
    });
  });

  it('handles null domain_authority gracefully', async () => {
    await withEnv({ MOZ_ACCESS_ID: 'id', MOZ_SECRET_KEY: 'secret' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({
        results: [{
          source: { page: 'https://x.com/', root_domain: 'x.com', page_authority: 0, domain_authority: null as unknown as number },
          target: { page: 'https://tapvera.io/' },
          anchor_text: '', rel_canonical: null, flags: [], first_seen: null, last_seen: '2026-10-20',
        }],
      }));
      const result = await mozFetchBacklinks('tapvera.io');
      expect(result.data?.links[0]!.domainAuthority).toBeNull();
      expect(result.data?.links[0]!.anchorText).toBeNull();
    });
  });
});

describe('mozFetchBacklinks — error paths', () => {
  it('returns provider_error on non-200', async () => {
    await withEnv({ MOZ_ACCESS_ID: 'id', MOZ_SECRET_KEY: 'secret' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({}, 429));
      const result = await mozFetchBacklinks('tapvera.io');
      expect(result.state).toBe('provider_error');
    });
  });

  it('returns provider_error on fetch exception', async () => {
    await withEnv({ MOZ_ACCESS_ID: 'id', MOZ_SECRET_KEY: 'secret' }, async () => {
      safeFetchMock.mockRejectedValueOnce(new Error('timeout'));
      const result = await mozFetchBacklinks('tapvera.io');
      expect(result.state).toBe('provider_error');
    });
  });

  it('returns provider_error on malformed JSON', async () => {
    await withEnv({ MOZ_ACCESS_ID: 'id', MOZ_SECRET_KEY: 'secret' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond('not json'));
      const result = await mozFetchBacklinks('tapvera.io');
      expect(result.state).toBe('provider_error');
    });
  });

  it('returns provider_error when API reports error_message', async () => {
    await withEnv({ MOZ_ACCESS_ID: 'id', MOZ_SECRET_KEY: 'secret' }, async () => {
      safeFetchMock.mockResolvedValueOnce(respond({ error_message: 'rate limited' }));
      const result = await mozFetchBacklinks('tapvera.io');
      expect(result.state).toBe('provider_error');
    });
  });
});
