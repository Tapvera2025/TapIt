import { describe, expect, it } from 'vitest';
import { createInputSchema, createStructureSchema } from './validators.js';

const input = (amount: unknown) => ({
  userId: '22222222-2222-4222-8222-222222222222',
  periodStart: '2026-09-01',
  kind: 'bonus',
  amount,
  label: 'Festival bonus',
  reason: 'Diwali',
});

describe('payroll money input (PG-5)', () => {
  it('takes rupees as a decimal string and returns the canonical form', () => {
    expect(createInputSchema.parse(input('5000')).amount).toBe('5000.00');
    expect(createInputSchema.parse(input(' 1250.5 ')).amount).toBe('1250.50');
    expect(createInputSchema.parse(input('0099.99')).amount).toBe('99.99');
  });

  it('still accepts a whole or two-decimal JSON number', () => {
    expect(createInputSchema.parse(input(5000)).amount).toBe('5000.00');
    expect(createInputSchema.parse(input(12.75)).amount).toBe('12.75');
  });

  it('refuses floats, fractions of a paisa, zero, negatives and absurd sizes', () => {
    expect(createInputSchema.safeParse(input(0.1 + 0.2)).success).toBe(false);
    expect(createInputSchema.safeParse(input('10.005')).success).toBe(false);
    expect(createInputSchema.safeParse(input('0')).success).toBe(false);
    expect(createInputSchema.safeParse(input('-5')).success).toBe(false);
    expect(createInputSchema.safeParse(input('1e5')).success).toBe(false);
    expect(createInputSchema.safeParse(input('2000000000')).success).toBe(false);
  });

  it('allows a zero salary line', () => {
    const parsed = createStructureSchema.parse({
      effectiveFrom: '2026-09-01',
      lines: [{ code: 'BASIC', label: 'Basic', kind: 'earning', amount: '0' }],
    });
    expect(parsed.lines[0]!.amount).toBe('0.00');
  });
});
