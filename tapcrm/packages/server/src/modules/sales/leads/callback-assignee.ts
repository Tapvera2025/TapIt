/**
 * Resolve the person who should own a new callback.
 *
 * Callbacks go to whoever is working the lead (`current_holder_id`). After an
 * accepted handover that is the receiver (a Supervisor or Team Lead), who
 * keeps the lead and its follow-ups until a manager reassigns it; the agent
 * who handed it over can still open the lead but no longer works it (owner
 * decision, 13 Nov 2026, replacing PRD §12 R-HAND-04, which sent the
 * follow-up back to the owner). A reassignment moves the owner and the holder
 * together, so callbacks booked after it go to the new owner.
 *
 * The owner and then `originating_agent_id` (sourcing credit) are only
 * fallbacks for a lead nobody holds.
 */
export function resolveCallbackAssignee(lead: {
  originatingAgentId: string | null;
  currentHolderId: string | null;
  ownerId: string | null;
}): string | null {
  return lead.currentHolderId ?? lead.ownerId ?? lead.originatingAgentId;
}
