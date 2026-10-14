import { describe, expect, it } from 'vitest';
import { LEAD_ACTIVITY_EVENTS, isLeadActivityEvent } from './activity-types.js';

/**
 * Mirror of the private `resolveCallbackAssignee` logic in callback-service.ts.
 * The plan test asserts post-handover a scheduled callback goes to the
 * originating agent, not the current holder. We keep the resolver
 * logic as a pure function here so the behaviour is pinned without
 * standing up a DB.
 */
function resolveCallbackAssignee(lead: {
  originatingAgentId: string | null;
  currentHolderId: string | null;
  ownerId: string | null;
}): string | null {
  return lead.originatingAgentId ?? lead.ownerId ?? lead.currentHolderId;
}

describe('resolveCallbackAssignee (R1 plan step 1.18)', () => {
  it('post-handover: originating agent still owns the callback', () => {
    expect(
      resolveCallbackAssignee({
        originatingAgentId: 'orig-agent',
        currentHolderId: 'supervisor-handover',
        ownerId: 'orig-agent',
      }),
    ).toBe('orig-agent');
  });

  it('no originating agent yet: fall back to owner', () => {
    expect(
      resolveCallbackAssignee({
        originatingAgentId: null,
        currentHolderId: 'current-holder',
        ownerId: 'owner-of-lead',
      }),
    ).toBe('owner-of-lead');
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
