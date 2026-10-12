import { describe, expect, it } from 'vitest';
import { describeDimension, describeSla, exceededDimensions } from './approvals-helpers.js';

describe('describeSla', () => {
  const now = new Date('2026-10-12T10:00:00Z');

  it('is ok with >60 min remaining', () => {
    const sla = describeSla(new Date(now.getTime() + 90 * 60_000).toISOString(), now);
    expect(sla.severity).toBe('ok');
    expect(sla.label).toBe('1h 30m');
  });

  it('is warn with 15–60 min remaining', () => {
    const sla = describeSla(new Date(now.getTime() + 30 * 60_000).toISOString(), now);
    expect(sla.severity).toBe('warn');
    expect(sla.label).toBe('30m');
  });

  it('is breach with ≤15 min remaining', () => {
    const sla = describeSla(new Date(now.getTime() + 10 * 60_000).toISOString(), now);
    expect(sla.severity).toBe('breach');
  });

  it('is overdue once past the due instant', () => {
    const sla = describeSla(new Date(now.getTime() - 1_000).toISOString(), now);
    expect(sla.severity).toBe('overdue');
    expect(sla.label).toBe('Overdue');
  });
});

describe('describeDimension', () => {
  it('phrases a value overrun with totals', () => {
    const text = describeDimension({
      kind: 'value',
      status: 'exceeds',
      totalMinor: '70000000',
      limitMinor: '50000000',
    });
    expect(text).toContain('exceeds');
    expect(text).toContain('₹700,000');
    expect(text).toContain('₹500,000');
  });

  it('phrases a below-policy advance with percents', () => {
    const text = describeDimension({
      kind: 'advance',
      status: 'below_policy',
      advanceBps: 1_000,
      policyBps: 2_000,
    });
    expect(text).toContain('10.00%');
    expect(text).toContain('20.00%');
  });

  it('summarises ok dimensions', () => {
    expect(describeDimension({ kind: 'value', status: 'ok' })).toBe('Value within authority');
  });
});

describe('exceededDimensions', () => {
  it('keeps only non-ok dimensions', () => {
    const subset = exceededDimensions([
      { kind: 'value', status: 'ok' },
      {
        kind: 'discount',
        status: 'exceeds',
        discountBps: 2_500,
        limitBps: 2_000,
      },
    ]);
    expect(subset).toHaveLength(1);
    expect(subset[0]!.kind).toBe('discount');
  });
});
