import { describe, expect, it } from 'vitest';
import { leadNotConvertibleReason } from '../leads/lifecycle.js';

/** Which leads can be qualified into a deal. */
describe('leadNotConvertibleReason', () => {
  it.each(['contacted', 'discovery', 'proposal_sent', 'follow_up', 'callback_scheduled', 'nurture'])(
    'lets a %s lead become a deal',
    (status) => {
      expect(leadNotConvertibleReason(status)).toBeNull();
    },
  );

  it('refuses a lead closed as lost, pointing to re-engagement', () => {
    expect(leadNotConvertibleReason('closed_lost')).toMatch(/Re-engage it first/);
  });

  it('refuses a lead nobody has spoken to yet', () => {
    expect(leadNotConvertibleReason('new')).toMatch(/Mark it as contacted/);
    expect(leadNotConvertibleReason('assigned')).toMatch(/Mark it as contacted/);
  });

  it('refuses a lead already converted', () => {
    expect(leadNotConvertibleReason('converted')).toMatch(/already been converted/);
  });
});
