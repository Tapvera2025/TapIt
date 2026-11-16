/**
 * The next step on a lead's page, for whoever is looking at it.
 *
 * Mirrors the lead rules the API enforces (LIFECYCLE_TRANSITIONS in
 * server/src/modules/sales/leads/service.ts, the Bid Pool in
 * server/src/modules/sales/bidding/, callbacks and live-call handovers) so
 * the guide only offers moves the API will accept.
 */
import type { Handover, Lead, LeadCallback } from '../leads/api.js';
import { lossReasonLabel } from '../leads/lead-status.js';
import {
  danger,
  focus,
  go,
  mailHref,
  onePrimary,
  primary,
  run,
  secondary,
  telHref,
  type GuideAction,
  type GuideLeadStatus,
  type GuideStep,
  type Guidance,
} from './guidance.js';

/** The page anchors the guide points at (LeadDetailsPage gives its panels these ids). */
export const LEAD_ANCHORS = {
  status: 'lead-status',
  callbacks: 'lead-callbacks',
  handover: 'lead-handover',
} as const;

export interface LeadViewer {
  readonly id: string;
  readonly canEditLead: boolean;
  readonly canCreateDeal: boolean;
  readonly canReassign: boolean;
}

export interface LeadGuideInput {
  readonly lead: Lead;
  readonly callbacks: readonly LeadCallback[];
  readonly handovers: readonly Handover[];
  /** The deal this lead became, when it was converted. */
  readonly dealId: string | null;
  readonly viewer: LeadViewer;
  readonly now: Date;
  /** An instant for people to read, in the organization's timezone. */
  readonly formatWhen: (iso: string) => string;
}

const CONTACTED = new Set(['contacted', 'discovery', 'proposal_sent', 'follow_up', 'callback_scheduled', 'nurture', 'converted']);
const NEEDS_CLEAR = new Set(['proposal_sent', 'follow_up', 'converted']);
const JUST_ADDED_MS = 15 * 60_000;

/** Statuses the lead has been in, from its history and where it is now. */
function statusesReached(lead: Lead): Set<string> {
  const reached = new Set<string>([lead.status]);
  for (const activity of lead.activities) {
    const to = activity.metadata?.['to'];
    if (activity.eventName === 'lead.status_changed' && typeof to === 'string') reached.add(to);
    if (activity.eventName === 'lead.nurtured') reached.add('nurture');
    if (activity.eventName.startsWith('callback.') || activity.eventName === 'call.recorded') reached.add('contacted');
  }
  return reached;
}

function reachedAny(reached: Set<string>, wanted: Set<string>): boolean {
  for (const status of reached) if (wanted.has(status)) return true;
  return false;
}

/** Owner → first contact → needs understood → deal, or closed as lost. */
export function leadSteps(lead: Lead): GuideStep[] {
  const reached = statusesReached(lead);
  const lost = lead.status === 'closed_lost';
  const converted = lead.status === 'converted';
  const done = {
    owner: lead.ownerId !== null || converted,
    contact: reachedAny(reached, CONTACTED),
    needs: reachedAny(reached, NEEDS_CLEAR),
    deal: converted,
  };
  const rows: Array<{ key: keyof typeof done; label: string }> = [
    { key: 'owner', label: 'Owner assigned' },
    { key: 'contact', label: 'First contact' },
    { key: 'needs', label: 'Needs understood' },
    { key: 'deal', label: lost ? 'Closed as lost' : 'Deal created' },
  ];
  let current = false;
  return rows.map(({ key, label }) => {
    if (done[key]) return { key, label, state: 'done' };
    if (lost) return { key, label, state: key === 'deal' ? 'lost' : 'skipped' };
    if (!current) {
      current = true;
      return { key, label, state: 'current' };
    }
    return { key, label, state: 'upcoming' };
  });
}

/**
 * A lead is "stalled" until something clears the flag, which today only an
 * import reassignment does. Work done since it was flagged means it is
 * moving again, so the guide stops treating it as stalled.
 */
export function isStillStalled(lead: Lead): boolean {
  if (!lead.stalledAt) return false;
  const flagged = new Date(lead.stalledAt).getTime();
  return !lead.activities.some((activity) => activity.eventName !== 'lead.stalled' && new Date(activity.createdAt).getTime() > flagged);
}

function contactName(lead: Lead): string {
  return lead.contactName.trim() || 'this lead';
}

