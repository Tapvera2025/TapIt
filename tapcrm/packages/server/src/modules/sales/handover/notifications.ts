import type { RequestContext } from '../../../platform/dal/context.js';
import type { Tx } from '../../../platform/dal/db.js';
import { notify } from '../../notifications/facade.js';

const link = (leadId: string) => `/company/sales/leads/${leadId}`;
const recipients = (ids: string[], ctx: RequestContext) => [...new Set(ids)].filter((id) => id !== ctx.principal.id);

export async function notifyHandoverOffered(tx: Tx, ctx: RequestContext, leadId: string, targetId: string): Promise<void> {
  const audience = recipients([targetId], ctx); if (!audience.length) return;
  await notify(tx, ctx, { type: 'handover.offered', priority: 'operational', audience: { users: audience }, title: 'New lead handover offer', body: 'A live lead handover is waiting for your response.', link: link(leadId), metadata: { leadId } });
}
export async function notifyHandoverOutcome(tx: Tx, ctx: RequestContext, leadId: string, userIds: string[], outcome: string): Promise<void> {
  const audience = recipients(userIds, ctx); if (!audience.length) return;
  await notify(tx, ctx, { type: `handover.${outcome}`, audience: { users: audience }, title: `Handover ${outcome}`, body: `The lead handover was ${outcome}.`, link: link(leadId), metadata: { leadId, outcome } });
}
export async function notifyHandoverQueued(tx: Tx, ctx: RequestContext, leadId: string, targetIds: string[]): Promise<void> {
  const audience = recipients(targetIds, ctx); if (!audience.length) return;
  await notify(tx, ctx, { type: 'handover.offered', priority: 'operational', audience: { users: audience }, title: 'New queued lead handover', body: 'A Sales handover is waiting for an eligible receiver.', link: link(leadId), metadata: { leadId, handoverMode: 'team_queue' } });
}
