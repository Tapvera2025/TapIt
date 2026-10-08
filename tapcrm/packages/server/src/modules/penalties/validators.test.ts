import { describe, expect, it } from 'vitest';
import { cancelPenaltySchema, createPenaltySchema, listPenaltySchema } from './validators.js';

const validPenalty = {
  employeeId: '01a10b54-9497-736a-8c3e-af09a2d9123d',
  penaltyType: 'late_arrival' as const,
  amountPaise: 10000,
  penaltyDate: '2026-10-07',
  payrollPeriod: '2026-11-01',
  remarks: 'Repeated late arrival',
};

describe('penalty validation', () => {
  it('rejects a reversed filter date range with a field-level message', () => {
    const result = listPenaltySchema.safeParse({ dateFrom: '2026-10-10', dateTo: '2026-10-01' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('Date From cannot be later than Date To.');
  });

  it('allows an earlier penalty date to be assigned to a later payroll month', () => {
    expect(createPenaltySchema.safeParse(validPenalty).success).toBe(true);
  });

  it('rejects zero amounts and inactive-form omissions', () => {
    const result = createPenaltySchema.safeParse({ ...validPenalty, amountPaise: 0, remarks: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining(['Amount must be greater than zero.', 'Remarks are required.']),
      );
    }
  });

  it('requires a meaningful cancellation reason', () => {
    expect(cancelPenaltySchema.safeParse({ cancellationReason: '  ' }).success).toBe(false);
    expect(cancelPenaltySchema.safeParse({ cancellationReason: 'Duplicate entry' }).success).toBe(true);
  });
});
