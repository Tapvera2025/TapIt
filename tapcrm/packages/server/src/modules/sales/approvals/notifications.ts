import type { RequestContext } from '../../../platform/dal/context.js';
import type { Tx } from '../../../platform/dal/db.js';
import { NOTIFICATION_TYPES, clip, notify } from '../../notifications/facade.js';
import type { ApprovalVerdict } from './types.js';

interface ApprovalNotificationRef {
  readonly id: string;
  readonly dealId: string;
  readonly commercialsId: string;
}

export async function notifyProposalReview(
  tx: Tx,
  ctx: RequestContext,
  request: ApprovalNotificationRef,
  approverId: string | null,
  event: 'requested' | 'escalated',
): Promise<void> {
  const escalated = event === 'escalated';
  await notify(tx, ctx, {
    type: escalated ? NOTIFICATION_TYPES.PROPOSAL_APPROVAL_ESCALATED : NOTIFICATION_TYPES.PROPOSAL_APPROVAL_REQUESTED,
    priority: 'operational',
    audience: {
      superAdmins: true,
      ...(approverId ? { holders: { action: 'approvals:decide', userIds: [approverId] } } : {}),
    },
    title: escalated ? 'Proposal approval overdue' : 'Sales proposal needs approval',
    body: escalated
      ? 'A proposal was escalated and is waiting for a decision.'
      : 'A salesperson submitted a proposal for review.',
    link: `/company/sales/approvals?request=${request.id}`,
    metadata: { requestId: request.id, dealId: request.dealId, commercialsId: request.commercialsId },
  });
}

const decisionMessages = {
  approve: { title: 'Proposal approved', body: 'You can publish the approved version and share it with the customer.' },
  reject: { title: 'Proposal rejected', body: 'Review the decision before submitting an updated proposal.' },
  return: { title: 'Proposal returned for changes', body: 'Review the decision and update the proposal before resubmitting.' },
} satisfies Record<ApprovalVerdict, { title: string; body: string }>;

export async function notifyProposalDecision(
  tx: Tx,
  ctx: RequestContext,
  request: ApprovalNotificationRef & { readonly requestedBy: string },
  verdict: ApprovalVerdict,
  comment?: string,
): Promise<void> {
  const message = decisionMessages[verdict];
  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.PROPOSAL_APPROVAL_DECIDED,
    priority: 'operational',
    audience: { users: [request.requestedBy] },
    title: message.title,
    body: comment ? clip(`${message.body}\n${comment}`, 2000) : message.body,
    link: `/company/sales/deals/${request.dealId}/proposals?version=${request.commercialsId}`,
    metadata: { requestId: request.id, dealId: request.dealId, commercialsId: request.commercialsId, verdict },
  });
}