/** Call and email links for the lead, when it has a number or address. */
function reachActions(lead: Lead): GuideAction[] {
  const actions: GuideAction[] = [];
  const tel = telHref(lead.phone);
  const mail = mailHref(lead.email);
  if (tel) actions.push(secondary(`Call ${lead.phone?.trim() ?? ''}`.trim(), { kind: 'link', href: tel }));
  if (mail) actions.push(secondary('Send an email', { kind: 'link', href: mail }));
  return actions;
}

/** Leads with the call link when there is a number to dial, otherwise with `fallback`. */
function callFirst(reach: readonly GuideAction[], fallback: GuideAction): GuideAction[] {
  const call = reach.find((action) => action.do.kind === 'link' && action.do.href.startsWith('tel:'));
  if (!call) return [{ ...fallback, emphasis: 'primary' }, ...reach];
  return [{ ...call, emphasis: 'primary' }, { ...fallback, emphasis: 'secondary' }, ...reach.filter((action) => action !== call)];
}

const setStatus = (status: GuideLeadStatus) => run({ type: 'lead-status', status });
const bookCallback = focus(LEAD_ANCHORS.callbacks);
const markLost = danger('Mark as lost', focus(LEAD_ANCHORS.status));

/** What the holder should do next, as a short phrase ("make the first call"). */
function holderNextStep(lead: Lead, callback: LeadCallback | undefined, formatWhen: (iso: string) => string): string {
  if (callback) return `call back at ${formatWhen(callback.scheduledAt)}`;
  switch (lead.status) {
    case 'new':
    case 'assigned':
      return 'make the first call';
    case 'contacted':
      return 'find out what they need';
    case 'discovery':
      return 'turn it into a deal';
    case 'proposal_sent':
      return 'follow up on the offer';
    case 'follow_up':
      return 'book the next conversation';
    case 'callback_scheduled':
      return 'decide what happens after the callback';
    case 'nurture':
      return 'keep in touch until they are ready';
    default:
      return 'keep the lead moving';
  }
}

export function leadGuidance(input: LeadGuideInput): Guidance {
  const { lead, viewer, now, formatWhen } = input;
  const base = { context: `Lead #${lead.leadNumber}`, steps: leadSteps(lead), stepsKind: 'progress' as const };
  const name = contactName(lead);

  if (lead.status === 'closed_lost') {
    return {
      ...base,
      tone: 'done',
      title: 'This lead is closed as lost',
      short: 'Closed as lost',
      detail: `${lead.lossReason ? `Reason: ${lossReasonLabel(lead.lossReason)}. ` : ''}Its history stays here for reference. If ${name} gets in touch again, add them as a new lead.`,
      actions: [],
    };
  }

  if (lead.status === 'converted') {
    return {
      ...base,
      tone: 'done',
      title: 'This lead is now a deal',
      short: 'Now a deal',
      detail: 'The proposal, approval, advance payment and the win all happen on the deal.',
      actions: input.dealId ? [primary('Open the deal', go(`/company/sales/deals/${input.dealId}`))] : [],
    };
  }

  const handover = input.handovers.find((item) => item.status === 'pending' || (item.status === 'accepted' && item.disposition === null));
  if (handover) return { ...base, ...handoverGuidance(handover, lead, viewer) };

  if (!lead.ownerId) return { ...base, ...unownedGuidance(lead, viewer, formatWhen) };

  const pendingCallback = input.callbacks.find((callback) => callback.status === 'pending');

  if (lead.currentHolderId !== viewer.id) {
    const holder = lead.currentHolderName ?? lead.ownerName ?? 'A colleague';
    const theirNext = holderNextStep(lead, pendingCallback, formatWhen);
    if (viewer.canReassign && isStillStalled(lead)) {
      return {
        ...base,
        tone: 'act',
        title: `${holder}'s lead has gone quiet`,
        short: 'Lead has gone quiet',
        badge: 'Stalled',
        detail: `Nothing has happened on it for a while. Check in with ${holder}, or give it to someone who can work it now.`,
        waitingOn: holder,
        actions: [primary('Reassign', run({ type: 'reassign-lead' }))],
      };
    }
    return {
      ...base,
      tone: 'info',
      title: `${holder} is working this lead`,
      short: `With ${holder}`,
      detail: viewer.canReassign
        ? `Their next step: ${theirNext}. You can reassign it if it needs a different owner.`
        : lead.ownerId === viewer.id
          ? `You handed this lead to ${holder}, who works it now. You can still see it, but only ${holder} can change its status, book callbacks or turn it into a deal until a manager gives it back to you. Their next step: ${theirNext}.`
          : `Only the person holding a lead can call, book callbacks or turn it into a deal. Their next step: ${theirNext}.`,
      waitingOn: holder,
      actions: viewer.canReassign ? [secondary('Reassign', run({ type: 'reassign-lead' }))] : [],
    };
  }

  return { ...base, ...holderGuidance(input, pendingCallback, now) };
}

