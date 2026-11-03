/**
 * S001–S010: Sitemap rules.
 */
import type { RuleResult, PageObservation, RuleDefinition } from './index.js';

function pass(ruleId: string): RuleResult {
  return { ruleId, ruleVersion: 'v1', result: 'pass', severity: 'informational', confidence: 'direct', affectedTarget: null, evidence: {}, proposedFix: null };
}

export const SITEMAPS_RULES: RuleDefinition[] = [
{
  ruleId: 'S001', ruleVersion: 'v1', group: 'sitemaps', severity: 'high', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (!obs.isPriority) return { ...pass('S001'), result: 'skipped' };
    if (obs.inSitemap === false) {
      return { ruleId: 'S001', ruleVersion: 'v1', result: 'fail', severity: 'high', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, in_sitemap: false },
        proposedFix: 'Add this priority URL to the XML sitemap so search engines can discover and schedule it for crawling.' };
    }
    return pass('S001');
  },
},

{
  ruleId: 'S002', ruleVersion: 'v1', group: 'sitemaps', severity: 'moderate', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    const hasNoindex = obs.metaRobots !== null && /noindex/i.test(obs.metaRobots);
    if (obs.inSitemap && hasNoindex) {
      return { ruleId: 'S002', ruleVersion: 'v1', result: 'fail', severity: 'moderate', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, in_sitemap: true, meta_robots: obs.metaRobots },
        proposedFix: 'A noindexed URL in the sitemap sends a conflicting signal. Remove it from the sitemap or remove the noindex directive.' };
    }
    return pass('S002');
  },
},

{
  ruleId: 'S003', ruleVersion: 'v1', group: 'sitemaps', severity: 'moderate', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.inSitemap && obs.httpStatus !== null && obs.httpStatus >= 300) {
      return { ruleId: 'S003', ruleVersion: 'v1', result: 'fail', severity: 'moderate', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, status: obs.httpStatus, in_sitemap: true },
        proposedFix: `Sitemap contains a URL that returns HTTP ${obs.httpStatus}. Sitemaps should only include canonical, indexable 200-status URLs.` };
    }
    return pass('S003');
  },
},

{
  ruleId: 'S005', ruleVersion: 'v1', group: 'sitemaps', severity: 'low', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.sitemapLastmodAge !== null && obs.sitemapLastmodAge > 365) {
      return { ruleId: 'S005', ruleVersion: 'v1', result: 'review', severity: 'low', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, lastmod_days_ago: obs.sitemapLastmodAge },
        proposedFix: `Sitemap <lastmod> for this URL is ${obs.sitemapLastmodAge} days old. Update it to the actual last-modified date so crawlers know to re-fetch the page.` };
    }
    return pass('S005');
  },
},
];
