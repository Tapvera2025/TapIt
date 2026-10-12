import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGE_PROBABILITY, effectiveProbability, isValidProbabilityOverride } from './probability.js';

describe('DEFAULT_STAGE_PROBABILITY', () => {
  it('matches the plan: 20/40/60/85 for the four open stages', () => {
    expect(DEFAULT_STAGE_PROBABILITY.discovery).toBe(20);
    expect(DEFAULT_STAGE_PROBABILITY.proposal).toBe(40);
    expect(DEFAULT_STAGE_PROBABILITY.negotiation).toBe(60);
    expect(DEFAULT_STAGE_PROBABILITY.closing).toBe(85);
  });
  it('reports 100 for closed deals', () => {
    expect(DEFAULT_STAGE_PROBABILITY.closed).toBe(100);
  });
});

describe('effectiveProbability', () => {
  it('uses the stage default when there is no override', () => {
    expect(effectiveProbability('discovery', null)).toBe(20);
  });
  it('uses the override when present and in range', () => {
    expect(effectiveProbability('discovery', 35)).toBe(35);
  });
  it('ignores an override that is out of range', () => {
    expect(effectiveProbability('discovery', 200)).toBe(20);
    expect(effectiveProbability('discovery', -1)).toBe(20);
  });
});

describe('isValidProbabilityOverride', () => {
  it('accepts 0..100 inclusive', () => {
    expect(isValidProbabilityOverride(0)).toBe(true);
    expect(isValidProbabilityOverride(100)).toBe(true);
    expect(isValidProbabilityOverride(50)).toBe(true);
  });
  it('rejects out-of-range and NaN', () => {
    expect(isValidProbabilityOverride(-1)).toBe(false);
    expect(isValidProbabilityOverride(101)).toBe(false);
    expect(isValidProbabilityOverride(Number.NaN)).toBe(false);
  });
});
