/**
 * C001–C010: Canonicalization rules.
 */
import type { RuleResult, PageObservation, RuleDefinition } from './index.js';

function pass(ruleId: string): RuleResult {
  return { ruleId, ruleVersion: 'v1', result: 'pass', severity: 'informational', confidence: 'direct', affectedTarget: null, evidence: {}, proposedFix: null };
}

function isValidUrl(href: string): boolean {
  try { new URL(href); return true; } catch { return false; }
}

export const CANONICALIZATION_RULES: RuleDefinition[] = [
{
  ruleId: 'C001', ruleVersion: 'v1', group: 'canonicalization', severity: 'high', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    const canonical = obs.canonicalLink ?? obs.canonicalHeader;
    if (canonical && !isValidUrl(canonical)) {
      return { ruleId: 'C001', ruleVersion: 'v1', result: 'fail', severity: 'high', confidence: 'direct',
        affectedTarget: obs.url, evidence: { url: obs.url, canonical },
        proposedFix: 'Replace the malformed canonical URL with an absolute, valid URL.' };
    }
    return pass('C001');
  },
},

{
  ruleId: 'C002', ruleVersion: 'v1', group: 'canonicalization', severity: 'high', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.canonicalLink && obs.canonicalHeader && obs.canonicalLink !== obs.canonicalHeader) {
      return { ruleId: 'C002', ruleVersion: 'v1', result: 'fail', severity: 'high', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, html_canonical: obs.canonicalLink, header_canonical: obs.canonicalHeader },
        proposedFix: 'Ensure the <link rel="canonical"> in the HTML and the Link: response header agree on the same canonical URL.' };
    }
    return pass('C002');
  },
},

{
  ruleId: 'C008', ruleVersion: 'v1', group: 'canonicalization', severity: 'high', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    // Alias for C002 — detect HTML vs header mismatch in either render mode
    if (obs.renderMode !== 'both') return { ...pass('C008'), result: 'skipped' };
    if (obs.rawContentHash !== obs.renderedContentHash) {
      return { ruleId: 'C008', ruleVersion: 'v1', result: 'review', severity: 'high', confidence: 'inferred',
        affectedTarget: obs.url,
        evidence: { url: obs.url, raw_hash: obs.rawContentHash, rendered_hash: obs.renderedContentHash },
        proposedFix: 'Review the raw vs rendered HTML diff for changes to canonical or meta robots directives introduced by JavaScript.' };
    }
    return pass('C008');
  },
},
];
