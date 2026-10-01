import { describe, expect, it } from 'vitest';
import { isValidLifecycleTransition } from './service.js';

describe('Lead lifecycle transitions', () => {
  it('allows the supported forward and callback paths', () => {
    expect(isValidLifecycleTransition('new', 'assigned')).toBe(true);
    expect(isValidLifecycleTransition('follow_up', 'callback_scheduled')).toBe(true);
    expect(isValidLifecycleTransition('nurture', 'contacted')).toBe(true);
  });

  it('does not allow arbitrary or terminal fabrication', () => {
    expect(isValidLifecycleTransition('new', 'proposal_sent')).toBe(false);
    expect(isValidLifecycleTransition('assigned', 'closed_lost')).toBe(false);
    expect(isValidLifecycleTransition('assigned', 'converted')).toBe(false);
  });
});
