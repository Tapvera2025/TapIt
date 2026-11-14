import type { RequestContext } from '../../../platform/dal/context.js';
import type { Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { notify } from '../../notifications/facade.js';

/**
 * Callback notifications say which lead and when, in the organization's
 * time zone — "Callback reminder: a callback is due soon" on its own does not
 * tell an agent with ten callbacks a day which one to pick up.
 */

export type CallbackEvent = 'scheduled' | 'rescheduled' | 'completed' | 'missed' | 'not_reachable' | 'cancelled';
export type ReminderType = 't_minus_60' | 't_minus_15' | 'due';

interface CallbackContext {
  readonly contactName: string;
  readonly leadNumber: string;
  readonly timezone: string;
}

async function leadContext(tx: Tx, organizationId: string, leadId: string): Promise<CallbackContext> {
  const row = await tx.maybeOne<CallbackContext>(sql`
    SELECT l.contact_name AS "contactName", l.lead_number::text AS "leadNumber", o.timezone
      FROM lead l JOIN organization o ON o.id = l.organization_id
     WHERE l.organization_id = ${organizationId} AND l.id = ${leadId}
  `);
  return row ?? { contactName: 'a lead', leadNumber: '', timezone: 'UTC' };
}

/** "Mon 9 Nov, 3:30 pm" in the organization's zone. */
export function formatCallbackTime(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    }).format(at);
  } catch {
    return at.toISOString();
  }
}

export async function notifyCallback(
  tx: Tx,
  ctx: RequestContext,
  ownerId: string,
  leadId: string,
  event: CallbackEvent,
  scheduledAt?: Date,
): Promise<void> {
  if (ownerId === ctx.principal.id) return; // nobody is told about what they just did
  const lead = await leadContext(tx, ctx.organizationId, leadId);
  const when = scheduledAt ? formatCallbackTime(scheduledAt, lead.timezone) : null;
  const copy: Record<CallbackEvent, { title: string; body: string }> = {
    scheduled: { title: `Callback booked with ${lead.contactName}`, body: when ? `It is yours, on ${when}.` : 'A callback was booked for you.' },
    rescheduled: { title: `Callback with ${lead.contactName} moved`, body: when ? `The new time is ${when}.` : 'Its time was changed.' },
    completed: { title: `Callback with ${lead.contactName} recorded`, body: 'Its outcome was recorded for you.' },
    missed: { title: `Callback with ${lead.contactName} missed`, body: 'It was marked missed. Book a new time if they still need a call.' },
    not_reachable: { title: `Couldn’t reach ${lead.contactName}`, body: 'The call was made but nobody answered. Book a new time to try again.' },
    cancelled: { title: `Callback with ${lead.contactName} cancelled`, body: 'It no longer needs a call.' },
  };
  await notify(tx, ctx, {
    type: `callback.${event}`,
    priority: event === 'missed' || event === 'not_reachable' ? 'operational' : 'informational',
    audience: { users: [ownerId] },
    ...copy[event],
    link: `/company/sales/leads/${leadId}`,
    metadata: { leadId, event, ...(scheduledAt ? { scheduledAt: scheduledAt.toISOString() } : {}) },
  });
}

export async function notifyCallbackReminder(
  tx: Tx,
  ctx: RequestContext,
  ownerId: string,
  leadId: string,
  reminderType: ReminderType,
  reminderId: string,
  scheduledAt: Date,
): Promise<void> {
  const lead = await leadContext(tx, ctx.organizationId, leadId);
  const number = lead.leadNumber ? ` (lead #${lead.leadNumber})` : '';
  const title = reminderType === 'due'
    ? `Call ${lead.contactName} now`
    : `Callback with ${lead.contactName} in ${reminderType === 't_minus_60' ? '1 hour' : '15 minutes'}`;
  await notify(tx, ctx, {
    type: 'callback.reminder',
    priority: 'operational',
    audience: { users: [ownerId] },
    title,
    body: `Booked for ${formatCallbackTime(scheduledAt, lead.timezone)}${number}.`,
    link: `/company/sales/leads/${leadId}`,
    metadata: { leadId, reminderId, reminderType, scheduledAt: scheduledAt.toISOString() },
  });
}

export async function notifyCallbackMissed(
  tx: Tx,
  ctx: RequestContext,
  ownerId: string,
  supervisorId: string | null,
  leadId: string,
  callbackId: string,
  scheduledAt: Date,
): Promise<void> {
  const users = [...new Set([ownerId, supervisorId].filter((id): id is string => Boolean(id)))];
  if (users.length === 0) return;
  const lead = await leadContext(tx, ctx.organizationId, leadId);
  await notify(tx, ctx, {
    type: 'callback.missed',
    priority: 'operational',
    audience: { users },
    title: `Callback with ${lead.contactName} missed`,
    body: `It was due ${formatCallbackTime(scheduledAt, lead.timezone)} and has no outcome 30 minutes later.`,
    link: `/company/sales/leads/${leadId}`,
    metadata: { leadId, callbackId },
  });
}
