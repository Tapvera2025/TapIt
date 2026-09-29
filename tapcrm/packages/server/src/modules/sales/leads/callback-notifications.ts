import type { RequestContext } from '../../../platform/dal/context.js';
import type { Tx } from '../../../platform/dal/db.js';
import { notify } from '../../notifications/facade.js';

export async function notifyCallback(tx: Tx, ctx: RequestContext, ownerId: string, leadId: string, event: 'scheduled' | 'completed' | 'missed' | 'cancelled'): Promise<void> {
  if (ownerId === ctx.principal.id) return;
  await notify(tx, ctx, { type: `callback.${event}`, priority: event === 'missed' ? 'operational' : 'informational', audience: { users: [ownerId] }, title: `Callback ${event}`, body: `Lead callback ${event}.`, link: `/company/sales/leads/${leadId}`, metadata: { leadId, event } });
}
