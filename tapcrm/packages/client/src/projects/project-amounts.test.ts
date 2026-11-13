import { describe, expect, it } from 'vitest';
import {
  dueAmount,
  formatProjectAmount,
  projectAmountProblem,
} from './project-amounts.js';

describe('project amounts in the form', () => {
  it('works out the due amount exactly', () => {
    expect(dueAmount('100000', '40000')).toBe('60000.00');
    expect(dueAmount('100000', '')).toBe('100000.00');
    expect(dueAmount('0.30', '0.10')).toBe('0.20');
    expect(dueAmount('50000.5', '0.25')).toBe('50000.25');
    expect(dueAmount('1000', '1000')).toBe('0.00');
  });

  it('shows no due amount until the amounts make sense', () => {
    expect(dueAmount('', '')).toBeNull();
    expect(dueAmount('', '500')).toBeNull();
    expect(dueAmount('1000', '1500')).toBeNull();
    expect(dueAmount('1,000', '')).toBeNull();
  });

  it('explains what is wrong in plain words', () => {
    expect(projectAmountProblem('', '')).toBeNull();
    expect(projectAmountProblem('100000', '')).toBeNull();
    expect(projectAmountProblem('', '5000')).toBe(
      'Enter the project value before the upfront amount paid.',
    );
    expect(projectAmountProblem('1000', '1000.01')).toBe(
      'Upfront paid cannot be more than the project value.',
    );
    expect(projectAmountProblem('1,00,000', '')).toMatch(/project value/);
    expect(projectAmountProblem('1000', '-5')).toMatch(/upfront amount/);
  });

  it('formats amounts for display and shows a dash when there is none', () => {
    expect(formatProjectAmount(null, 'INR')).toBe('—');
    expect(formatProjectAmount('60000.00', 'INR')).toMatch(/60,000/);
    expect(formatProjectAmount('10', 'NOT-A-CODE')).toBe('NOT-A-CODE 10');
  });
});
