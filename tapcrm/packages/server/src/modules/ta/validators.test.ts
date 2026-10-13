import { describe, expect, it } from 'vitest';
import { assignmentSchema } from './validators.js';

const valid = {
  departmentId: '00000000-0000-0000-0000-000000000001',
  employeeId: '00000000-0000-0000-0000-000000000002',
  taMonth: '2026-09-01',
  dailyAmountPaise: 50000,
  effectiveFrom: '2026-09-01',
  effectiveTo: '2026-09-30',
};

describe('TA assignment validation', () => {
  it('accepts a valid month-bounded daily assignment', () => {
    expect(assignmentSchema.parse(valid)).toMatchObject(valid);
  });

  it('rejects impossible calendar dates', () => {
    expect(() =>
      assignmentSchema.parse({ ...valid, effectiveFrom: '2026-09-31' }),
    ).toThrow('Invalid TA date.');
  });

  it('rejects an end date before the start date', () => {
    expect(() =>
      assignmentSchema.parse({
        ...valid,
        effectiveFrom: '2026-09-20',
        effectiveTo: '2026-09-10',
      }),
    ).toThrow('Effective To cannot be before Effective From.');
  });

  it('rejects dates outside the selected month', () => {
    expect(() =>
      assignmentSchema.parse({
        ...valid,
        effectiveFrom: '2026-10-01',
        effectiveTo: null,
      }),
    ).toThrow('Effective From must belong to the selected TA month.');
  });

  it('rejects zero daily TA', () => {
    expect(() => assignmentSchema.parse({ ...valid, dailyAmountPaise: 0 })).toThrow(
      'Daily TA amount must be greater than zero.',
    );
  });
});
