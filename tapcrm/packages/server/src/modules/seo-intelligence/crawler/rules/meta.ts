/**
 * M001–M012: Meta and HTML head rules.
 * Each rule is individually testable; rules with tested=false are excluded from active evaluation.
 */
import type { RuleResult, PageObservation, RuleDefinition } from './index.js';

function pass(ruleId: string, version = 'v1'): RuleResult {
  return { ruleId, ruleVersion: version, result: 'pass', severity: 'informational', confidence: 'direct', affectedTarget: null, evidence: {}, proposedFix: null };
}

export const META_RULES: RuleDefinition[] = [
{
  ruleId: 'M001', ruleVersion: 'v1', group: 'meta', severity: 'high', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (!obs.title) {
      return { ruleId: 'M001', ruleVersion: 'v1', result: 'fail', severity: 'high', confidence: 'direct',
        affectedTarget: obs.url, evidence: { url: obs.url, observed: 'no title element' },
        proposedFix: 'Add a descriptive <title> element to the page <head>.' };
    }
    return pass('M001');
  },
},

{
  ruleId: 'M002', ruleVersion: 'v1', group: 'meta', severity: 'high', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.title !== null && obs.title.trim() === '') {
      return { ruleId: 'M002', ruleVersion: 'v1', result: 'fail', severity: 'high', confidence: 'direct',
        affectedTarget: obs.url, evidence: { url: obs.url, observed: 'empty title element' },
        proposedFix: 'Replace the empty <title> with a descriptive title for this page.' };
    }
    return pass('M002');
  },
},

{
  ruleId: 'M005', ruleVersion: 'v1', group: 'meta', severity: 'low', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.metaDescription === null) {
      return { ruleId: 'M005', ruleVersion: 'v1', result: 'review', severity: 'low', confidence: 'direct',
        affectedTarget: obs.url, evidence: { url: obs.url, observed: 'no meta description' },
        proposedFix: 'Consider adding a <meta name="description"> that summarises the page for search results.' };
    }
    return pass('M005');
  },
},

{
  ruleId: 'M006', ruleVersion: 'v1', group: 'meta', severity: 'low', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.metaDescription !== null && obs.metaDescription.trim() === '') {
      return { ruleId: 'M006', ruleVersion: 'v1', result: 'review', severity: 'low', confidence: 'direct',
        affectedTarget: obs.url, evidence: { url: obs.url, observed: 'empty meta description' },
        proposedFix: 'Fill in the empty <meta name="description"> with a page summary.' };
    }
    return pass('M006');
  },
},

{
  ruleId: 'M009', ruleVersion: 'v1', group: 'meta', severity: 'low', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (!obs.lang) {
      return { ruleId: 'M009', ruleVersion: 'v1', result: 'review', severity: 'low', confidence: 'direct',
        affectedTarget: obs.url, evidence: { url: obs.url, observed: 'no lang attribute on <html>' },
        proposedFix: 'Add a lang attribute to the <html> element, e.g. lang="en".' };
    }
    return pass('M009');
  },
},
];
