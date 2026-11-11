import { describe, expect, it } from 'vitest';
import { getSeoRuleCopy, getSeoRuleGroupLabel } from '@tapcrm/contracts';
import { getAllRules } from './crawler/rules/index.js';

describe('SEO check explanations', () => {
  it('provides a meaningful title, description and category for every registered check', () => {
    const rules = getAllRules();
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      const copy = getSeoRuleCopy(rule.ruleId);
      expect(copy.title, rule.ruleId).not.toBe('Additional SEO check');
      expect(copy.title, rule.ruleId).not.toBe(rule.ruleId);
      expect(copy.description.length, rule.ruleId).toBeGreaterThan(30);
      expect(getSeoRuleGroupLabel(rule.group), rule.ruleId).not.toBe('Other SEO checks');
    }
  });
  it('explains missing field data without declaring a page defect or prescribing more traffic', () => {
    const copy = getSeoRuleCopy('P010');
    expect(copy.title).toBe('Real-user performance data unavailable');
    expect(copy.description).toContain('not a confirmed page defect');
    expect(copy.recommendation).toContain('API-access error');
    expect(copy.recommendation).not.toMatch(/drive more|proxy/i);
  });
  it('keeps unknown references out of the primary title', () => {
    const copy = getSeoRuleCopy('UNKNOWN-999');
    expect(copy.title).not.toContain('UNKNOWN-999');
    expect(copy.description).toContain('technical reference');
  });
});
