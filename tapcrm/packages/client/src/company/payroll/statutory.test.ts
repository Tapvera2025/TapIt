import { describe, expect, it } from 'vitest';
import { guessStatutory, statutoryOptions, worksOutItself } from './statutory.js';

describe('salary line statutory marks', () => {
  it('offers PF wage on earnings, and PF, PT or ESI on deductions and employer lines', () => {
    expect(statutoryOptions('earning')).toEqual(['pf-wage']);
    expect(statutoryOptions('deduction')).toEqual(['pf', 'pt', 'esi']);
    expect(statutoryOptions('employer-contribution')).toEqual(['pf', 'esi']);
  });

  it('suggests the mark for salaries saved before lines could be marked', () => {
    expect(guessStatutory('BASIC', 'earning')).toBe('pf-wage');
    expect(guessStatutory('HRA', 'earning')).toBe('');
    expect(guessStatutory('PF', 'deduction')).toBe('pf');
    expect(guessStatutory('PT', 'deduction')).toBe('pt');
    expect(guessStatutory('ESI', 'deduction')).toBe('esi');
    expect(guessStatutory('PF_ER', 'employer-contribution')).toBe('pf');
    expect(guessStatutory('PF', 'earning')).toBe('');
  });

  it('lets a marked deduction be saved without an amount, but not an earning', () => {
    expect(worksOutItself({ kind: 'deduction', statutory: 'pf' })).toBe(true);
    expect(worksOutItself({ kind: 'employer-contribution', statutory: 'esi' })).toBe(true);
    expect(worksOutItself({ kind: 'earning', statutory: 'pf-wage' })).toBe(false);
    expect(worksOutItself({ kind: 'deduction', statutory: '' })).toBe(false);
  });
});
