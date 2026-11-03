/**
 * A001–A010: Image / media rules.
 */
import type { RuleResult, PageObservation, RuleDefinition } from './index.js';

function pass(ruleId: string): RuleResult {
  return { ruleId, ruleVersion: 'v1', result: 'pass', severity: 'informational', confidence: 'direct', affectedTarget: null, evidence: {}, proposedFix: null };
}

export const IMAGES_RULES: RuleDefinition[] = [
{
  ruleId: 'A001', ruleVersion: 'v1', group: 'images', severity: 'moderate', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    const missingAlt = obs.images.filter((img) => img.alt === null || img.alt === undefined);
    if (missingAlt.length > 0) {
      return { ruleId: 'A001', ruleVersion: 'v1', result: 'fail', severity: 'moderate', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, images_missing_alt: missingAlt.map((img) => img.src).slice(0, 20) },
        proposedFix: 'Add descriptive alt attributes to all informational images. Decorative images should have an empty alt="" attribute.' };
    }
    return pass('A001');
  },
},

{
  ruleId: 'A002', ruleVersion: 'v1', group: 'images', severity: 'low', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    const emptyAlt = obs.images.filter((img) => img.alt !== null && img.alt !== undefined && img.alt.trim() === '' && !img.isDecorative);
    if (emptyAlt.length > 0) {
      return { ruleId: 'A002', ruleVersion: 'v1', result: 'review', severity: 'low', confidence: 'inferred',
        affectedTarget: obs.url,
        evidence: { url: obs.url, images_empty_alt: emptyAlt.map((img) => img.src).slice(0, 20) },
        proposedFix: 'Some images have empty alt attributes but appear to be informational. Add descriptive alt text or confirm they are purely decorative.' };
    }
    return pass('A002');
  },
},

{
  ruleId: 'A003', ruleVersion: 'v1', group: 'images', severity: 'low', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    const oversized = obs.images.filter((img) => img.fileSizeBytes !== null && img.fileSizeBytes > 500_000);
    if (oversized.length > 0) {
      return { ruleId: 'A003', ruleVersion: 'v1', result: 'review', severity: 'low', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, oversized_images: oversized.map((img) => ({ src: img.src, size_kb: Math.round((img.fileSizeBytes ?? 0) / 1024) })).slice(0, 10) },
        proposedFix: 'Compress images larger than 500 KB. Use modern formats (WebP, AVIF) and appropriate dimensions to reduce LCP times.' };
    }
    return pass('A003');
  },
},

{
  ruleId: 'A005', ruleVersion: 'v1', group: 'images', severity: 'low', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    const noLazyLCP = obs.images.filter(
      (img) => img.isLikelyLCP && img.loading === 'lazy',
    );
    if (noLazyLCP.length > 0) {
      return { ruleId: 'A005', ruleVersion: 'v1', result: 'fail', severity: 'low', confidence: 'inferred',
        affectedTarget: obs.url,
        evidence: { url: obs.url, lcp_images_lazy: noLazyLCP.map((img) => img.src).slice(0, 5) },
        proposedFix: 'Remove loading="lazy" from images that are likely the LCP element. Lazy-loading the LCP image delays it and hurts Core Web Vitals.' };
    }
    return pass('A005');
  },
},
];
