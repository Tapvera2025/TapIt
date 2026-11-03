import { describe, expect, it } from 'vitest';
import { isBookableCallbackTime, isValidCallbackTransition } from './callback-state.js';

describe('callback lifecycle', () => {
  it('allows only pending callbacks to resolve or reschedule', () => {
    expect(isValidCallbackTransition('pending', 'completed')).toBe(true);
    expect(isValidCallbackTransition('pending', 'rescheduled')).toBe(true);
    expect(isValidCallbackTransition('completed', 'pending')).toBe(false);
    expect(isValidCallbackTransition('rescheduled', 'pending')).toBe(false);
  });
});

describe('callback time', () => {
  const now = new Date('2026-11-03T05:00:30Z');

  it('accepts a future time and the current minute', () => {
    expect(isBookableCallbackTime(new Date('2026-11-03T06:00:00Z'), now)).toBe(true);
    expect(isBookableCallbackTime(new Date('2026-11-03T05:00:00Z'), now)).toBe(true);
  });

  it('rejects a time that has passed', () => {
    expect(isBookableCallbackTime(new Date('2026-11-03T04:58:00Z'), now)).toBe(false);
    expect(isBookableCallbackTime(new Date('2026-11-02T05:00:00Z'), now)).toBe(false);
  });
});
