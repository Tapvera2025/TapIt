import { describe, expect, it } from 'vitest';
import { computePriorityScore } from './priority.js';

describe('computePriorityScore', () => {
  it('critical direct is the highest possible score (100)', () => {
    expect(computePriorityScore('critical', 'direct')).toBe(100);
  });

  it('informational unknown is the lowest meaningful score (1.5)', () => {
    expect(computePriorityScore('informational', 'unknown')).toBe(1.5);
  });

  it('higher severity always outranks lower severity at the same confidence', () => {
    expect(computePriorityScore('critical', 'direct'))
      .toBeGreaterThan(computePriorityScore('high', 'direct'));
    expect(computePriorityScore('high', 'direct'))
      .toBeGreaterThan(computePriorityScore('moderate', 'direct'));
    expect(computePriorityScore('moderate', 'direct'))
      .toBeGreaterThan(computePriorityScore('low', 'direct'));
    expect(computePriorityScore('low', 'direct'))
      .toBeGreaterThan(computePriorityScore('informational', 'direct'));
  });

  it('higher confidence always outranks lower confidence at the same severity', () => {
    expect(computePriorityScore('high', 'direct'))
      .toBeGreaterThan(computePriorityScore('high', 'corroborated'));
    expect(computePriorityScore('high', 'corroborated'))
      .toBeGreaterThan(computePriorityScore('high', 'inferred'));
    expect(computePriorityScore('high', 'inferred'))
      .toBeGreaterThan(computePriorityScore('high', 'unknown'));
  });

  it('scales linearly in confidence for a fixed severity', () => {
    // high (70) × 0.6 (inferred) = 42
    expect(computePriorityScore('high', 'inferred')).toBe(42);
    // high (70) × 1.0 (direct) = 70
    expect(computePriorityScore('high', 'direct')).toBe(70);
  });

  it('returns a value that fits numeric(5,2) — max 2 decimal places', () => {
    const scores = [
      computePriorityScore('critical', 'direct'),
      computePriorityScore('high', 'corroborated'),
      computePriorityScore('moderate', 'inferred'),
      computePriorityScore('low', 'unknown'),
      computePriorityScore('informational', 'inferred'),
    ];
    for (const score of scores) {
      // No more than 2 decimal digits
      expect(score.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('a critical/unknown issue still outranks a low/direct issue (severity dominates)', () => {
    // critical (100) × 0.3 = 30  vs  low (20) × 1.0 = 20
    expect(computePriorityScore('critical', 'unknown'))
      .toBeGreaterThan(computePriorityScore('low', 'direct'));
  });

  it('a high/direct issue outranks a critical/unknown issue', () => {
    // high (70) × 1.0 = 70  vs  critical (100) × 0.3 = 30
    // Rule of thumb: strong evidence of a serious issue beats weak evidence of a catastrophic issue
    expect(computePriorityScore('high', 'direct'))
      .toBeGreaterThan(computePriorityScore('critical', 'unknown'));
  });

  describe('traffic boost', () => {
    it('zero clicks is identical to the no-clicks-arg form', () => {
      expect(computePriorityScore('high', 'direct', 0))
        .toBe(computePriorityScore('high', 'direct'));
    });

    it('more clicks produces a higher score at the same severity+confidence', () => {
      const noTraffic = computePriorityScore('high', 'direct', 0);
      const someTraffic = computePriorityScore('high', 'direct', 100);
      const lotsOfTraffic = computePriorityScore('high', 'direct', 10_000);
      expect(someTraffic).toBeGreaterThan(noTraffic);
      expect(lotsOfTraffic).toBeGreaterThan(someTraffic);
    });

    it('traffic boost cannot push a finding past the next-higher severity tier', () => {
      // high + max traffic should still be < critical + no traffic
      const highBoosted = computePriorityScore('high', 'direct', 10_000_000);
      const criticalBase = computePriorityScore('critical', 'direct', 0);
      expect(highBoosted).toBeLessThan(criticalBase);

      const moderateBoosted = computePriorityScore('moderate', 'direct', 10_000_000);
      const highBase = computePriorityScore('high', 'direct', 0);
      expect(moderateBoosted).toBeLessThan(highBase);
    });

    it('scores stay clamped to 100 even at absurd click counts', () => {
      expect(computePriorityScore('critical', 'direct', 10_000_000_000)).toBeLessThanOrEqual(100);
    });

    it('negative clicks are treated as zero (defensive)', () => {
      expect(computePriorityScore('high', 'direct', -5))
        .toBe(computePriorityScore('high', 'direct', 0));
    });

    it('within a severity+confidence tier, click count breaks ties monotonically', () => {
      const scores = [1, 10, 100, 1000, 10_000, 100_000]
        .map((n) => computePriorityScore('moderate', 'direct', n));
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]!).toBeGreaterThanOrEqual(scores[i - 1]!);
      }
    });
  });
});
