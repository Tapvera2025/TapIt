import { describe, expect, it } from 'vitest';
import { formatMinutes } from './format-duration.js';

describe('formatMinutes', () => {
  it('formats under an hour in minutes', () => expect(formatMinutes(45)).toBe('45m'));
  it('formats whole hours', () => expect(formatMinutes(120)).toBe('2h'));
  it('formats hours and minutes', () => expect(formatMinutes(125)).toBe('2h 5m'));
  it('rounds fractions', () => expect(formatMinutes(59.6)).toBe('1h'));
  it('handles zero, null and negatives', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(null)).toBe('0m');
    expect(formatMinutes(-5)).toBe('0m');
  });
});
