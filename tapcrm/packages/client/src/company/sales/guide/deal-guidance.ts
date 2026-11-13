/**
 * The next step on a deal's page, for whoever is looking at it.
 *
 * Follows the close-readiness checks the API runs before a win can be
 * recorded (server/src/modules/sales/deals/won-readiness.ts): a published
 * proposal, approval when the proposal goes beyond the seller's limits, a
 * signed contract when one is required, the advance payment, a delivery
 * brief, and someone allowed to record the win.
 */
import type { Deal, ReadinessReport, UnmetCondition } from '../deals/api.js';
import { LOSS_REASON_LABELS, STAGE_LABELS } from '../deals/deals-helpers.js';
import type { CommercialsState } from '../proposals/api.js';
import type { DeliveryBriefState } from '../delivery/api.js';
import { focus, go, markCurrent, primary, run, secondary, type GuideStep, type Guidance } from './guidance.js';

/** The anchor DealDetailPage gives its approval decision panel. */
export const DEAL_ANCHORS = { decision: 'deal-decision' } as const;

export interface DealViewer {
  readonly id: string;
  readonly canConfirmPayment: boolean;
  readonly canRecordWin: boolean;
  /** Sales Head or admin: may act on any deal, not only their own. */
  readonly isManager: boolean;
  /**
   * A Super Admin publishes proposals directly; everyone else sends each
   * version for approval first (owner decision, 13 Nov 2026).
   */
  readonly publishesDirectly?: boolean;
}

export interface DealGuideInput {
  readonly deal: Deal;
  /** Null when the check could not be loaded (or the deal is closed). */
  readonly readiness: ReadinessReport | null;
  /**
   * The deal's proposal versions; null while not loaded. `approvalState` is
   * the latest approval request on that version (null when none was raised).
   */
  readonly commercials: ReadonlyArray<{ readonly version: number; readonly state: CommercialsState; readonly approvalState?: string | null | undefined }> | null;
  /** The delivery brief; null when there is none, undefined while not loaded. */
  readonly brief: { readonly state: DeliveryBriefState } | null | undefined;
  /** True when an approval on this deal is waiting for the viewer's decision. */
  readonly myApproval: boolean;
  readonly viewer: DealViewer;
  readonly formatWhen: (iso: string) => string;
  /**
   * Whether the viewer may open the proposal and the delivery brief. Both
   * are guarded separately from the deal (proposal prices by protected
   * constraint P1, briefs by delivery:view), so a page that was refused
   * must not be offered as the next step.
   */
  readonly access?: { readonly proposals: boolean; readonly brief: boolean } | undefined;
}

type Condition = UnmetCondition['condition'];

/**
 * What still stands between the deal and a win. Uses the API's own check
 * when it loaded, otherwise works it out from the deal's fields.
 */
export function openConditions(input: DealGuideInput): Set<Condition> {
  if (input.readiness) return new Set(input.readiness.unmet.map((item) => item.condition));
  const { deal } = input;
  const open = new Set<Condition>();
  if (!deal.commercialsId) open.add('commercials');
  if (deal.approvalStatus === 'pending' || deal.approvalStatus === 'rejected') open.add('approval');
  if (deal.contractStatus !== 'not_required' && deal.contractStatus !== 'signed') open.add('contract');
  if (deal.paymentStatus !== 'advance_confirmed' && deal.paymentStatus !== 'paid') open.add('payment');
  if (input.brief === null || input.brief?.state === 'cancelled') open.add('delivery_brief');
  if (!input.viewer.canRecordWin) open.add('authority');
  return open;
}

