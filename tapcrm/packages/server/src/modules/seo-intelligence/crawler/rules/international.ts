/**
 * G001–G010: Internationalisation / hreflang rules.
 */
import type { RuleResult, PageObservation, RuleDefinition } from './index.js';

function pass(ruleId: string): RuleResult {
  return { ruleId, ruleVersion: 'v1', result: 'pass', severity: 'informational', confidence: 'direct', affectedTarget: null, evidence: {}, proposedFix: null };
}

export const INTERNATIONAL_RULES: RuleDefinition[] = [
{
  ruleId: 'G001', ruleVersion: 'v1', group: 'international', severity: 'high', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    const bad = obs.hreflangTags.filter((tag) => !tag.hrefIsAbsolute);
    if (bad.length > 0) {
      return { ruleId: 'G001', ruleVersion: 'v1', result: 'fail', severity: 'high', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, relative_hreflang: bad.map((t) => t.href) },
        proposedFix: 'hreflang href values must be absolute URLs. Replace relative URLs with their fully-qualified equivalents.' };
    }
    return pass('G001');
  },
},

{
  ruleId: 'G002', ruleVersion: 'v1', group: 'international', severity: 'low', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.hreflangTags.length > 0 && !obs.hreflangHasXDefault) {
      return { ruleId: 'G002', ruleVersion: 'v1', result: 'review', severity: 'low', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, hreflang_count: obs.hreflangTags.length },
        proposedFix: 'hreflang set is missing an x-default tag. Add <link rel="alternate" hreflang="x-default" href="..."> to indicate the fallback locale page.' };
    }
    return pass('G002');
  },
},

{
  ruleId: 'G003', ruleVersion: 'v1', group: 'international', severity: 'moderate', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    const invalid = obs.hreflangTags.filter((tag) => !tag.langIsValid);
    if (invalid.length > 0) {
      return { ruleId: 'G003', ruleVersion: 'v1', result: 'fail', severity: 'moderate', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, invalid_langs: invalid.map((t) => t.hreflang) },
        proposedFix: 'Invalid hreflang language codes detected. Use BCP 47 codes (e.g., en, en-US, pt-BR). Google ignores hreflang annotations it cannot parse.' };
    }
    return pass('G003');
  },
},

{
  ruleId: 'G005', ruleVersion: 'v1', group: 'international', severity: 'high', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.hreflangMissingReturn) {
      return { ruleId: 'G005', ruleVersion: 'v1', result: 'fail', severity: 'high', confidence: 'inferred',
        affectedTarget: obs.url,
        evidence: { url: obs.url, missing_return_links: obs.hreflangMissingReturnLocales ?? [] },
        proposedFix: 'Reciprocal hreflang links are missing. Each page in a hreflang cluster must link back to all other locales in the set.' };
    }
    return pass('G005');
  },
},

{
  ruleId: 'G007', ruleVersion: 'v1', group: 'international', severity: 'low', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.hreflangTags.length > 0) {
      const inconsistentCanon = obs.hreflangTags.some(
        (tag) => tag.href === obs.url && obs.canonicalLink && obs.canonicalLink !== obs.url,
      );
      if (inconsistentCanon) {
        return { ruleId: 'G007', ruleVersion: 'v1', result: 'review', severity: 'low', confidence: 'inferred',
          affectedTarget: obs.url,
          evidence: { url: obs.url, canonical: obs.canonicalLink },
          proposedFix: 'hreflang points to this URL but the canonical points elsewhere. hreflang and canonical signals may conflict; align them.' };
      }
    }
    return pass('G007');
  },
},
];
