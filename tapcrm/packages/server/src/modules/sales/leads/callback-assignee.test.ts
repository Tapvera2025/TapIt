import { describe, expect, it } from 'vitest';
import { LEAD_ACTIVITY_EVENTS, isLeadActivityEvent } from './activity-types.js';
import { resolveCallbackAssignee } from './callback-assignee.js';

describe('resolveCallbackAssignee (R1 plan step 1.18)', () => {
  it('post-handover: the owner gets the callback, not the temporary holder', () => {
    expect(
      resolveCallbackAssignee({
        originatingAgentId: 'orig-agent',
        currentHolderId: 'supervisor-handover',
        ownerId: 'orig-agent',
      }),
    ).toBe('orig-agent');
  });

  it('after a reassignment: the new owner gets the callback, not the original sourcer', () => {
    expect(
      resolveCallbackAssignee({
        originatingAgentId: 'original-sourcer',
        currentHolderId: 'new-owner',
        ownerId: 'new-owner',
      }),
    ).toBe('new-owner');
  });

  it('no originating agent yet: the owner gets the callback', () => {
    expect(
      resolveCallbackAssignee({
        originatingAgentId: null,
        currentHolderId: 'current-holder',
        ownerId: 'owner-of-lead',
      }),
    ).toBe('owner-of-lead');
  });

  it('no owner: fall back to the originating agent', () => {
    expect(
      resolveCallbackAssignee({
        originatingAgentId: 'orig-agent',
        currentHolderId: 'current-holder',
        ownerId: null,
      }),
    ).toBe('orig-agent');
  });

  it('neither originating nor owner: fall back to current holder', () => {
    expect(
      resolveCallbackAssignee({
        originatingAgentId: null,
        currentHolderId: 'current-holder',
        ownerId: null,
      }),
    ).toBe('current-holder');
  });

  it('completely unrouted: returns null', () => {
    expect(
      resolveCallbackAssignee({ originatingAgentId: null, currentHolderId: null, ownerId: null }),
    ).toBeNull();
  });
});

describe('activity type registry', () => {
  it('contains the three new types the plan adds', () => {
    expect(isLeadActivityEvent('whatsapp.message_received')).toBe(true);
    expect(isLeadActivityEvent('demo.scheduled')).toBe(true);
    expect(isLeadActivityEvent('proposal.follow_up')).toBe(true);
  });
  it('rejects unknown event names', () => {
    expect(isLeadActivityEvent('invented.event')).toBe(false);
  });
  it('still contains the existing enum values the migration preserves', () => {
    for (const existing of ['lead.created', 'lead.assigned', 'callback.scheduled', 'handover.offered']) {
      expect(LEAD_ACTIVITY_EVENTS as readonly string[]).toContain(existing);
    }
  });
});
