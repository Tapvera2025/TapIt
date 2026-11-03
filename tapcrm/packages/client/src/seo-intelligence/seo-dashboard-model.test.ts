import { describe, expect, it } from 'vitest';
import {
  searchTrafficModel,
  latestRankObservations,
  publicWebsiteUrl,
} from './seo-dashboard-model.js';
import { SEO_TABS, seoTabForSection, moveTabIndex } from './seo-navigation.js';
import type { SeoGscMetrics, SeoSerpObservation } from './types.js';

describe('SEO dashboard meaning', () => {
  it('combines daily query rows and weights average positions by impressions', () => {
    const base: SeoGscMetrics = {
      date: '2026-10-24',
      searchType: 'web',
      query: 'website check',
      page: null,
      country: 'ind',
      device: 'mobile',
      clicks: 5,
      impressions: 10,
      avgPosition: 2,
      ctr: null,
      dataComplete: true,
      rowLimitHit: false,
    };
    const result = searchTrafficModel([
      base,
      { ...base, date: '2026-10-25', clicks: 15, impressions: 90, avgPosition: 10 },
      { ...base, query: null, clicks: 0, impressions: 0, avgPosition: null },
    ]);
    expect(result.clicks).toBe(20);
    expect(result.impressions).toBe(100);
    expect(result.ctr).toBe(20);
    expect(result.daily).toHaveLength(2);
    expect(result.queries[0]!.positionSum / result.queries[0]!.positionWeight).toBe(9.2);
    expect(searchTrafficModel([]).ctr).toBeNull();
  });
  it('does not count old rank history as additional currently ranked terms', () => {
    const base: SeoSerpObservation = {
      id: 'old',
      keywordId: 'keyword',
      engine: 'google',
      country: 'in',
      device: 'mobile',
      provider: 'test',
      query: 'example',
      organicRank: 1,
      observedUrl: null,
      resultType: null,
      snapshotComplete: true,
      state: 'observed',
      observedAt: new Date('2026-10-24'),
    };
    const rows = latestRankObservations([
      base,
      {
        ...base,
        id: 'new',
        organicRank: null,
        state: 'not_observed',
        observedAt: new Date('2026-10-25'),
      },
      { ...base, id: 'desktop', device: 'desktop', organicRank: 4 },
    ]);
    expect(rows.map((row) => row.id)).toEqual(['desktop', 'new']);
  });
  it('keeps only public web schemes in imported links', () => {
    expect(publicWebsiteUrl('javascript:alert(1)')).toBeUndefined();
    expect(publicWebsiteUrl('file:///etc/passwd')).toBeUndefined();
    expect(publicWebsiteUrl('https://example.com/page')).toBe('https://example.com/page');
  });
  it('keeps all existing SEO tools reachable through five tabs', () => {
    expect(SEO_TABS).toHaveLength(6);
    expect(
      new Set(SEO_TABS.flatMap((tab) => tab.sections.map((section) => section.id))).size,
    ).toBe(15);
    expect(seoTabForSection('performance').id).toBe('website');
    expect(seoTabForSection('backlinks').id).toBe('visibility');
    expect(moveTabIndex(4, 'ArrowRight', 5)).toBe(0);
    expect(moveTabIndex(0, 'ArrowLeft', 5)).toBe(4);
    expect(moveTabIndex(2, 'Home', 5)).toBe(0);
    expect(moveTabIndex(2, 'End', 5)).toBe(4);
  });
});
