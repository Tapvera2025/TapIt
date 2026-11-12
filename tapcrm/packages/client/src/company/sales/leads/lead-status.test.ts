import { describe, expect, it } from 'vitest';
import {
  isClosedLeadStatus,
  leadStatusLabel,
  LOSS_REASON_OPTIONS,
  statusMoveOptions,
} from './lead-status.js';

describe('lead status choices', () => {
  it('offers the next steps a lead can take', () => {
    expect(statusMoveOptions('callback_scheduled').map((option) => option.value)).toEqual(
      ['contacted', 'follow_up', 'nurture'],
    );
    expect(statusMoveOptions('assigned')).toEqual([
      { value: 'contacted', label: 'Contacted' },
    ]);
  });

  it('never offers "callback scheduled", which comes from booking a callback', () => {
    expect(statusMoveOptions('follow_up').map((option) => option.value)).toEqual([
      'nurture',
    ]);
  });

  it('offers nothing for a closed lead', () => {
    expect(statusMoveOptions('converted')).toEqual([]);
    expect(statusMoveOptions('closed_lost')).toEqual([]);
    expect(isClosedLeadStatus('closed_lost')).toBe(true);
    expect(isClosedLeadStatus('nurture')).toBe(false);
  });

  it('labels statuses in plain words', () => {
    expect(leadStatusLabel('proposal_sent')).toBe('Proposal sent');
    expect(leadStatusLabel('callback_scheduled')).toBe('Callback scheduled');
  });

  it('does not offer the system-only "not specified" loss reason', () => {
    expect(LOSS_REASON_OPTIONS.map((option) => option.value)).not.toContain(
      'unspecified',
    );
    expect(LOSS_REASON_OPTIONS.map((option) => option.value)).toContain('other');
  });
});
