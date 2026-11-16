import { describe, expect, it } from 'vitest';
import { leaveBlocksPunchIn } from './leave-punch.js';

describe('approved leave and punching in', () => {
  it('full-day leave stops a punch in', () => {
    expect(leaveBlocksPunchIn([{ sourceKind: 'leave', kind: 'leave-full' }])).toBe(true);
  });

  it('half-day leave does not: the person works the other half', () => {
    expect(leaveBlocksPunchIn([{ sourceKind: 'leave', kind: 'leave-first-half' }])).toBe(false);
    expect(leaveBlocksPunchIn([{ sourceKind: 'leave', kind: 'leave-second-half' }])).toBe(false);
  });

  it('WFH and break consequences never stop a punch in; no overlays at all is fine', () => {
    expect(leaveBlocksPunchIn([{ sourceKind: 'wfh', kind: 'wfh' }])).toBe(false);
    expect(leaveBlocksPunchIn([{ sourceKind: 'break-breach', kind: 'policy-consequence' }])).toBe(false);
    expect(leaveBlocksPunchIn([])).toBe(false);
  });

  it('an unknown leave kind counts as a full day, so it refuses rather than allows', () => {
    expect(leaveBlocksPunchIn([{ sourceKind: 'leave', kind: 'something-new' }])).toBe(true);
  });

  it('a full-day leave alongside other overlays still stops it', () => {
    expect(leaveBlocksPunchIn([
      { sourceKind: 'wfh', kind: 'wfh' },
      { sourceKind: 'leave', kind: 'leave-full' },
    ])).toBe(true);
  });
});
