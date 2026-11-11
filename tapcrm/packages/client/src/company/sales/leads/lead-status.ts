/**
 * Lead status choices for the lead page.
 *
 * The API owns the rules and rejects any move they do not allow
 * (LIFECYCLE_TRANSITIONS in server/src/modules/sales/leads/service.ts); this
 * copy only decides which moves to offer, so keep the two in step.
 */
const STATUS_MOVES: Readonly<Record<string, readonly string[]>> = {
  new: ['assigned'],
  assigned: ['contacted'],
  contacted: ['discovery'],
  discovery: ['proposal_sent'],
  proposal_sent: ['follow_up'],
  // "Callback scheduled" comes from booking a callback, not from this list.
  follow_up: ['nurture'],
  callback_scheduled: ['contacted', 'follow_up', 'nurture'],
  nurture: ['contacted'],
};

const STATUS_LABELS: Readonly<Record<string, string>> = {
  new: 'New',
  assigned: 'Assigned',
  contacted: 'Contacted',
  discovery: 'Discovery',
  proposal_sent: 'Proposal sent',
  follow_up: 'Follow up',
  callback_scheduled: 'Callback scheduled',
  nurture: 'Nurture',
  converted: 'Converted',
  closed_lost: 'Closed lost',
};

const LOSS_REASON_LABELS: Readonly<Record<string, string>> = {
  not_interested: 'Not interested',
  no_budget: 'No budget',
  no_need: 'No need',
  competitor: 'Went with a competitor',
  unqualified: 'Not a fit',
  timing: 'Bad timing',
  duplicate: 'Duplicate lead',
  other: 'Other',
  unspecified: 'Not specified',
};

const STATUS_MEANINGS: Readonly<Record<string, string>> = {
  new: 'Just came in. Nobody owns it yet.',
  assigned: 'Has an owner, waiting for the first call.',
  contacted: 'Someone has spoken to them.',
  discovery: 'Working out exactly what they need.',
  proposal_sent: 'An offer or quote has gone out.',
  follow_up: 'Waiting on their decision. Keep following up.',
  callback_scheduled: 'A callback is booked.',
  nurture: 'Not ready yet. Keep in touch.',
  converted: 'Turned into a deal.',
  closed_lost: 'Closed. They are not going ahead.',
};

/** What a status means, in a sentence. */
export function leadStatusMeaning(status: string): string {
  return STATUS_MEANINGS[status] ?? '';
}

export function leadStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replaceAll('_', ' ');
}

export function lossReasonLabel(reason: string): string {
  return LOSS_REASON_LABELS[reason] ?? reason.replaceAll('_', ' ');
}

export function isClosedLeadStatus(status: string): boolean {
  return status === 'converted' || status === 'closed_lost';
}

/** The statuses a person can move a lead to from `status`. */
export function statusMoveOptions(
  status: string,
): Array<{ value: string; label: string }> {
  return (STATUS_MOVES[status] ?? []).map((value) => ({
    value,
    label: leadStatusLabel(value),
  }));
}

/** Reasons a person can pick when marking a lead lost ("not specified" is for the system). */
export const LOSS_REASON_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  'not_interested',
  'no_budget',
  'no_need',
  'competitor',
  'unqualified',
  'timing',
  'duplicate',
  'other',
].map((value) => ({ value, label: lossReasonLabel(value) }));
