/**
 * P001–P010: Core Web Vitals / performance rules.
 */
import type { RuleResult, PageObservation, RuleDefinition } from './index.js';
import { getSeoRuleCopy } from '@tapcrm/contracts';

function pass(ruleId: string): RuleResult {
  return { ruleId, ruleVersion: 'v1', result: 'pass', severity: 'informational', confidence: 'direct', affectedTarget: null, evidence: {}, proposedFix: null };
}

export const PERFORMANCE_RULES: RuleDefinition[] = [
{
  ruleId: 'P001', ruleVersion: 'v1', group: 'performance', severity: 'high', active: true, tested: true, scope: 'site',
  evaluate(obs: PageObservation): RuleResult {
    if (!obs.cruxLcp) return pass('P001');
    if (obs.cruxLcp.rating === 'poor') {
      return { ruleId: 'P001', ruleVersion: 'v1', result: 'fail', severity: 'high', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, lcp_p75_ms: obs.cruxLcp.p75, rating: 'poor' },
        proposedFix: `LCP is ${obs.cruxLcp.p75}ms (poor, threshold: >4000ms). Optimise the LCP element: preload the hero image, reduce server TTFB, or eliminate render-blocking resources.` };
    }
    if (obs.cruxLcp.rating === 'needs_improvement') {
      return { ruleId: 'P001', ruleVersion: 'v1', result: 'review', severity: 'high', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, lcp_p75_ms: obs.cruxLcp.p75, rating: 'needs_improvement' },
        proposedFix: `LCP is ${obs.cruxLcp.p75}ms (needs improvement, threshold: 2500–4000ms). Aim for under 2500ms.` };
    }
    return pass('P001');
  },
},

{
  ruleId: 'P002', ruleVersion: 'v1', group: 'performance', severity: 'high', active: true, tested: true, scope: 'site',
  evaluate(obs: PageObservation): RuleResult {
    if (!obs.cruxInp) return pass('P002');
    if (obs.cruxInp.rating === 'poor') {
      return { ruleId: 'P002', ruleVersion: 'v1', result: 'fail', severity: 'high', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, inp_p75_ms: obs.cruxInp.p75, rating: 'poor' },
        proposedFix: `INP is ${obs.cruxInp.p75}ms (poor, threshold: >500ms). Reduce long tasks, optimise event handlers, and defer non-critical JavaScript.` };
    }
    if (obs.cruxInp.rating === 'needs_improvement') {
      return { ruleId: 'P002', ruleVersion: 'v1', result: 'review', severity: 'high', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, inp_p75_ms: obs.cruxInp.p75, rating: 'needs_improvement' },
        proposedFix: `INP is ${obs.cruxInp.p75}ms (needs improvement, threshold: 200–500ms). Aim for under 200ms.` };
    }
    return pass('P002');
  },
},

{
  ruleId: 'P003', ruleVersion: 'v1', group: 'performance', severity: 'high', active: true, tested: true, scope: 'site',
  evaluate(obs: PageObservation): RuleResult {
    if (!obs.cruxCls) return pass('P003');
    if (obs.cruxCls.rating === 'poor') {
      return { ruleId: 'P003', ruleVersion: 'v1', result: 'fail', severity: 'high', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, cls_p75: obs.cruxCls.p75, rating: 'poor' },
        proposedFix: `CLS is ${obs.cruxCls.p75} (poor, threshold: >0.25). Set explicit width/height on images and ads, and avoid inserting content above existing content.` };
    }
    if (obs.cruxCls.rating === 'needs_improvement') {
      return { ruleId: 'P003', ruleVersion: 'v1', result: 'review', severity: 'high', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, cls_p75: obs.cruxCls.p75, rating: 'needs_improvement' },
        proposedFix: `CLS is ${obs.cruxCls.p75} (needs improvement, threshold: 0.1–0.25). Aim for under 0.1.` };
    }
    return pass('P003');
  },
},

{
  ruleId: 'P007', ruleVersion: 'v1', group: 'performance', severity: 'moderate', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.lighthousePerformanceScore !== null && obs.lighthousePerformanceScore < 50) {
      return { ruleId: 'P007', ruleVersion: 'v1', result: 'fail', severity: 'moderate', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, lighthouse_performance: obs.lighthousePerformanceScore },
        proposedFix: `Lighthouse performance score is ${obs.lighthousePerformanceScore}/100. Review the Lighthouse report opportunities: eliminate render-blocking resources, compress assets, and leverage browser caching.` };
    }
    return pass('P007');
  },
},

{
  ruleId: 'P010', ruleVersion: 'v1', group: 'performance', severity: 'low', active: true, tested: true, scope: 'site',
  evaluate(obs: PageObservation): RuleResult {
    if (!obs.cruxLcp && !obs.cruxInp && !obs.cruxCls) {
      return { ruleId: 'P010', ruleVersion: 'v1', result: 'review', severity: 'low', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, crux_available: false },
        proposedFix: getSeoRuleCopy('P010').recommendation ?? null };
    }
    return pass('P010');
  },
},
];
