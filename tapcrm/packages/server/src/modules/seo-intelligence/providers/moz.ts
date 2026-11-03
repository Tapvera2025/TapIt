/**
 * Moz Links API v2 provider — paid, requires MOZ_ACCESS_ID + MOZ_SECRET_KEY.
 * Returns state='not_configured' when either is missing so the Backlinks panel
 * can report "provider not set up" rather than silently blank.
 *
 * Docs: https://moz.com/help/links-api/
 * Endpoint used:  POST https://lsapi.seomoz.com/v2/links
 * Auth:           HTTP Basic (access_id : secret_key)
 */
import { safeFetch } from '../crawler/http.js';
import type { SeoProviderResult, SeoProvenance, BacklinkPage } from './types.js';

const MOZ_ENDPOINT = 'https://lsapi.seomoz.com/v2/links';

const PROVENANCE: SeoProvenance = {
  source: 'moz',
  retrievedAt: '',
  dataAsOf: null,
  confidence: 'direct',
  isPaid: true,
};

interface MozLinkRow {
  source: {
    page: string;
    root_domain: string;
    page_authority: number;
    domain_authority: number;
  };
  target: { page: string };
  anchor_text: string;
  rel_canonical: string | null;
  flags: string[]; // e.g. ["nofollow", "ugc", "sponsored"]
  first_seen: string | null;
  last_seen: string;
}

interface MozResponse {
  results?: MozLinkRow[];
  next_token?: string;
  error_message?: string;
}

/**
 * Fetches backlinks pointing at `targetDomain`. One request = up to 50 rows
 * (Moz's documented default). Call again with the returned cursor for more.
 */
export async function mozFetchBacklinks(
  targetDomain: string,
  cursor?: string,
): Promise<SeoProviderResult<BacklinkPage>> {
  const accessId = process.env['MOZ_ACCESS_ID'];
  const secretKey = process.env['MOZ_SECRET_KEY'];
  if (!accessId || !secretKey) {
    return notConfigured();
  }

  const start = Date.now();
  const body = {
    target: targetDomain,
    target_scope: 'root_domain',
    source_scope: 'page',
    limit: 50,
    ...(cursor ? { source_cursor: cursor } : {}),
  };

  let result;
  try {
    result = await safeFetch(MOZ_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from(`${accessId}:${secretKey}`).toString('base64')}`,
      },
      body: JSON.stringify(body),
      timeoutMs: 30_000,
    });
  } catch {
    return providerError();
  }
  if (result.status !== 200) return providerError();

  let json: MozResponse;
  try { json = JSON.parse(result.body); } catch { return providerError(); }
  if (json.error_message || !Array.isArray(json.results)) return providerError();

  const links = json.results.map((row) => ({
    sourceUrl: row.source.page,
    sourceDomain: row.source.root_domain,
    targetUrl: row.target.page,
    anchorText: row.anchor_text || null,
    relValues: Array.isArray(row.flags) ? row.flags : [],
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    domainAuthority: typeof row.source.domain_authority === 'number' ? Math.round(row.source.domain_authority) : null,
  }));

  return {
    state: 'ok',
    data: {
      links,
      cursor: json.next_token ?? null,
      totalEstimate: null,
    },
    provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
    coverage: links.length,
    usage: {
      provider: 'moz',
      operation: 'links.list',
      units: 1,
      unitType: 'queries',
      // Moz prices per row, roughly $0.001 per link row at the lowest tier.
      // Approximate for cost tracking; actual billing is on their dashboard.
      costCents: Math.ceil(links.length / 10),
      elapsedMs: Date.now() - start,
    },
  };
}

function notConfigured(): SeoProviderResult<BacklinkPage> {
  return {
    state: 'not_configured',
    data: null,
    provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
    coverage: null,
    usage: null,
  };
}

function providerError(): SeoProviderResult<BacklinkPage> {
  return {
    state: 'provider_error',
    data: null,
    provenance: { ...PROVENANCE, retrievedAt: new Date().toISOString() },
    coverage: null,
    usage: null,
  };
}
