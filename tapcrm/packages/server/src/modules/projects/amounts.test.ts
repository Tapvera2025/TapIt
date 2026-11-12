import { describe, expect, it } from 'vitest';
import { PROJECT_AMOUNT_PATTERN, projectAmountProblem, toMinorUnits } from './amounts.js';

describe('project amounts', () => {
  it('accepts plain amounts with up to two decimals and nothing else', () => {
    for (const ok of ['0', '50000', '50000.5', '50000.50', '9999999999999999.99']) {
      expect(PROJECT_AMOUNT_PATTERN.test(ok)).toBe(true);
    }
    for (const bad of ['', '-1', '1.234', '1e5', '12,000', 'abc', '10000000000000000']) {
      expect(PROJECT_AMOUNT_PATTERN.test(bad)).toBe(false);
    }
  });

  it('converts to minor units exactly', () => {
    expect(toMinorUnits('50000')).toBe(5000000n);
    expect(toMinorUnits('50000.5')).toBe(5000050n);
    expect(toMinorUnits('0.07')).toBe(7n);
    expect(toMinorUnits('9999999999999999.99')).toBe(999999999999999999n);
  });

  it('allows upfront up to the project value, and none at all', () => {
    expect(projectAmountProblem('100000', null)).toBeNull();
    expect(projectAmountProblem(null, null)).toBeNull();
    expect(projectAmountProblem('100000', '40000')).toBeNull();
    expect(projectAmountProblem('100000.00', '100000')).toBeNull();
  });

  it('refuses upfront above the value, or without a value', () => {
    expect(projectAmountProblem('100000', '100000.01')).toBe(
      'Upfront paid cannot be more than the project value.',
    );
    expect(projectAmountProblem(null, '5000')).toBe(
      'Enter the project value before the upfront amount paid.',
    );
  });
});
