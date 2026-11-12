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
    // Rendering is expected to change the page. What matters is JavaScript
    // changing the directives search engines act on.
    const raw = obs.rawSignals;
    if (obs.renderMode !== 'both' || raw === null) return { ...pass('C008'), result: 'skipped' };
    const norm = (value: string | null) => (value ?? '').trim().toLowerCase();
    const changes: Record<string, { raw: string | null; rendered: string | null }> = {};
    if (norm(raw.canonicalLink) !== norm(obs.canonicalLink)) changes['canonical'] = { raw: raw.canonicalLink, rendered: obs.canonicalLink };
    if (norm(raw.metaRobots) !== norm(obs.metaRobots)) changes['meta_robots'] = { raw: raw.metaRobots, rendered: obs.metaRobots };
    if (Object.keys(changes).length > 0) {
      return { ruleId: 'C008', ruleVersion: 'v1', result: 'review', severity: 'high', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, changes },
        proposedFix: 'JavaScript changes the canonical or robots directive after the page loads. Put the intended values in the server HTML so every crawler sees the same directive.' };
    }
    return pass('C008');
  },
},
];
