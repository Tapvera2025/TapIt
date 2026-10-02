import { describe, expect, it } from 'vitest';
import {
  confirmBreachSchema,
  waiveBreachSchema,
  explanationSchema,
  listBreachesSchema,
} from './validators.js';

// ── confirmBreachSchema ───────────────────────────────────────────────────────

describe('confirmBreachSchema', () => {
  it('accepts an empty body (reason is optional)', () => {
    const result = confirmBreachSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a body with a reason', () => {
    const result = confirmBreachSchema.safeParse({ reason: 'Late from meeting' });
    expect(result.success).toBe(true);
  });

  it('rejects reason longer than 2000 chars', () => {
    const result = confirmBreachSchema.safeParse({ reason: 'x'.repeat(2001) });
    expect(result.success).toBe(false);
  });
});

// ── waiveBreachSchema ─────────────────────────────────────────────────────────

describe('waiveBreachSchema', () => {
  it('accepts a non-empty reason', () => {
    const result = waiveBreachSchema.safeParse({ reason: 'Manager approved' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty reason', () => {
    const result = waiveBreachSchema.safeParse({ reason: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing reason', () => {
    const result = waiveBreachSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects reason longer than 2000 chars', () => {
    const result = waiveBreachSchema.safeParse({ reason: 'x'.repeat(2001) });
    expect(result.success).toBe(false);
  });
});

// ── explanationSchema ─────────────────────────────────────────────────────────

describe('explanationSchema', () => {
  it('accepts a non-empty explanation', () => {
    const result = explanationSchema.safeParse({ explanation: 'I was at a doctor appointment' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty explanation', () => {
    const result = explanationSchema.safeParse({ explanation: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing explanation', () => {
    const result = explanationSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects explanation longer than 5000 chars', () => {
    const result = explanationSchema.safeParse({ explanation: 'x'.repeat(5001) });
    expect(result.success).toBe(false);
  });
});

// ── listBreachesSchema ────────────────────────────────────────────────────────

describe('listBreachesSchema', () => {
  it('defaults limit to 50', () => {
    const result = listBreachesSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(50);
  });

  it('accepts valid status filter', () => {
    const result = listBreachesSchema.safeParse({ status: 'pending' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = listBreachesSchema.safeParse({ status: 'invalid-status' });
    expect(result.success).toBe(false);
  });

  it('accepts all valid statuses', () => {
    const statuses = ['pending', 'confirmed', 'waived', 'advisory', 'suppressed', 'superseded'];
    for (const status of statuses) {
      const result = listBreachesSchema.safeParse({ status });
      expect(result.success).toBe(true);
    }
  });

  it('rejects limit above 200', () => {
    const result = listBreachesSchema.safeParse({ limit: '201' });
    expect(result.success).toBe(false);
  });

  it('coerces string limit', () => {
    const result = listBreachesSchema.safeParse({ limit: '10' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(10);
  });
});