/** Proposal → approval → (contract) → advance → delivery brief → won. */
export function dealSteps(input: DealGuideInput): GuideStep[] {
  const { deal } = input;
  const won = deal.lifecycleStatus === 'won';
  const ended = deal.lifecycleStatus === 'lost' || deal.lifecycleStatus === 'cancelled';
  const open = openConditions(input);
  const proposalDone = won || (!open.has('commercials') && Boolean(deal.commercialsId));
  const approvalNotNeeded = deal.approvalStatus === 'not_required' && proposalDone;
  const rows: Array<{ key: string; label: string; done: boolean; skipped?: boolean }> = [
    { key: 'proposal', label: 'Proposal published', done: proposalDone },
    {
      key: 'approval',
      label: approvalNotNeeded ? 'Approval not needed' : 'Approval',
      done: won || deal.approvalStatus === 'approved',
      skipped: approvalNotNeeded,
    },
  ];
  if (deal.contractStatus !== 'not_required') rows.push({ key: 'contract', label: 'Contract signed', done: won || deal.contractStatus === 'signed' });
  rows.push(
    { key: 'advance', label: 'Advance received', done: won || deal.paymentStatus === 'advance_confirmed' || deal.paymentStatus === 'paid' },
    { key: 'brief', label: 'Delivery brief', done: won || (input.brief !== undefined ? input.brief !== null && input.brief.state !== 'cancelled' : !open.has('delivery_brief')) },
    { key: 'won', label: deal.lifecycleStatus === 'cancelled' ? 'Cancelled' : deal.lifecycleStatus === 'lost' ? 'Lost' : 'Won', done: won },
  );
  const steps = markCurrent(rows);
  if (!ended) return steps;
  return steps.map((step) => (step.key === 'won' ? { ...step, state: 'lost' } : step.state === 'done' || step.state === 'skipped' ? step : { ...step, state: 'skipped' }));
}

function latestVersion(input: DealGuideInput): { state: CommercialsState; approvalState?: string | null | undefined } | null {
  const versions = [...(input.commercials ?? [])].sort((a, b) => b.version - a.version);
  return versions[0] ?? null;
}

type Body = Omit<Guidance, 'context' | 'steps' | 'stepsKind'>;

const canOpenBriefPage = (input: DealGuideInput): boolean => input.access?.brief !== false;

