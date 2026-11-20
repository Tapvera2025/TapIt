import type { RequestContext } from '../../../platform/dal/context.js';
import type { Tx } from '../../../platform/dal/db.js';
import { NOTIFICATION_TYPES, notify } from '../../notifications/facade.js';

const dealMessages = {
  advanceConfirmed: {
    type: NOTIFICATION_TYPES.DEAL_ADVANCE_CONFIRMED,
    title: 'Deal advance confirmed',
    body: 'The advance has been recorded for this deal.',
  },
  advanceReverted: {
    type: NOTIFICATION_TYPES.DEAL_ADVANCE_REVERTED,
    title: 'Deal advance confirmation reversed',
    body: 'Review the payment status before continuing with this deal.',
  },
  won: {
    type: NOTIFICATION_TYPES.DEAL_WON,
    title: 'Deal recorded as won',
    body: 'The deal is closed won. Review the delivery handoff.',
  },
  contractSigned: {
    type: NOTIFICATION_TYPES.CONTRACT_SIGNED,
    title: 'Deal contract signed',
    body: 'A signed contract was recorded for this deal.',
  },
} as const;

/** The people who own the original lead and the deal receive its milestones. */
export async function notifyDealMilestone(
  tx: Tx,
  ctx: RequestContext,
  deal: { id: string; originatingAgentId: string; responsibleCloserId: string },
  event: keyof typeof dealMessages,
): Promise<void> {
  await notify(tx, ctx, {
    ...dealMessages[event],
    priority: event === 'advanceReverted' ? 'operational' : 'informational',
    audience: { users: [deal.originatingAgentId, deal.responsibleCloserId] },
    link: `/company/sales/deals/${deal.id}`,
    metadata: { dealId: deal.id },
  });
}
