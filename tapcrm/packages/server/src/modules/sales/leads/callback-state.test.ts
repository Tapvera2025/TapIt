import { describe, expect, it } from 'vitest';
import { isValidCallbackTransition } from './callback-state.js';

describe('callback lifecycle', () => {
  it('allows only pending callbacks to resolve or reschedule', () => {
    expect(isValidCallbackTransition('pending', 'completed')).toBe(true);
    expect(isValidCallbackTransition('pending', 'rescheduled')).toBe(true);
    expect(isValidCallbackTransition('completed', 'pending')).toBe(false);
    expect(isValidCallbackTransition('rescheduled', 'pending')).toBe(false);
  });
});
