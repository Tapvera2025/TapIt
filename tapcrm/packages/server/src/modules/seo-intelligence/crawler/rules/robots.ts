/**
 * I001–I012: Robots / indexability rules.
 */
import type { RuleResult, PageObservation, RuleDefinition } from './index.js';

function pass(ruleId: string): RuleResult {
  return { ruleId, ruleVersion: 'v1', result: 'pass', severity: 'informational', confidence: 'direct', affectedTarget: null, evidence: {}, proposedFix: null };
}

function hasNoindex(directive: string | null): boolean {
  return directive !== null && /noindex/i.test(directive);
}

export const ROBOTS_RULES: RuleDefinition[] = [
{
  ruleId: 'I001', ruleVersion: 'v1', group: 'robots', severity: 'critical', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (!obs.isPriority) return { ...pass('I001'), result: 'skipped' };
    if (hasNoindex(obs.metaRobots)) {
      return { ruleId: 'I001', ruleVersion: 'v1', result: 'fail', severity: 'critical', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, meta_robots: obs.metaRobots },
        proposedFix: 'Remove the "noindex" directive from the <meta name="robots"> tag on this priority page.' };
    }
    return pass('I001');
  },
},

{
  ruleId: 'I006', ruleVersion: 'v1', group: 'robots', severity: 'critical', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (!obs.isPriority) return { ...pass('I006'), result: 'skipped' };
    if (hasNoindex(obs.xRobotsTag)) {
      return { ruleId: 'I006', ruleVersion: 'v1', result: 'fail', severity: 'critical', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, x_robots_tag: obs.xRobotsTag },
        proposedFix: 'Remove the "noindex" value from the X-Robots-Tag HTTP response header for this priority page.' };
    }
    return pass('I006');
  },
},

{
  ruleId: 'I009', ruleVersion: 'v1', group: 'robots', severity: 'moderate', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    const metaNoindex = hasNoindex(obs.metaRobots);
    const hasCanonical = Boolean(obs.canonicalLink);
    if (metaNoindex && hasCanonical) {
      return { ruleId: 'I009', ruleVersion: 'v1', result: 'review', severity: 'moderate', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, meta_robots: obs.metaRobots, canonical: obs.canonicalLink },
        proposedFix: 'A noindex page with a canonical is unusual. Confirm the intent: if the canonical target should be indexed, remove noindex from the source page.' };
    }
    return pass('I009');
  },
},
];
