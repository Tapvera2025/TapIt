import { describe, expect, it } from 'vitest';
import {
  createLeaveTypeSchema,
  decideSchema,
  submitLeaveSchema,
  submitStandingWfhSchema,
  submitWfhSchema,
} from './validators.js';

describe('submitLeaveSchema', () => {
  const validInput = {
    leaveTypeId: '00000000-0000-0000-0000-000000000001',
    fromDate: '2026-10-01',
    toDate: '2026-10-05',
    fromHalf: 'full',
    toHalf: 'full',
    reason: 'Vacation',
  };

  it('accepts valid leave submission', () => {
    const result = submitLeaveSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe('Vacation');
      expect(result.data.fromDate).toBe('2026-10-01');
    }
  });

  it('rejects non-YYYY-MM-DD date format', () => {
    expect(submitLeaveSchema.safeParse({ ...validInput, fromDate: '10/01/2026' }).success).toBe(false);
    expect(submitLeaveSchema.safeParse({ ...validInput, fromDate: '2026-1-1' }).success).toBe(false);
    expect(submitLeaveSchema.safeParse({ ...validInput, toDate: '2026/10/05' }).success).toBe(false);
  });

  it('rejects empty reason', () => {
    expect(submitLeaveSchema.safeParse({ ...validInput, reason: '' }).success).toBe(false);
  });

  it('rejects reason exceeding max length', () => {
    const longReason = 'a'.repeat(2001);
    expect(submitLeaveSchema.safeParse({ ...validInput, reason: longReason }).success).toBe(false);
  });

  it('accepts reason of max length', () => {
    const maxReason = 'a'.repeat(2000);
    const result = submitLeaveSchema.safeParse({ ...validInput, reason: maxReason });
    expect(result.success).toBe(true);
  });

  it('defaults half values to full', () => {
    const result = submitLeaveSchema.safeParse({
      leaveTypeId: validInput.leaveTypeId,
      fromDate: validInput.fromDate,
      toDate: validInput.toDate,
      reason: 'Vacation',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fromHalf).toBe('full');
      expect(result.data.toHalf).toBe('full');
    }
  });

  it('accepts half values as first or second', () => {
    const result = submitLeaveSchema.safeParse({
      ...validInput,
      fromHalf: 'first',
      toHalf: 'second',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid UUID', () => {
    expect(submitLeaveSchema.safeParse({ ...validInput, leaveTypeId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('submitWfhSchema', () => {
  const validInput = {
    leaveTypeId: '00000000-0000-0000-0000-000000000001',
    fromDate: '2026-10-01',
    toDate: '2026-10-05',
    reason: 'Working from home',
  };

  it('accepts valid WFH submission', () => {
    const result = submitWfhSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('rejects non-YYYY-MM-DD date format', () => {
    expect(submitWfhSchema.safeParse({ ...validInput, fromDate: '10/01/2026' }).success).toBe(false);
  });

  it('rejects empty reason', () => {
    expect(submitWfhSchema.safeParse({ ...validInput, reason: '' }).success).toBe(false);
  });
});

describe('submitStandingWfhSchema', () => {
  const validInput = {
    leaveTypeId: '00000000-0000-0000-0000-000000000001',
    fromDate: '2026-10-01',
    recurrenceEnd: '2026-12-31',
    reason: 'Standing WFH arrangement',
  };

  it('accepts valid standing WFH submission', () => {
    const result = submitStandingWfhSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recurrenceEnd).toBe('2026-12-31');
    }
  });

  it('requires recurrenceEnd', () => {
    const { recurrenceEnd, ...withoutRecurrence } = validInput;
    expect(submitStandingWfhSchema.safeParse(withoutRecurrence).success).toBe(false);
  });

  it('rejects non-YYYY-MM-DD format for recurrenceEnd', () => {
    expect(submitStandingWfhSchema.safeParse({ ...validInput, recurrenceEnd: '12/31/2026' }).success).toBe(false);
  });

  it('rejects empty reason', () => {
    expect(submitStandingWfhSchema.safeParse({ ...validInput, reason: '' }).success).toBe(false);
  });
});

describe('decideSchema', () => {
  it('accepts approved decision', () => {
    const result = decideSchema.safeParse({
      decision: 'approved',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.decision).toBe('approved');
  });

  it('accepts rejected decision', () => {
    const result = decideSchema.safeParse({
      decision: 'rejected',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.decision).toBe('rejected');
  });

  it('accepts revoked decision', () => {
    const result = decideSchema.safeParse({
      decision: 'revoked',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.decision).toBe('revoked');
  });

  it('rejects other decision values', () => {
    expect(decideSchema.safeParse({ decision: 'pending' }).success).toBe(false);
    expect(decideSchema.safeParse({ decision: 'acknowledged' }).success).toBe(false);
    expect(decideSchema.safeParse({ decision: 'cancelled' }).success).toBe(false);
  });

  it('accepts optional decisionNote', () => {
    const result = decideSchema.safeParse({
      decision: 'rejected',
      decisionNote: 'Does not align with project timeline',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.decisionNote).toBe('Does not align with project timeline');
  });

  it('rejects decisionNote exceeding max length', () => {
    const longNote = 'a'.repeat(2001);
    expect(decideSchema.safeParse({ decision: 'rejected', decisionNote: longNote }).success).toBe(false);
  });

  it('accepts decisionNote of max length', () => {
    const maxNote = 'a'.repeat(2000);
    const result = decideSchema.safeParse({ decision: 'approved', decisionNote: maxNote });
    expect(result.success).toBe(true);
  });
});

describe('createLeaveTypeSchema', () => {
  const validInput = {
    code: 'PTO',
    name: 'Paid Time Off',
    kind: 'absence',
  };

  it('accepts valid leave type creation', () => {
    const result = createLeaveTypeSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('validates code length', () => {
    expect(createLeaveTypeSchema.safeParse({ ...validInput, code: '' }).success).toBe(false);
    expect(createLeaveTypeSchema.safeParse({ ...validInput, code: 'a'.repeat(51) }).success).toBe(false);
    expect(createLeaveTypeSchema.safeParse({ ...validInput, code: 'a'.repeat(50) }).success).toBe(true);
  });

  it('validates name length', () => {
    expect(createLeaveTypeSchema.safeParse({ ...validInput, name: '' }).success).toBe(false);
    expect(createLeaveTypeSchema.safeParse({ ...validInput, name: 'a'.repeat(101) }).success).toBe(false);
    expect(createLeaveTypeSchema.safeParse({ ...validInput, name: 'a'.repeat(100) }).success).toBe(true);
  });

  it('requires kind to be absence or attendance-mode', () => {
    expect(createLeaveTypeSchema.safeParse({ ...validInput, kind: 'invalid' }).success).toBe(false);
    expect(createLeaveTypeSchema.safeParse({ ...validInput, kind: 'attendance-mode' }).success).toBe(true);
  });

  it('applies defaults', () => {
    const result = createLeaveTypeSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accrualDays).toBe(0);
      expect(result.data.enforcement).toBe(false);
      expect(result.data.paidLeave).toBe(true);
    }
  });

  it('accepts accrualDays as non-negative integer', () => {
    const result = createLeaveTypeSchema.safeParse({ ...validInput, accrualDays: 20 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.accrualDays).toBe(20);
  });

  it('rejects negative accrualDays', () => {
    expect(createLeaveTypeSchema.safeParse({ ...validInput, accrualDays: -1 }).success).toBe(false);
  });

  it('accepts enforcement and paidLeave booleans', () => {
    const result = createLeaveTypeSchema.safeParse({
      ...validInput,
      enforcement: true,
      paidLeave: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enforcement).toBe(true);
      expect(result.data.paidLeave).toBe(false);
    }
  });
});
