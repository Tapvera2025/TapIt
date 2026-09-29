import type { RequestContext } from '../../../platform/dal/context.js';
import type { Tx } from '../../../platform/dal/db.js';
import { notify } from '../../notifications/facade.js';

export async function notifyCallback(tx: Tx, ctx: RequestContext, ownerId: string, leadId: string, event: 'scheduled' | 'completed' | 'missed' | 'cancelled'): Promise<void> {
  if (ownerId === ctx.principal.id) return;
  await notify(tx, ctx, { type: `callback.${event}`, priority: event === 'missed' ? 'operational' : 'informational', audience: { users: [ownerId] }, title: `Callback ${event}`, body: `Lead callback ${event}.`, link: `/company/sales/leads/${leadId}`, metadata: { leadId, event } });
}

export async function notifyCallbackReminder(tx: Tx, ctx: RequestContext, ownerId: string, leadId: string, reminderType: string, reminderId: string): Promise<void> {
  await notify(tx, ctx, { type: 'callback.reminder', priority: 'operational', audience: { users: [ownerId] }, title: 'Callback reminder', body: 'A scheduled Lead callback is due soon.', link: `/company/sales/leads/${leadId}`, metadata: { leadId, reminderId, reminderType } });
}

export async function notifyCallbackMissed(tx: Tx, ctx: RequestContext, ownerId: string, supervisorId: string | null, leadId: string, callbackId: string): Promise<void> {
  const users = [...new Set([ownerId, supervisorId].filter((id): id is string => Boolean(id)))];
  if (users.length === 0) return;
  await notify(tx, ctx, { type: 'callback.missed', priority: 'operational', audience: { users }, title: 'Callback missed', body: 'A Lead callback passed its grace period without an outcome.', link: `/company/sales/leads/${leadId}`, metadata: { leadId, callbackId } });
}