type GuidanceBody = Omit<Guidance, 'context' | 'steps' | 'stepsKind'>;

function handoverGuidance(handover: Handover, lead: Lead, viewer: LeadViewer): GuidanceBody {
  const name = contactName(lead);
  const from = handover.fromUserName ?? 'A colleague';
  const to = handover.toUserName ?? (handover.handoverMode === 'team_queue' ? 'your sales team' : 'a colleague');
  const receiving = handover.toUserId === viewer.id;
  const sending = handover.fromUserId === viewer.id;

  if (handover.status === 'pending' && receiving) {
    return {
      tone: 'act',
      title: `${from} wants to hand you a live call`,
      short: 'Live call waiting for you',
      badge: 'Live call',
      detail: `${name} is on the line now. Accept to take over the call, or decline so ${from} can try someone else. The offer lapses after 5 minutes.`,
      waitingOn: 'You',
      actions: [
        primary('Accept the call', run({ type: 'accept-handover', handoverId: handover.id })),
        secondary('Decline', run({ type: 'decline-handover', handoverId: handover.id })),
      ],
    };
  }
  if (handover.status === 'accepted' && receiving) {
    return {
      tone: 'act',
      title: 'Record how the call went',
      short: 'Record the call outcome',
      detail: `You took over the call with ${name}. Choose Accepted if they want to go ahead, Callback to book a time, or Rejected to close the lead as lost.`,
      waitingOn: 'You',
      actions: [primary('Record the outcome', focus(LEAD_ANCHORS.handover))],
    };
  }
  if (handover.status === 'pending' && sending) {
    return {
      tone: 'wait',
      title: handover.toUserId ? `Waiting for ${to} to take the call` : 'Waiting for someone on your team to take the call',
      short: 'Handover offered',
      detail: `Stay on the line with ${name}. If nobody accepts within 5 minutes, the offer lapses and you can try someone else.`,
      waitingOn: to,
      actions: [],
    };
  }
  if (handover.status === 'accepted' && sending) {
    return {
      tone: 'wait',
      title: `${to} is on the call`,
      short: `${to} took the call`,
      detail: 'They took over the call and will record how it went. You will see the outcome here.',
      waitingOn: to,
      actions: [],
    };
  }
  if (handover.status === 'pending' && !handover.toUserId) {
    return {
      tone: 'info',
      title: `${from} needs someone to take a live call`,
      short: 'Live call needs a taker',
      detail: 'It is waiting in the team queue. Anyone free on the team can pick it up from Handovers.',
      waitingOn: 'Your sales team',
      actions: [secondary('Open Handovers', go('/company/sales/handovers/incoming'))],
    };
  }
  return {
    tone: 'info',
    title: 'A live-call handover is in progress',
    short: 'Handover in progress',
    detail: `${from} is handing the call with ${name} to ${to}.`,
    waitingOn: to,
    actions: [],
  };
}

function unownedGuidance(lead: Lead, viewer: LeadViewer, formatWhen: (iso: string) => string): GuidanceBody {
  const assign = run({ type: 'reassign-lead' });
  if (lead.bidState === 'pool_open') {
    const deadline = lead.bidPoolExpiresAt ? `by ${formatWhen(lead.bidPoolExpiresAt)}` : 'within 10 minutes';
    return {
      tone: 'wait',
      title: 'Waiting in the Bid Pool for an agent',
      short: 'In the Bid Pool',
      detail: `Agents who are punched in can claim it now. If nobody does ${deadline}, TapIt gives it to the free agent with the fewest open leads.`,
      waitingOn: 'An agent to claim it',
      actions: viewer.canReassign
        ? [secondary('Assign it now', assign), secondary('Open the Bid Pool', go('/company/sales/bid-pool'))]
        : [primary('Open the Bid Pool', go('/company/sales/bid-pool'))],
    };
  }
  const why = lead.bidState === 'triage'
    ? 'Nobody claimed it in the Bid Pool and no agent was free to take it.'
    : 'TapIt could not give it an owner automatically.';
  if (viewer.canReassign) {
    return {
      tone: 'act',
      title: 'Pick an owner for this lead',
      short: 'Needs an owner',
      badge: lead.bidState === 'triage' ? 'In Triage' : undefined,
      detail: `${why} Assign it to someone who can call today.`,
      waitingOn: 'You',
      actions: [primary('Assign an owner', assign), ...(lead.bidState === 'triage' ? [secondary('Open Triage', go('/company/sales/triage'))] : [])],
    };
  }
  return {
    tone: 'wait',
    title: 'Waiting for a manager to assign it',
    short: 'Waiting for an owner',
    detail: `${why} A sales manager will pick an owner.`,
    waitingOn: 'A sales manager',
    actions: [],
  };
}

