export type AdvertisingProvider = 'google_ads' | 'meta_ads' | 'manual';

export interface NormalizedSpend {
  readonly externalSpendId: string;
  readonly spendDate: string;
  readonly campaignName: string | null;
  readonly amount: string;
  readonly currency: string;
  readonly rawPayload: unknown;
}

export interface AdvertisingAdapter {
  readonly provider: AdvertisingProvider;
  fetchSpend(input: { externalAccountId: string; credentials: Record<string, string>; periodStart: string; periodEnd: string }): Promise<readonly NormalizedSpend[]>;
}

export function adapterFor(provider: AdvertisingProvider): AdvertisingAdapter {
  if (provider === 'google_ads') return googleAdsAdapter;
  if (provider === 'meta_ads') return metaAdsAdapter;
  return manualAdapter;
}

async function fetchWithTimeout(input: string | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try { return await fetch(input, { ...init, signal: controller.signal }); } finally { clearTimeout(timer); }
}

const manualAdapter: AdvertisingAdapter = {
  provider: 'manual',
  async fetchSpend() {
    throw new Error('Manual advertising accounts use CSV/manual spend entry and cannot sync remotely.');
  },
};

const googleAdsAdapter: AdvertisingAdapter = {
  provider: 'google_ads',
  async fetchSpend({ externalAccountId, credentials, periodStart, periodEnd }) {
    if (!credentials['accessToken'] || !credentials['developerToken']) throw new Error('Google Ads requires accessToken and developerToken credentials.');
    const response = await fetchWithTimeout(`https://googleads.googleapis.com/v18/customers/${encodeURIComponent(externalAccountId)}:searchStream`, {
      method: 'POST',
      headers: { authorization: `Bearer ${credentials['accessToken'] ?? ''}`, 'developer-token': credentials['developerToken'] ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({ query: `SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, customer.currency_code FROM campaign WHERE segments.date BETWEEN '${periodStart}' AND '${periodEnd}'` }),
    });
    if (!response.ok) throw new Error(`Google Ads spend sync failed with status ${response.status}.`);
    const payload = (await response.json()) as Array<{ results?: Array<{ segments?: { date?: string }; campaign?: { id?: string; name?: string }; metrics?: { costMicros?: string }; customer?: { currencyCode?: string } }> }>;
    return payload.flatMap((batch) => (batch.results ?? []).map((item) => ({ externalSpendId: `${item.campaign?.id ?? 'campaign'}:${item.segments?.date ?? periodStart}`, spendDate: item.segments?.date ?? periodStart, campaignName: item.campaign?.name ?? null, amount: (Number(item.metrics?.costMicros ?? '0') / 1000000).toFixed(2), currency: item.customer?.currencyCode ?? 'INR', rawPayload: item })));
  },
};

const metaAdsAdapter: AdvertisingAdapter = {
  provider: 'meta_ads',
  async fetchSpend({ externalAccountId, credentials, periodStart, periodEnd }) {
    const params = new URLSearchParams({ fields: 'date_start,campaign_id,campaign_name,spend,account_currency', time_range: JSON.stringify({ since: periodStart, until: periodEnd }), access_token: credentials['accessToken'] ?? '' });
    if (!credentials['accessToken']) throw new Error('Meta Ads requires an accessToken credential.');
    const response = await fetchWithTimeout(`https://graph.facebook.com/v20.0/${encodeURIComponent(externalAccountId)}/insights?${params.toString()}`, {});
    if (!response.ok) throw new Error(`Meta Ads spend sync failed with status ${response.status}.`);
    const payload = (await response.json()) as { data?: Array<{ date_start?: string; campaign_id?: string; campaign_name?: string; spend?: string; account_currency?: string }> };
    return (payload.data ?? []).map((item) => ({ externalSpendId: `${item.campaign_id ?? 'campaign'}:${item.date_start ?? periodStart}`, spendDate: item.date_start ?? periodStart, campaignName: item.campaign_name ?? null, amount: item.spend ?? '0', currency: item.account_currency ?? 'INR', rawPayload: item }));
  },
};