export function dealGuidance(input: DealGuideInput): Guidance {
  const { deal, viewer, formatWhen } = input;
  const base = { context: `Deal #${deal.dealNumber}`, steps: dealSteps(input), stepsKind: 'progress' as const };
  const proposals = go(`/company/sales/deals/${deal.id}/proposals`);
  const briefPage = go(`/company/sales/deals/${deal.id}/delivery`);

  if (deal.lifecycleStatus === 'won') {
    return {
      ...base,
      tone: 'done',
      title: 'Deal won',
      short: 'Won',
      detail: `Recorded${deal.wonAt ? ` on ${formatWhen(deal.wonAt)}` : ''}. The delivery team works from the delivery brief.`,
      actions: canOpenBriefPage(input) ? [secondary('Open the delivery brief', briefPage)] : [],
    };
  }
  if (deal.lifecycleStatus === 'lost') {
    return {
      ...base,
      tone: 'done',
      title: 'This deal was lost',
      short: 'Lost',
      detail: `${deal.lossReason ? `Reason: ${LOSS_REASON_LABELS[deal.lossReason]}. ` : ''}Its history stays here for reference.`,
      actions: [],
    };
  }
  if (deal.lifecycleStatus === 'cancelled') {
    return { ...base, tone: 'done', title: 'This deal was cancelled after the win', short: 'Cancelled', detail: 'Its history stays here for reference.', actions: [] };
  }

  if (input.myApproval) {
    return {
      ...base,
      tone: 'act',
      title: 'Your approval is needed',
      short: 'Approve the proposal',
      badge: 'Waiting on you',
      detail: 'Every proposal from the sales team is approved before it is published. Review the price, discount, advance and terms, then approve, send it back for changes, or reject it.',
      waitingOn: 'You',
      actions: [primary('Decide now', focus(DEAL_ANCHORS.decision)), ...(input.access?.proposals !== false ? [secondary('Review the proposal', proposals)] : [])],
    };
  }

  const canOpenProposal = input.access?.proposals !== false;
  const canOpenBrief = input.access?.brief !== false;
  const noProposalAccess: Body = {
    tone: 'blocked',
    title: 'Your role can’t open this deal’s proposal',
    short: 'No access to the proposal',
    detail: 'Proposal prices are hidden from your role on this deal, so the proposal can’t be built or published from your account. Ask an admin to do it, or to give your role access.',
    waitingOn: 'An admin',
    actions: [],
  };
  const isCloser = deal.responsibleCloserId === viewer.id;
  const closer = deal.responsibleCloserName ?? 'The responsible closer';
  const yours = isCloser ? 'You' : closer;
  const open = openConditions(input);
  const latest = latestVersion(input);
  const candidates: Body[] = [];
  const waits: string[] = [];

  if (open.has('commercials')) {
    if (deal.approvalStatus === 'pending') {
      candidates.push({
        tone: 'wait',
        title: 'Waiting for the proposal to be approved',
        short: 'Waiting for approval',
        detail: 'A manager approves every proposal from the sales team before it can be published. A request not decided within 4 business hours moves up to the approver’s manager.',
        waitingOn: 'The approver',
        actions: [secondary('View the proposal', proposals)],
      });
    } else if (deal.approvalStatus === 'rejected') {
      candidates.push({
        tone: 'act',
        title: 'Revise the proposal',
        short: 'Revise the proposal',
        detail: 'The approver turned it down. Make a new version that answers their comments, then send it for approval again.',
        waitingOn: yours,
        actions: [primary('Open the proposal', proposals)],
      });
    } else if (latest?.state === 'draft' && (viewer.publishesDirectly || latest.approvalState === 'approved')) {
      candidates.push({
        tone: 'act',
        title: 'Publish the proposal',
        short: 'Publish the proposal',
        detail: viewer.publishesDirectly
          ? 'Check the items, price, advance and terms, then publish it. As Super Admin you publish directly, without approval.'
          : 'It is approved. Publish it to lock this version, then share the link with the client.',
        waitingOn: viewer.publishesDirectly ? 'You' : yours,
        actions: [primary('Open the proposal', proposals)],
      });
    } else if (latest?.state === 'draft') {
      // Owner decision, 13 Nov 2026: every version from the sales team is
      // approved before it is published.
      candidates.push({
        tone: 'act',
        title: 'Send the proposal for approval',
        short: 'Request approval',
        detail: latest.approvalState === 'invalidated'
          ? 'It changed after it was sent for approval, so it needs approving again. Request approval; once a manager approves it, publish it.'
          : 'Check the items, price, advance and terms, then request approval. Once a manager approves it, publish it and share the link with the client.',
        waitingOn: yours,
        actions: [primary('Open the proposal', proposals)],
      });
    } else {
      candidates.push({
        tone: 'act',
        title: 'Build the proposal',
        short: 'Build the proposal',
        detail: viewer.publishesDirectly && !isCloser
          ? `${closer} builds it: what is being sold, the price, the advance and the terms. As Super Admin you can also build and publish it yourself.`
          : viewer.publishesDirectly
            ? 'Add what you are selling, the price, the advance and the terms. Then publish it and share the link with the client.'
            : 'Add what you are selling, the price, the advance and the terms. Then request approval; once it is approved, publish it and share the link with the client.',
        waitingOn: yours,
        actions: [primary('Build the proposal', proposals)],
      });
    }
  } else if (open.has('approval')) {
    candidates.push(deal.approvalStatus === 'rejected'
      ? { tone: 'act', title: 'Revise the proposal', short: 'Revise the proposal', detail: 'The approver turned it down. Make a new version that answers their comments.', waitingOn: yours, actions: [primary('Open the proposal', proposals)] }
      : { tone: 'wait', title: 'Waiting for approval', short: 'Waiting for approval', detail: 'A manager has to approve the proposal before the deal can close.', waitingOn: 'The approver', actions: [secondary('View the proposal', proposals)] });
  }

  // A proposal step the viewer cannot open becomes a request to an admin.
  for (let index = 0; index < candidates.length; index += 1) {
    const item = candidates[index]!;
    if (canOpenProposal) continue;
    candidates[index] = item.tone === 'act' ? noProposalAccess : { ...item, actions: [] };
  }

  const proposalReady = !open.has('commercials');
  if (open.has('contract')) {
    const resolver = input.readiness?.unmet.find((item) => item.condition === 'contract')?.resolver;
    waits.push('a signed contract');
    candidates.push({
      tone: 'blocked',
      title: 'A signed contract is needed',
      short: 'Contract needed',
      detail: resolver ?? 'This deal needs a signed contract before it can close.',
      waitingOn: yours,
      actions: [],
    });
  }

  if (open.has('payment') && proposalReady) {
    const refund = deal.paymentStatus === 'refunded' || deal.paymentStatus === 'partially_refunded';
    if (refund) {
      candidates.push({ tone: 'blocked', title: 'A refund is outstanding', short: 'Refund outstanding', detail: 'The deal cannot close while money is being returned. Finance settles it.', waitingOn: 'Finance', actions: [] });
    } else if (viewer.canConfirmPayment) {
      candidates.push({
        tone: 'act',
        title: 'Confirm the advance payment',
        short: 'Confirm the advance',
        detail: deal.paymentStatus === 'partial'
          ? 'Only part of the advance is confirmed. When the rest arrives, record the amount and the payment reference.'
          : 'When the client’s advance arrives, record the amount and the payment reference (UTR, cheque number or invoice).',
        waitingOn: 'You',
        actions: [primary('Confirm the advance', run({ type: 'confirm-payment' }))],
      });
    } else {
      waits.push('the advance payment (Finance confirms it)');
      candidates.push({
        tone: 'wait',
        title: 'Waiting for the advance payment',
        short: 'Waiting for the advance',
        detail: 'Ask the client to pay the advance in the proposal. Finance confirms it in TapIt once it arrives.',
        waitingOn: 'The client, then Finance',
        actions: canOpenProposal ? [secondary('View the proposal', proposals)] : [],
      });
    }
  }

  if (open.has('delivery_brief') && proposalReady && !canOpenBrief) {
    candidates.push({
      tone: 'blocked',
      title: 'Your role can’t open the delivery brief',
      short: 'No access to the brief',
      detail: 'The deal needs a delivery brief before it can be won. Ask an admin to write it, or to give your role access to delivery briefs.',
      waitingOn: 'An admin',
      actions: [],
    });
  } else if (open.has('delivery_brief') && proposalReady) {
    const cancelled = input.brief?.state === 'cancelled';
    candidates.push({
      tone: 'act',
      title: cancelled ? 'Start a new delivery brief' : 'Write the delivery brief',
      short: 'Write the delivery brief',
      detail: 'Tell the delivery team what was sold: scope, timeline and the client’s contacts. It is built from the published proposal.',
      waitingOn: yours,
      actions: [primary(cancelled ? 'Start a new brief' : 'Write the brief', briefPage)],
    });
  }

  const onlyAuthority = [...open].every((condition) => condition === 'authority');
  if (open.has('authority') && onlyAuthority) {
    candidates.push({
      tone: 'wait',
      title: 'Ready to win: waiting for the Sales Head',
      short: 'Ready for the Sales Head',
      detail: 'Everything is in place. The Sales Head (or an admin) records the win.',
      waitingOn: 'The Sales Head',
      actions: [],
    });
  }

  if (open.size === 0) {
    candidates.push({
      tone: 'act',
      title: 'Record the win',
      short: 'Record the win',
      badge: 'Ready',
      detail: 'The proposal, approval, advance and delivery brief are all in place. Recording the win hands the deal to delivery.',
      waitingOn: 'You',
      actions: [primary('Record the win', run({ type: 'record-win' }))],
    });
  }

  // Something the viewer can do now beats waiting on someone else.
  const chosen = candidates.find((item) => item.tone === 'act') ?? candidates[0] ?? {
    tone: 'info' as const,
    title: 'Keep the deal moving',
    detail: 'Open the proposal to continue.',
    actions: [secondary('Open the proposal', proposals)],
  };

  const tips: string[] = [];
  if (chosen.tone === 'act' && waits.length) tips.push(`Also still open: ${waits.join(', ')}.`);
  if (proposalReady && deal.dealStage === 'discovery') tips.push(`The proposal is out, so move the stage on from ${STAGE_LABELS.discovery} to keep the forecast honest.`);

  const forSomeoneElse = !isCloser && !viewer.isManager && chosen.tone === 'act' && chosen.waitingOn !== 'You';
  return {
    ...base,
    ...chosen,
    ...(forSomeoneElse
      ? {
        tone: 'wait' as const,
        waitingOn: closer,
        detail: `${closer} is responsible for this deal. ${chosen.detail}`,
        actions: chosen.actions.map((action) => ({ ...action, emphasis: 'secondary' as const })),
      }
      : {}),
    tips: tips.length ? tips : undefined,
  };
}
