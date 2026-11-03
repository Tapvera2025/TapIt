import type { SeoGscMetrics, SeoSerpObservation } from './types.js';

export function searchTrafficModel(metrics: SeoGscMetrics[]) {
  const daily = new Map<string, { day: string; clicks: number; impressions: number }>();
  const queries = new Map<
    string,
    {
      query: string;
      clicks: number;
      impressions: number;
      positionSum: number;
      positionWeight: number;
    }
  >();
  let clicks = 0;
  let impressions = 0;
  for (const row of metrics) {
    clicks += row.clicks;
    impressions += row.impressions;
    const day = row.date.slice(0, 10);
    const dailyRow = daily.get(day) ?? { day, clicks: 0, impressions: 0 };
    dailyRow.clicks += row.clicks;
    dailyRow.impressions += row.impressions;
    daily.set(day, dailyRow);
    if (!row.query) continue;
    const query = queries.get(row.query) ?? {
      query: row.query,
      clicks: 0,
      impressions: 0,
      positionSum: 0,
      positionWeight: 0,
    };
    query.clicks += row.clicks;
    query.impressions += row.impressions;
    if (row.avgPosition !== null && row.impressions > 0) {
      query.positionSum += row.avgPosition * row.impressions;
      query.positionWeight += row.impressions;
    }
    queries.set(row.query, query);
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    queries: [...queries.values()].sort(
      (a, b) => b.clicks - a.clicks || b.impressions - a.impressions,
    ),
  };
}

/** One current observation per search term, country, device and engine. */
export function latestRankObservations(rows: SeoSerpObservation[]) {
  const latest = new Map<string, SeoSerpObservation>();
  for (const row of rows) {
    const key = JSON.stringify([row.keywordId, row.country, row.device, row.engine]);
    const previous = latest.get(key);
    if (
      !previous ||
      new Date(row.observedAt).getTime() > new Date(previous.observedAt).getTime()
    )
      latest.set(key, row);
  }
  return [...latest.values()].sort(
    (a, b) => (a.organicRank ?? Infinity) - (b.organicRank ?? Infinity),
  );
}

export function publicWebsiteUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
