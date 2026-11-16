import { describe, expect, it } from 'vitest';
import { LEAD_ACTIVITY_EVENTS, isLeadActivityEvent } from './activity-types.js';
import { resolveCallbackAssignee } from './callback-assignee.js';

describe('resolveCallbackAssignee', () => {
  it('post-handover: the supervisor who took the lead gets the callback, not the agent who handed it over', () => {
    expect(
      resolveCallbackAssignee({
        originatingAgentId: 'orig-agent',
        currentHolderId: 'supervisor-handover',
        ownerId: 'orig-agent',
      }),
    ).toBe('supervisor-handover');
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

  it('nobody holds it: the owner gets the callback', () => {
    expect(
      resolveCallbackAssignee({
        originatingAgentId: 'orig-agent',
        currentHolderId: null,
        ownerId: 'owner-of-lead',
      }),
    ).toBe('owner-of-lead');
  });

  it('no holder and no owner: fall back to the originating agent', () => {
    expect(
      resolveCallbackAssignee({
        originatingAgentId: 'orig-agent',
        currentHolderId: null,
        ownerId: null,
      }),
    ).toBe('orig-agent');
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
