/**
 * Resolve the agent who should own a new callback.
 *
 * Callbacks route to the lead's relationship owner (`owner_id`), not to the
 * temporary `current_holder_id` (PRD §12 R-HAND-04, R1 plan step 1.18): a
 * live-call handover moves only the holder, so a supervisor finishing a
 * handover call schedules the follow-up back to the owner. A reassignment
 * moves `owner_id`, so callbacks booked after it go to the new owner.
 *
 * `originating_agent_id` is sourcing credit, which a reassignment keeps by
 * default (PRD L6). It is only a fallback for a lead without an owner;
 * preferring it would send new callbacks back to an agent the lead was
 * taken away from.
 */
export function resolveCallbackAssignee(lead: {
  originatingAgentId: string | null;
  currentHolderId: string | null;
  ownerId: string | null;
}): string | null {
  return lead.ownerId ?? lead.originatingAgentId ?? lead.currentHolderId;
}
