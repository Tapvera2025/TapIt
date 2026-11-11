/**
 * H001–H012: HTTP / status code rules.
 */
import type { RuleResult, PageObservation, RuleDefinition } from './index.js';

function pass(ruleId: string): RuleResult {
  return { ruleId, ruleVersion: 'v1', result: 'pass', severity: 'informational', confidence: 'direct', affectedTarget: null, evidence: {}, proposedFix: null };
}

export const HTTP_RULES: RuleDefinition[] = [
{
  ruleId: 'H001', ruleVersion: 'v1', group: 'http', severity: 'critical', active: true, tested: true, appliesTo: 'any',
  evaluate(obs: PageObservation): RuleResult {
    if (obs.httpStatus === 404) {
      return { ruleId: 'H001', ruleVersion: 'v1', result: 'fail', severity: 'critical', confidence: 'direct',
        affectedTarget: obs.url, evidence: { status: 404, url: obs.url },
        proposedFix: 'Restore the resource, redirect to a relevant live URL, or remove all internal links pointing to this URL.' };
    }
    return pass('H001');
  },
},

{
  ruleId: 'H002', ruleVersion: 'v1', group: 'http', severity: 'high', active: true, tested: true, appliesTo: 'any',
  evaluate(obs: PageObservation): RuleResult {
    if (obs.httpStatus === 410) {
      return { ruleId: 'H002', ruleVersion: 'v1', result: 'fail', severity: 'high', confidence: 'direct',
        affectedTarget: obs.url, evidence: { status: 410, url: obs.url },
        proposedFix: 'Intentional 410 — verify this deletion is deliberate and remove internal links pointing here.' };
    }
    return pass('H002');
  },
},

{
  ruleId: 'H003', ruleVersion: 'v1', group: 'http', severity: 'critical', active: true, tested: true, appliesTo: 'any',
  evaluate(obs: PageObservation): RuleResult {
    if (obs.httpStatus !== null && obs.httpStatus >= 500 && obs.httpStatus < 600) {
      return { ruleId: 'H003', ruleVersion: 'v1', result: 'fail', severity: 'critical', confidence: 'direct',
        affectedTarget: obs.url, evidence: { status: obs.httpStatus, url: obs.url },
        proposedFix: 'Investigate the server-side error. Check application logs for stack traces at the time of the crawl.' };
    }
    return pass('H003');
  },
},

{
  ruleId: 'H009', ruleVersion: 'v1', group: 'http', severity: 'high', active: true, tested: true, appliesTo: 'any',
  evaluate(obs: PageObservation): RuleResult {
    // A loop is a URL the chain visits twice, or a chain that never reached a
    // final response (the crawler gave up after too many hops).
    const urls = obs.redirectChain.map((h) => h.url);
    if (urls.length > 0) {
      const revisits = new Set(urls).size !== urls.length;
      const endsInChain = obs.finalUrl !== null && obs.finalUrl !== obs.url && urls.includes(obs.finalUrl);
      const unfinished = obs.finalUrl === null;
      if (revisits || endsInChain || unfinished) {
        return { ruleId: 'H009', ruleVersion: 'v1', result: 'fail', severity: 'high', confidence: 'direct',
          affectedTarget: obs.url, evidence: { chain: urls },
          proposedFix: 'Remove the redirect loop by updating the destination URL in the redirect configuration.' };
      }
    }
    return pass('H009');
  },
},

{
  ruleId: 'H010', ruleVersion: 'v1', group: 'http', severity: 'moderate', active: true, tested: true, appliesTo: 'any',
  evaluate(obs: PageObservation): RuleResult {
    // More than 3 hops in a redirect chain is a review candidate
    if (obs.redirectChain.length > 3) {
      return { ruleId: 'H010', ruleVersion: 'v1', result: 'review', severity: 'moderate', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { chain_length: obs.redirectChain.length, chain: obs.redirectChain.map((h) => h.url) },
        proposedFix: 'Flatten the redirect chain to a single hop from the original URL to the final destination.' };
    }
    return pass('H010');
  },
},
];
