/**
 * D001–D010: Structured data / Schema.org rules.
 */
import type { RuleResult, PageObservation, RuleDefinition } from './index.js';

function pass(ruleId: string): RuleResult {
  return { ruleId, ruleVersion: 'v1', result: 'pass', severity: 'informational', confidence: 'direct', affectedTarget: null, evidence: {}, proposedFix: null };
}

export const SCHEMA_RULES: RuleDefinition[] = [
{
  ruleId: 'D001', ruleVersion: 'v1', group: 'schema', severity: 'high', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.schemaErrors && obs.schemaErrors.length > 0) {
      return { ruleId: 'D001', ruleVersion: 'v1', result: 'fail', severity: 'high', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, schema_errors: obs.schemaErrors.slice(0, 10) },
        proposedFix: 'Fix JSON-LD syntax errors so search engines can parse the structured data. Validate using the Schema Markup Validator.' };
    }
    return pass('D001');
  },
},

{
  ruleId: 'D002', ruleVersion: 'v1', group: 'schema', severity: 'moderate', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (!obs.hasProductPriceSchema) {
      return { ruleId: 'D002', ruleVersion: 'v1', result: 'review', severity: 'moderate', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, schema_types: obs.schemaTypes },
        proposedFix: 'Product schema is missing price/offers information. Add an Offer schema block with price, currency, and availability for rich snippet eligibility.' };
    }
    return pass('D002');
  },
},

{
  ruleId: 'D003', ruleVersion: 'v1', group: 'schema', severity: 'moderate', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (!obs.hasArticleDateSchema) {
      return { ruleId: 'D003', ruleVersion: 'v1', result: 'review', severity: 'moderate', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, schema_types: obs.schemaTypes },
        proposedFix: 'Article schema is missing datePublished or dateModified. Add these fields to qualify for rich results.' };
    }
    return pass('D003');
  },
},

{
  ruleId: 'D006', ruleVersion: 'v1', group: 'schema', severity: 'low', active: true, tested: true,
  evaluate(obs: PageObservation): RuleResult {
    if (!obs.schemaTypes || obs.schemaTypes.length === 0) {
      return { ruleId: 'D006', ruleVersion: 'v1', result: 'review', severity: 'low', confidence: 'direct',
        affectedTarget: obs.url,
        evidence: { url: obs.url, schema_types: [] },
        proposedFix: 'No structured data detected. Adding appropriate Schema.org markup (Organization, Product, Article, etc.) can improve rich-result eligibility.' };
    }
    return pass('D006');
  },
},

{
  ruleId: 'D009', ruleVersion: 'v1', group: 'schema', severity: 'high', active: true, tested: false,
  evaluate(obs: PageObservation): RuleResult {
    if (obs.schemaMismatch) {
      return { ruleId: 'D009', ruleVersion: 'v1', result: 'fail', severity: 'high', confidence: 'inferred',
        affectedTarget: obs.url,
        evidence: { url: obs.url, mismatch_detail: obs.schemaMismatch },
        proposedFix: 'Structured data contains information not present in the visible page content. Ensure schema accurately reflects on-page content to avoid manual actions.' };
    }
    return pass('D009');
  },
},
];