function holderGuidance(input: LeadGuideInput, callback: LeadCallback | undefined, now: Date): GuidanceBody {
  const { lead, viewer, formatWhen } = input;
  const name = contactName(lead);
  const reach = reachActions(lead);
  const canConvert = viewer.canCreateDeal;
  const edit = viewer.canEditLead;
  const convert = primary('Qualify into a deal', run({ type: 'convert-lead' }));
  const lost = edit ? [markLost] : [];
  const justAdded = lead.createdBy === viewer.id && now.getTime() - new Date(lead.createdAt).getTime() < JUST_ADDED_MS;

  if (callback) {
    const due = new Date(callback.scheduledAt).getTime();
    if (due <= now.getTime()) {
      return {
        tone: 'act',
        title: `Call ${name} back now`,
        short: 'Callback overdue',
        badge: 'Overdue',
        detail: `The callback was due ${formatWhen(callback.scheduledAt)}. If it is not done within 30 minutes of that time it is marked missed. After the call, record how it went.`,
        waitingOn: 'You',
        actions: callFirst(reach, secondary('Record the outcome', focus(LEAD_ANCHORS.callbacks))),
      };
    }
    return {
      tone: 'wait',
      title: `Callback booked for ${formatWhen(callback.scheduledAt)}`,
      short: 'Callback booked',
      detail: 'TapIt reminds you an hour before and again 15 minutes before. After the call, record how it went, or reschedule if the time no longer works.',
      waitingOn: 'You, at the booked time',
      actions: [secondary('Record the outcome', focus(LEAD_ANCHORS.callbacks)), ...reach],
    };
  }

  if (isStillStalled(lead)) {
    return {
      tone: 'act',
      title: `Get back in touch with ${name}`,
      short: 'Lead has gone quiet',
      badge: 'Stalled',
      detail: 'Nothing has happened on this lead for a while. Call them now or book a callback. If they are not interested, mark it lost.',
      waitingOn: 'You',
      actions: [...callFirst(reach, secondary('Book a callback', bookCallback)), ...lost],
    };
  }

  const tips: string[] = [];
  let body: GuidanceBody;
  switch (lead.status) {
    case 'new':
    case 'assigned': {
      body = {
        tone: 'act',
        title: `Make the first call to ${name}`,
        short: `Call ${name}`,
        badge: justAdded ? 'Just added' : undefined,
        detail: 'Introduce yourself and ask what they need. Once you have spoken to them, mark the lead as contacted.',
        waitingOn: 'You',
        actions: [
          ...(edit ? [primary('Mark as contacted', setStatus(lead.status === 'new' ? 'assigned' : 'contacted'))] : []),
          ...reach,
          secondary('Book a callback', bookCallback),
          ...lost,
        ],
      };
      tips.push('Could not get through? Book a callback for a better time.');
      break;
    }
    case 'contacted':
      body = {
        tone: 'act',
        title: 'Find out exactly what they need',
        short: 'Understand their needs',
        detail: 'Ask about the requirement, budget and timeline. Once you are discussing specifics, move the lead to Discovery.',
        waitingOn: 'You',
        actions: [
          ...(edit ? [primary('Move to Discovery', setStatus('discovery'))] : []),
          ...(canConvert ? [secondary('Ready to buy? Qualify into a deal', run({ type: 'convert-lead' }))] : []),
          secondary('Book a callback', bookCallback),
          ...lost,
        ],
      };
      break;
    case 'discovery':
      body = {
        tone: 'act',
        title: 'Turn it into a deal',
        short: 'Qualify into a deal',
        detail: canConvert
          ? 'If they want to go ahead and the need is clear, create a deal. The deal is where you build the proposal, get it approved and collect the advance.'
          : 'If they want to go ahead, ask a colleague who can create deals to qualify it. The deal is where the proposal and payment happen.',
        waitingOn: 'You',
        actions: [
          ...(canConvert ? [convert] : []),
          ...(edit ? [secondary('Sent an informal quote? Mark proposal sent', setStatus('proposal_sent'))] : []),
          secondary('Not ready yet? Book a callback', bookCallback),
          ...lost,
        ],
      };
      break;
    case 'proposal_sent':
      body = {
        tone: 'act',
        title: 'Follow up on what you sent',
        short: 'Follow up',
        detail: 'Check they received it and answer their questions. When they agree, turn the lead into a deal.',
        waitingOn: 'You',
        actions: [
          ...(canConvert ? [convert] : []),
          ...(edit ? [secondary('Mark as follow-up', setStatus('follow_up'))] : []),
          secondary('Book a callback', bookCallback),
          ...lost,
        ],
      };
      break;
    case 'follow_up':
      body = {
        tone: 'act',
        title: 'Book the next conversation',
        short: 'Book a callback',
        detail: 'Pick a time to talk again. If they would rather wait a few months, move the lead to Nurture instead.',
        waitingOn: 'You',
        actions: [
          primary('Book a callback', bookCallback),
          ...(canConvert ? [secondary('Qualify into a deal', run({ type: 'convert-lead' }))] : []),
          ...(edit ? [secondary('Move to Nurture', setStatus('nurture'))] : []),
          ...lost,
        ],
      };
      break;
    case 'callback_scheduled':
      body = {
        tone: 'act',
        title: 'Decide what happens after the callback',
        short: 'Update the status',
        detail: 'The callback is finished. Mark the lead as contacted to carry on, keep following up, or move it to Nurture.',
        waitingOn: 'You',
        actions: [
          ...(edit ? [primary('Mark as contacted', setStatus('contacted')), secondary('Keep following up', setStatus('follow_up')), secondary('Move to Nurture', setStatus('nurture'))] : []),
          ...lost,
        ],
      };
      break;
    case 'nurture':
      body = {
        tone: 'info',
        title: `Keep in touch with ${name}`,
        short: 'Nurturing',
        detail: 'They are not ready yet. Check in now and then. When they want to talk, mark the lead as contacted again.',
        waitingOn: 'You',
        actions: [
          ...(edit ? [primary('They are ready: mark as contacted', setStatus('contacted'))] : []),
          secondary('Book a callback', bookCallback),
          ...reach,
          ...lost,
        ],
      };
      break;
    default:
      body = { tone: 'info', title: 'Keep the lead moving', detail: 'Update its status as the conversation moves on.', waitingOn: 'You', actions: [...reach] };
  }
  if (!edit && !canConvert) tips.push('You can view this lead, but changing it needs edit access.');
  tips.push('Need someone senior on a live call? Use “Hand over a live call” on this page.');
  return { ...body, actions: onePrimary(body.actions), tips };
}

