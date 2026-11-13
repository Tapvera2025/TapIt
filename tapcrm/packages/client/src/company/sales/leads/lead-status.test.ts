import { describe, expect, it } from 'vitest';
import {
  isClosedLeadStatus,
  isHandedOverAway,
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

describe('a handed-over lead', () => {
  it('is view-only for the agent who handed it over while someone else holds it', () => {
    expect(isHandedOverAway({ ownerId: 'agent', currentHolderId: 'supervisor' }, 'agent')).toBe(true);
  });

  it('is worked by the person who took it', () => {
    expect(isHandedOverAway({ ownerId: 'agent', currentHolderId: 'supervisor' }, 'supervisor')).toBe(false);
  });

  it('goes back to normal once the owner holds it again (reassigned back, or never handed over)', () => {
    expect(isHandedOverAway({ ownerId: 'agent', currentHolderId: 'agent' }, 'agent')).toBe(false);
    expect(isHandedOverAway({ ownerId: 'agent', currentHolderId: null }, 'agent')).toBe(false);
  });

  it('does not concern anyone else, such as a manager looking at it', () => {
    expect(isHandedOverAway({ ownerId: 'agent', currentHolderId: 'supervisor' }, 'team-lead')).toBe(false);
  });
});
