import { describe, expect, it } from 'vitest';
import {
  penaltyRuleSchema,
  createPolicySchema,
  assignPolicySchema,
  previewPolicySchema,
} from './validators.js';

// ── penaltyRuleSchema ─────────────────────────────────────────────────────────

describe('penaltyRuleSchema', () => {
  const validRule = {
    ordinal: 1,
    condition: 'over-total',
    occurrenceWindow: 'day',
    consequence: 'warn',
  };

  it('accepts a valid warn rule', () => {
    const result = penaltyRuleSchema.safeParse(validRule);
    expect(result.success).toBe(true);
  });

  it('accepts a valid deduct-minutes rule with minutes', () => {
    const result = penaltyRuleSchema.safeParse({
      ...validRule,
      consequence: 'deduct-minutes',
      minutes: 30,
    });
    expect(result.success).toBe(true);
  });

  it('rejects deduct-minutes without minutes', () => {
    const result = penaltyRuleSchema.safeParse({
      ...validRule,
      consequence: 'deduct-minutes',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('minutes required'))).toBe(true);
    }
  });

  it('accepts a valid deduct-amount rule with amount', () => {
    const result = penaltyRuleSchema.safeParse({
      ...validRule,
      consequence: 'deduct-amount',
      amount: 50.0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects deduct-amount without amount', () => {
    const result = penaltyRuleSchema.safeParse({
      ...validRule,
      consequence: 'deduct-amount',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('amount required'))).toBe(true);
    }
  });

  it('applies default occurrenceCount of 1', () => {
    const result = penaltyRuleSchema.safeParse(validRule);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.occurrenceCount).toBe(1);
    }
  });

  it('applies default autoApply of false', () => {
    const result = penaltyRuleSchema.safeParse(validRule);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autoApply).toBe(false);
    }
  });

  it('rejects invalid condition', () => {
    const result = penaltyRuleSchema.safeParse({
      ...validRule,
      condition: 'invalid-condition',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid consequence', () => {
    const result = penaltyRuleSchema.safeParse({
      ...validRule,
      consequence: 'fire-employee',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive ordinal', () => {
    const result = penaltyRuleSchema.safeParse({ ...validRule, ordinal: 0 });
    expect(result.success).toBe(false);
  });
});

// ── createPolicySchema ────────────────────────────────────────────────────────

describe('createPolicySchema', () => {
  const validPayload = {
    name: 'Standard Break Policy',
    effectiveFrom: '2026-11-01',
    lowerEnforced: false,
    graceMinutes: 5,
    warningPercent: 80,
    countsTowardWorkHours: true,
    rules: [],
  };

  it('accepts a valid create payload', () => {
    const result = createPolicySchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('accepts a valid payload with rules', () => {
    const result = createPolicySchema.safeParse({
      ...validPayload,
      rules: [
        {
          ordinal: 1,
          condition: 'over-total',
          occurrenceWindow: 'day',
          consequence: 'warn',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('applies default graceMinutes of 0', () => {
    const result = createPolicySchema.safeParse({
      ...validPayload,
      graceMinutes: undefined,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.graceMinutes).toBe(0);
    }
  });

  it('applies default warningPercent of 80', () => {
    const { warningPercent: _, ...payload } = validPayload;
    const result = createPolicySchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.warningPercent).toBe(80);
    }
  });

  it('applies default countsTowardWorkHours of true', () => {
    const { countsTowardWorkHours: _, ...payload } = validPayload;
    const result = createPolicySchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.countsTowardWorkHours).toBe(true);
    }
  });

  it('rejects non-YYYY-MM-DD effectiveFrom', () => {
    const result = createPolicySchema.safeParse({
      ...validPayload,
      effectiveFrom: '2026/11/01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = createPolicySchema.safeParse({ ...validPayload, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name exceeding 100 characters', () => {
    const result = createPolicySchema.safeParse({
      ...validPayload,
      name: 'a'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it('rejects warningPercent out of range', () => {
    expect(createPolicySchema.safeParse({ ...validPayload, warningPercent: 0 }).success).toBe(false);
    expect(createPolicySchema.safeParse({ ...validPayload, warningPercent: 101 }).success).toBe(false);
  });

  it('rejects negative graceMinutes', () => {
    const result = createPolicySchema.safeParse({ ...validPayload, graceMinutes: -1 });
    expect(result.success).toBe(false);
  });

  it('accepts optional limit fields as null', () => {
    const result = createPolicySchema.safeParse({
      ...validPayload,
      upperTotalMinutes: null,
      upperSingleMinutes: null,
      lowerTotalMinutes: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts positive integer limit fields', () => {
    const result = createPolicySchema.safeParse({
      ...validPayload,
      upperTotalMinutes: 60,
      upperSingleMinutes: 15,
      lowerTotalMinutes: 30,
    });
    expect(result.success).toBe(true);
  });
});

// ── assignPolicySchema ────────────────────────────────────────────────────────

describe('assignPolicySchema', () => {
  const validAssign = {
    effectiveFrom: '2026-11-01',
    priority: 0,
  };

  it('accepts org-wide assignment with no target', () => {
    const result = assignPolicySchema.safeParse(validAssign);
    expect(result.success).toBe(true);
  });

  it('accepts single target: userId', () => {
    const result = assignPolicySchema.safeParse({
      ...validAssign,
      userId: '00000000-0000-0000-0000-000000000001',
    });
    expect(result.success).toBe(true);
  });

  it('accepts single target: departmentId', () => {
    const result = assignPolicySchema.safeParse({
      ...validAssign,
      departmentId: '00000000-0000-0000-0000-000000000002',
    });
    expect(result.success).toBe(true);
  });

  it('rejects more than one target', () => {
    const result = assignPolicySchema.safeParse({
      ...validAssign,
      userId: '00000000-0000-0000-0000-000000000001',
      departmentId: '00000000-0000-0000-0000-000000000002',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('At most one target'))).toBe(true);
    }
  });

  it('rejects invalid date format', () => {
    const result = assignPolicySchema.safeParse({
      ...validAssign,
      effectiveFrom: '11/01/2026',
    });
    expect(result.success).toBe(false);
  });

  it('applies default priority of 0', () => {
    const { priority: _, ...payload } = validAssign;
    const result = assignPolicySchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe(0);
    }
  });
});

// ── previewPolicySchema ───────────────────────────────────────────────────────

describe('previewPolicySchema', () => {
  const userId = '00000000-0000-0000-0000-000000000001';

  it('accepts a 0-day range (same from and to date)', () => {
    const result = previewPolicySchema.safeParse({
      userId,
      fromDate: '2026-11-01',
      toDate: '2026-11-01',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a 90-day range', () => {
    const result = previewPolicySchema.safeParse({
      userId,
      fromDate: '2026-11-01',
      toDate: '2027-01-30',  // exactly 90 days after Nov 1
    });
    expect(result.success).toBe(true);
  });

  it('rejects a 91-day range', () => {
    const result = previewPolicySchema.safeParse({
      userId,
      fromDate: '2026-11-01',
      toDate: '2027-01-31',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('0–90 days'))).toBe(true);
    }
  });

  it('rejects inverse date range (to before from)', () => {
    const result = previewPolicySchema.safeParse({
      userId,
      fromDate: '2026-11-10',
      toDate: '2026-11-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid UUID for userId', () => {
    const result = previewPolicySchema.safeParse({
      userId: 'not-a-uuid',
      fromDate: '2026-11-01',
      toDate: '2026-11-30',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid date format', () => {
    const result = previewPolicySchema.safeParse({
      userId,
      fromDate: '2026/11/01',
      toDate: '2026/11/30',
    });
    expect(result.success).toBe(false);
  });
});