/** A two-or-three word hint for the leads list: what the lead needs next, from the viewer's side. */
export function leadRowHint(lead: Lead, viewerId: string): { label: string; urgent: boolean } {
  if (lead.status === 'converted') return { label: 'Now a deal', urgent: false };
  if (lead.status === 'closed_lost') return { label: 'Lost', urgent: false };
  if (!lead.ownerId) return { label: lead.bidState === 'pool_open' ? 'In the Bid Pool' : 'Needs an owner', urgent: lead.bidState !== 'pool_open' };
  if (lead.currentHolderId !== viewerId) return { label: `With ${lead.currentHolderName ?? lead.ownerName ?? 'a colleague'}`, urgent: false };
  if (isStillStalled(lead)) return { label: 'Gone quiet', urgent: true };
  switch (lead.status) {
    case 'new':
    case 'assigned':
      return { label: 'Call them', urgent: true };
    case 'contacted':
      return { label: 'Find their needs', urgent: false };
    case 'discovery':
      return { label: 'Qualify into a deal', urgent: false };
    case 'proposal_sent':
      return { label: 'Follow up', urgent: false };
    case 'follow_up':
      return { label: 'Book a callback', urgent: false };
    case 'callback_scheduled':
      return { label: 'Callback booked', urgent: false };
    case 'nurture':
      return { label: 'Keep in touch', urgent: false };
    default:
      return { label: 'Open it', urgent: false };
  }
}
