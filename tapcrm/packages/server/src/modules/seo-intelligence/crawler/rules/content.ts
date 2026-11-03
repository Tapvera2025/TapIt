/**
 * T001–T012: Content quality rules.
 */
import type { RuleResult, PageObservation, RuleDefinition } from './index.js';

function pass(ruleId: string): RuleResult {
  return { ruleId, ruleVersion: 'v1', result: 'pass', severity: 'informational', confidence: 'direct', affectedTarget: null, evidence: {}, proposedFix: null };
}

export const CONTENT_RULES: RuleDefinition[] = [
{
  ruleId: 'T001', ruleVersion: 'v1', group: 'content', severity: 'high', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.wordCount !== null && obs.wordCount < 50) {
      return { ruleId: 'T001', ruleVersion: 'v1', result: 'fail', severity: 'high', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, word_count: obs.wordCount },
        proposedFix: 'This page has very little visible text content. Add meaningful body copy or mark the page as noindex if it is intentionally thin.' };
    }
    return pass('T001');
  },
},

{
  ruleId: 'T002', ruleVersion: 'v1', group: 'content', severity: 'moderate', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.h1Count !== null && obs.h1Count === 0) {
      return { ruleId: 'T002', ruleVersion: 'v1', result: 'fail', severity: 'moderate', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, h1_count: 0 },
        proposedFix: 'Add a single <h1> element that clearly describes the main topic of this page.' };
    }
    return pass('T002');
  },
},

{
  ruleId: 'T003', ruleVersion: 'v1', group: 'content', severity: 'moderate', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.h1Count !== null && obs.h1Count > 1) {
      return { ruleId: 'T003', ruleVersion: 'v1', result: 'review', severity: 'moderate', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, h1_count: obs.h1Count },
        proposedFix: `Consolidate to a single <h1>. Found ${obs.h1Count} <h1> elements; having multiple can dilute the primary topic signal.` };
    }
    return pass('T003');
  },
},

{
  ruleId: 'T004', ruleVersion: 'v1', group: 'content', severity: 'high', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    const { title, h1Text } = obs;
    if (!title || !h1Text) return pass('T004');
    const norm = (s: string) => s.toLowerCase().trim();
    if (norm(title) === norm(h1Text)) {
      return { ruleId: 'T004', ruleVersion: 'v1', result: 'review', severity: 'high', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, title, h1: h1Text },
        proposedFix: 'The <title> and <h1> are identical. Consider differentiating them: the title can be more keyword-rich while the <h1> focuses on the reader.' };
    }
    return pass('T004');
  },
},

{
  ruleId: 'T005', ruleVersion: 'v1', group: 'content', severity: 'low', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.title !== null && obs.title.length > 70) {
      return { ruleId: 'T005', ruleVersion: 'v1', result: 'review', severity: 'low', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, title_length: obs.title.length },
        proposedFix: `Title is ${obs.title.length} characters. Keep titles under 60–70 characters to prevent truncation in SERPs.` };
    }
    return pass('T005');
  },
},

{
  ruleId: 'T006', ruleVersion: 'v1', group: 'content', severity: 'low', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.metaDescription !== null && obs.metaDescription.length > 165) {
      return { ruleId: 'T006', ruleVersion: 'v1', result: 'review', severity: 'low', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, description_length: obs.metaDescription.length },
        proposedFix: `Meta description is ${obs.metaDescription.length} characters. Keep it under 155–165 characters to avoid truncation in search snippets.` };
    }
    return pass('T006');
  },
},

{
  ruleId: 'T009', ruleVersion: 'v1', group: 'content', severity: 'moderate', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.contentHash && obs.duplicateOfUrl) {
      return { ruleId: 'T009', ruleVersion: 'v1', result: 'fail', severity: 'moderate', confidence: 'inferred',
        affectedTarget: obs.url,
        evidence: { url: obs.url, duplicate_of: obs.duplicateOfUrl, content_hash: obs.contentHash },
        proposedFix: `Near-duplicate content detected. Canonicalize to ${obs.duplicateOfUrl} or differentiate the content meaningfully.` };
    }
    return pass('T009');
  },
},
];
