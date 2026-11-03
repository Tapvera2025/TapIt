/**
 * L001–L012: Internal / external link rules.
 */
import type { RuleResult, PageObservation, RuleDefinition } from './index.js';

function pass(ruleId: string): RuleResult {
  return { ruleId, ruleVersion: 'v1', result: 'pass', severity: 'informational', confidence: 'direct', affectedTarget: null, evidence: {}, proposedFix: null };
}

export const LINKS_RULES: RuleDefinition[] = [
{
  ruleId: 'L001', ruleVersion: 'v1', group: 'links', severity: 'high', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    const broken = obs.outboundLinks.filter((l) => l.statusCode === 404);
    if (broken.length > 0) {
      return { ruleId: 'L001', ruleVersion: 'v1', result: 'fail', severity: 'high', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, broken_links: broken.map((l) => l.href) },
        proposedFix: 'Fix or remove internal links that return 404. Update each href to a live destination or delete the anchor.' };
    }
    return pass('L001');
  },
},

{
  ruleId: 'L002', ruleVersion: 'v1', group: 'links', severity: 'moderate', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    const orphan = obs.inboundInternalLinkCount !== null && obs.inboundInternalLinkCount === 0 && obs.isPriority;
    if (orphan) {
      return { ruleId: 'L002', ruleVersion: 'v1', result: 'fail', severity: 'moderate', confidence: 'inferred',
        affectedTarget: obs.url,
        evidence: { url: obs.url, inbound_count: 0 },
        proposedFix: 'This priority page has no internal links pointing to it — crawlers may not discover it. Add links from relevant hub pages.' };
    }
    return pass('L002');
  },
},

{
  ruleId: 'L003', ruleVersion: 'v1', group: 'links', severity: 'low', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    const genericAnchors = obs.outboundLinks.filter(
      (l) => l.anchor && /^(click here|here|read more|learn more|more|this|link)$/i.test(l.anchor.trim()),
    );
    if (genericAnchors.length > 0) {
      return { ruleId: 'L003', ruleVersion: 'v1', result: 'review', severity: 'low', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, generic_anchors: genericAnchors.map((l) => ({ href: l.href, anchor: l.anchor })) },
        proposedFix: 'Replace generic anchor text ("click here", "read more") with descriptive text that conveys what the linked page is about.' };
    }
    return pass('L003');
  },
},

{
  ruleId: 'L005', ruleVersion: 'v1', group: 'links', severity: 'moderate', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    const nofollowInternal = obs.outboundLinks.filter(
      (l) => l.isInternal && l.relValues.includes('nofollow'),
    );
    if (nofollowInternal.length > 0) {
      return { ruleId: 'L005', ruleVersion: 'v1', result: 'review', severity: 'moderate', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, nofollow_internal: nofollowInternal.map((l) => l.href) },
        proposedFix: 'Internal links with rel="nofollow" waste crawl budget and block PageRank flow. Remove nofollow from internal links unless intentionally preventing crawling of specific pages.' };
    }
    return pass('L005');
  },
},

{
  ruleId: 'L008', ruleVersion: 'v1', group: 'links', severity: 'moderate', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.outboundInternalLinkCount !== null && obs.outboundInternalLinkCount > 150) {
      return { ruleId: 'L008', ruleVersion: 'v1', result: 'review', severity: 'moderate', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, internal_link_count: obs.outboundInternalLinkCount },
        proposedFix: `Page has ${obs.outboundInternalLinkCount} internal links. Very high link counts can dilute PageRank distribution. Consider reducing or paginating navigation elements.` };
    }
    return pass('L008');
  },
},
];
