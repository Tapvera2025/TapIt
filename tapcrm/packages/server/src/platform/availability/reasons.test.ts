import { describe, expect, it } from 'vitest';
import { describeEligibilityReasons } from './reasons.js';

describe('availability reasons in plain words', () => {
  it('turns reason codes into words people understand', () => {
    expect(describeEligibilityReasons(['not_punched_in'])).toBe('not punched in');
    expect(describeEligibilityReasons(['on_break', 'outside_shift'])).toBe(
      'on a break, outside shift hours',
    );
  });

  it('copes with a reason it does not know', () => {
    expect(describeEligibilityReasons(['new_rule_added'])).toBe('new rule added');
  });
});
