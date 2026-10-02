import { describe, it, expect } from 'vitest';
import type { DateOnly } from '@tapcrm/contracts';
import {
  computeEvidenceFingerprint,
  computeAnswerFingerprint,
  isoWeekBounds,
  monthBounds,
} from './evaluator.js';

const d = (s: string) => s as DateOnly;

describe('computeEvidenceFingerprint', () => {
  it('is deterministic for the same inputs', () => {
    const ids = ['id-b', 'id-a', 'id-c'];
    const breaks = [{ from: '2026-05-01T09:00:00Z', to: '2026-05-01T09:30:00Z' }];
    const first = computeEvidenceFingerprint(ids, breaks);
    const second = computeEvidenceFingerprint(ids, breaks);
    expect(first).toBe(second);
  });

  it('sorts event IDs so order does not matter', () => {
    const breaks = [{ from: '2026-05-01T09:00:00Z', to: '2026-05-01T09:30:00Z' }];
    const fp1 = computeEvidenceFingerprint(['id-a', 'id-b'], breaks);
    const fp2 = computeEvidenceFingerprint(['id-b', 'id-a'], breaks);
    expect(fp1).toBe(fp2);
  });

  it('differs when event IDs differ', () => {
    const breaks = [{ from: '2026-05-01T09:00:00Z', to: null }];
    const fp1 = computeEvidenceFingerprint(['id-a'], breaks);
    const fp2 = computeEvidenceFingerprint(['id-b'], breaks);
    expect(fp1).not.toBe(fp2);
  });

  it('differs when breaks differ', () => {
    const ids = ['id-a'];
    const fp1 = computeEvidenceFingerprint(ids, [{ from: '2026-05-01T09:00:00Z', to: null }]);
    const fp2 = computeEvidenceFingerprint(ids, [{ from: '2026-05-01T10:00:00Z', to: null }]);
    expect(fp1).not.toBe(fp2);
  });

  it('returns a 64-character hex string (SHA-256)', () => {
    const fp = computeEvidenceFingerprint(['id-a'], []);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('computeAnswerFingerprint', () => {
  const evidenceFp = 'abc123';

  it('changes when policy version changes', () => {
    const fp1 = computeAnswerFingerprint(evidenceFp, 'version-1', 'working', null, null, null);
    const fp2 = computeAnswerFingerprint(evidenceFp, 'version-2', 'working', null, null, null);
    expect(fp1).not.toBe(fp2);
  });

  it('changes when suppression reason changes', () => {
    const fp1 = computeAnswerFingerprint(evidenceFp, 'v1', 'working', null, null, null);
    const fp2 = computeAnswerFingerprint(evidenceFp, 'v1', 'working', 'leave', null, null);
    expect(fp1).not.toBe(fp2);
  });

  it('changes when rule id changes', () => {
    const fp1 = computeAnswerFingerprint(evidenceFp, 'v1', 'working', null, 'rule-1', 1);
    const fp2 = computeAnswerFingerprint(evidenceFp, 'v1', 'working', null, 'rule-2', 1);
    expect(fp1).not.toBe(fp2);
  });

  it('changes when occurrence number changes', () => {
    const fp1 = computeAnswerFingerprint(evidenceFp, 'v1', 'working', null, 'rule-1', 1);
    const fp2 = computeAnswerFingerprint(evidenceFp, 'v1', 'working', null, 'rule-1', 2);
    expect(fp1).not.toBe(fp2);
  });

  it('is the same for equivalent null representations', () => {
    const fp1 = computeAnswerFingerprint(evidenceFp, null, 'working', null, null, null);
    const fp2 = computeAnswerFingerprint(evidenceFp, null, 'working', null, null, null);
    expect(fp1).toBe(fp2);
  });

  it('is deterministic', () => {
    const fp1 = computeAnswerFingerprint(evidenceFp, 'v1', 'holiday', 'holiday', null, null);
    const fp2 = computeAnswerFingerprint(evidenceFp, 'v1', 'holiday', 'holiday', null, null);
    expect(fp1).toBe(fp2);
  });

  it('returns a 64-character hex string', () => {
    const fp = computeAnswerFingerprint(evidenceFp, null, 'working', null, null, null);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('isoWeekBounds', () => {
  it('Monday maps to itself as isoWeekStart', () => {
    const { isoWeekStart } = isoWeekBounds(d('2026-05-04')); // Monday
    expect(isoWeekStart).toBe('2026-05-04');
  });

  it('Sunday maps to the preceding Monday as isoWeekStart', () => {
    const { isoWeekStart, isoWeekEnd } = isoWeekBounds(d('2026-05-10')); // Sunday
    expect(isoWeekStart).toBe('2026-05-04');
    expect(isoWeekEnd).toBe('2026-05-10');
  });

  it('Wednesday is in the correct week', () => {
    const { isoWeekStart, isoWeekEnd } = isoWeekBounds(d('2026-05-06')); // Wednesday
    expect(isoWeekStart).toBe('2026-05-04');
    expect(isoWeekEnd).toBe('2026-05-10');
  });

  it('week spans exactly 7 days', () => {
    const { isoWeekStart, isoWeekEnd } = isoWeekBounds(d('2026-09-28')); // Monday
    const start = new Date(`${isoWeekStart}T00:00:00Z`);
    const end = new Date(`${isoWeekEnd}T00:00:00Z`);
    const diffDays = (end.getTime() - start.getTime()) / 86_400_000;
    expect(diffDays).toBe(6); // 7 days inclusive = 6 day difference
  });

  it('day in the next week produces different weekStart', () => {
    const { isoWeekStart: ws1 } = isoWeekBounds(d('2026-05-10')); // Sunday
    const { isoWeekStart: ws2 } = isoWeekBounds(d('2026-05-11')); // Next Monday
    expect(ws1).not.toBe(ws2);
    expect(ws2).toBe('2026-05-11');
  });
});

describe('monthBounds', () => {
  it('first day of month is monthStart', () => {
    const { monthStart } = monthBounds(d('2026-05-01'));
    expect(monthStart).toBe('2026-05-01');
  });

  it('last day of May is 2026-05-31', () => {
    const { monthEnd } = monthBounds(d('2026-05-15'));
    expect(monthEnd).toBe('2026-05-31');
  });

  it('last day of February (non-leap)', () => {
    const { monthEnd } = monthBounds(d('2026-02-10'));
    expect(monthEnd).toBe('2026-02-28');
  });

  it('last day of February (leap year)', () => {
    const { monthEnd } = monthBounds(d('2024-02-15'));
    expect(monthEnd).toBe('2024-02-29');
  });

  it('last day of April is 2026-04-30', () => {
    const { monthEnd } = monthBounds(d('2026-04-20'));
    expect(monthEnd).toBe('2026-04-30');
  });

  it('day in the next month has a different monthStart', () => {
    const { monthStart: ms1 } = monthBounds(d('2026-05-31'));
    const { monthStart: ms2 } = monthBounds(d('2026-06-01'));
    expect(ms1).toBe('2026-05-01');
    expect(ms2).toBe('2026-06-01');
    expect(ms1).not.toBe(ms2);
  });

  it('provides correct full-month range', () => {
    const { monthStart, monthEnd } = monthBounds(d('2026-09-28'));
    expect(monthStart).toBe('2026-09-01');
    expect(monthEnd).toBe('2026-09-30');
  });
});
