import { describe, expect, it } from 'vitest';
import type { DateOnly } from '@tapcrm/contracts';
import { daysBetween } from '../../platform/time.js';
import { CORRECTION_LOOKBACK_DAYS } from './policy.js';

/**
 * Pure unit tests for authorization logic embedded in the correction service.
 *
 * Integration paths (actual DB, full HTTP stack) are in
 * correction.integration.test.ts — the mandatory PostgreSQL gate.
 */

describe('AT-10 — CORRECTION_LOOKBACK_DAYS constant', () => {
  it('is exactly 60', () => {
    expect(CORRECTION_LOOKBACK_DAYS).toBe(60);
  });

  it('a workDate exactly 60 days in the past is within the window', () => {
    const today = '2026-01-10';
    const sixtyDaysAgo = '2025-11-11'; // 60 days before 2026-01-10
    expect(daysBetween(sixtyDaysAgo as DateOnly, today as DateOnly)).toBe(60);
    expect(daysBetween(sixtyDaysAgo as DateOnly, today as DateOnly) <= CORRECTION_LOOKBACK_DAYS).toBe(true);
  });

  it('a workDate 61 days in the past is outside the window', () => {
    const today = '2026-01-10';
    const sixtyOneDaysAgo = '2025-11-10'; // 61 days before 2026-01-10
    expect(daysBetween(sixtyOneDaysAgo as DateOnly, today as DateOnly)).toBe(61);
    expect(daysBetween(sixtyOneDaysAgo as DateOnly, today as DateOnly) <= CORRECTION_LOOKBACK_DAYS).toBe(false);
  });
});
