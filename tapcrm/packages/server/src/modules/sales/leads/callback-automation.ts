import type { Principal } from '@tapcrm/contracts';
import { createJobContext, type RequestContext } from '../../../platform/dal/context.js';
import { platformDb, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { notifyCallbackMissed, notifyCallbackReminder, type ReminderType } from './callback-notifications.js';
import { insertActivity, insertAudit } from './repository.js';
import { settleLeadAfterCallbackInTransaction } from './lifecycle.js';
import { listHandoverTargets } from '../handover/repository.js';

const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';
const REMINDERS: readonly { type: ReminderType; offsetMinutes: number }[] = [
  { type: 't_minus_60', offsetMinutes: 60 },
  { type: 't_minus_15', offsetMinutes: 15 },
  { type: 'due', offsetMinutes: 0 },
];

export function reminderAt(scheduledAt: Date, offsetMinutes: number): Date {
  return new Date(scheduledAt.getTime() - offsetMinutes * 60_000);
}

/**
 * The one reminder a callback should get now, if any.
 *
 * Only the latest reminder whose time has come is sent, so a callback booked
 * ten minutes ahead, or one picked up late after the job was down, gets one
 * "Call them now" instead of "in 1 hour", "in 15 minutes" and "now" at once.
 * An advance reminder whose time had already passed when the callback was
 * booked is never sent; the "due" one always is.
 */
export function reminderToSend(scheduledAt: Date, bookedAt: Date, now: Date): { type: ReminderType; at: Date } | null {
  let latest: { type: ReminderType; at: Date } | null = null;
  for (const reminder of REMINDERS) {
    const at = reminderAt(scheduledAt, reminder.offsetMinutes);
    if (at.getTime() > now.getTime()) continue;
    if (reminder.offsetMinutes > 0 && at.getTime() < bookedAt.getTime()) continue;
    latest = { type: reminder.type, at };
  }
  return latest;
}

function jobContext(organizationId: string): RequestContext {
  const principal: Principal = { id: SYSTEM_ID, organizationId, sessionVersion: 0, accountType: 'service', allowedActions: [], allowedResources: [], expiresAt: new Date(0) };
  return createJobContext({ organizationId, principal, jobName: 'callback-automation', runId: 'scheduled' });
}

export interface SalesSupervisorCandidate { id: string; positionCode: string; depth: number; teamId?: string | null; }
interface ReportingChainCandidate { id: string; teamId: string | null; depth: number; }

/** Selects an eligible Sales supervisory recipient from the reporting chain. */
export function selectSalesSupervisor(candidates: readonly SalesSupervisorCandidate[]): string | null {
  return candidates.filter((candidate) => candidate.positionCode === 'sales-supervisor' || candidate.positionCode === 'sales-team-lead')
    .sort((a, b) => a.depth - b.depth || (a.positionCode === 'sales-supervisor' ? -1 : 1) - (b.positionCode === 'sales-supervisor' ? -1 : 1))[0]?.id ?? null;
}

/**
 * The owner's nearest Sales Supervisor or Team Lead who looks after the lead:
 * a Supervisor sits in the lead's pool, a Team Lead in its Sales Team.
 */
async function resolveSalesSupervisor(tx: Tx, ctx: RequestContext, ownerId: string, leadId: string): Promise<string | null> {
  const targets = await listHandoverTargets(ctx);
  const candidates = await tx.query<ReportingChainCandidate>(sql`
    WITH RECURSIVE reporting_chain AS (
      SELECT u.id, u.reports_to AS "reportsTo", u.team_id AS "teamId", 0 AS depth, ARRAY[u.id] AS path
      FROM app_user u
      WHERE u.organization_id = ${ctx.organizationId} AND u.id = ${ownerId}
      UNION ALL
      SELECT manager.id, manager.reports_to, manager.team_id, chain.depth + 1, chain.path || manager.id
      FROM app_user manager
      JOIN reporting_chain chain ON chain."reportsTo" = manager.id
      WHERE manager.organization_id = ${ctx.organizationId} AND NOT manager.id = ANY(chain.path)
    )
    SELECT chain.id, chain."teamId" AS "teamId", chain.depth
    FROM reporting_chain chain
    JOIN lead l ON l.organization_id = ${ctx.organizationId} AND l.id = ${leadId}
               AND chain."teamId" IN (l.sales_team_id, l.sales_pool_id)
    WHERE chain.depth > 0
  `);
  const eligible = candidates.flatMap((candidate) => {
    const target = targets.find((item) => item.id === candidate.id);
    return target ? [{ id: target.id, positionCode: target.positionCode, depth: candidate.depth, teamId: candidate.teamId }] : [];
  });
  return selectSalesSupervisor(eligible);
}

async function processOrganization(organizationId: string): Promise<number> {
  const ctx = jobContext(organizationId);
  return platformDb.transactionForOrganization(organizationId, 'callback-automation', 'process callback reminders and missed callbacks', async (tx) => {
    let processed = 0;
    // Callbacks already past the 30-minute grace are marked missed below
    // instead of being told "call them now".
    const callbacks = await tx.query<{ id: string; leadId: string; ownerId: string; scheduledAt: Date; createdAt: Date }>(sql`
      SELECT c.id, c.lead_id AS "leadId", c.owner_id AS "ownerId", c.scheduled_at AS "scheduledAt", c.created_at AS "createdAt"
      FROM lead_callback c
      WHERE c.organization_id = ${organizationId} AND c.status = 'pending'
        AND c.scheduled_at <= now() + interval '60 minutes'
        AND c.scheduled_at > now() - interval '30 minutes'
      FOR UPDATE SKIP LOCKED
    `);

    const now = new Date();
    for (const callback of callbacks) {
      const scheduledAt = new Date(callback.scheduledAt);
      const reminder = reminderToSend(scheduledAt, new Date(callback.createdAt), now);
      if (!reminder) continue;
      const rows = await tx.query<{ id: string }>(sql`
        INSERT INTO lead_callback_reminder (organization_id, callback_id, reminder_type, scheduled_at)
        VALUES (${organizationId}, ${callback.id}, ${reminder.type}, ${reminder.at})
        ON CONFLICT (organization_id, callback_id, reminder_type) DO NOTHING
        RETURNING id
      `);
      const reminderRow = rows[0];
      if (!reminderRow) continue;
      await tx.query(sql`
        INSERT INTO lead_callback_reminder_delivery (organization_id, reminder_id, recipient_id, channel, status, scheduled_at, delivered_at, detail)
        VALUES (${organizationId}, ${reminderRow.id}, ${callback.ownerId}, 'in-app', 'delivered', ${reminder.at}, now(), 'Persisted through the notification outbox'),
               (${organizationId}, ${reminderRow.id}, ${callback.ownerId}, 'push', 'scheduled', ${reminder.at}, NULL, 'Push provider integration deferred')
        ON CONFLICT (organization_id, reminder_id, recipient_id, channel) DO NOTHING
      `);
      await notifyCallbackReminder(tx, ctx, callback.ownerId, callback.leadId, reminder.type, reminderRow.id, scheduledAt);
      processed += 1;
    }

    const missed = await tx.query<{ id: string; leadId: string; ownerId: string; scheduledAt: Date }>(sql`
      UPDATE lead_callback c
      SET status = 'missed', missed_at = now()
      FROM app_user owner
      WHERE c.organization_id = ${organizationId}
        AND c.status = 'pending'
        AND c.scheduled_at <= now() - interval '30 minutes'
        AND owner.organization_id = c.organization_id AND owner.id = c.owner_id
      RETURNING c.id, c.lead_id AS "leadId", c.owner_id AS "ownerId", c.scheduled_at AS "scheduledAt"
    `);
    for (const callback of missed) {
      await insertActivity(tx, organizationId, callback.leadId, 'callback.missed', null, { callbackId: callback.id, reason: 'grace_period_expired' });
      // A missed callback stalls the lead, the same as one marked missed by hand.
      const stalled = await tx.query<{ id: string }>(sql`
        UPDATE lead SET stalled_at = now(), stalled_reason = 'missed_callback'
         WHERE organization_id = ${organizationId} AND id = ${callback.leadId}
           AND stalled_at IS NULL AND status NOT IN ('converted', 'closed_lost')
        RETURNING id
      `);
      if (stalled.length) await insertActivity(tx, organizationId, callback.leadId, 'lead.stalled', null, { reason: 'missed_callback', callbackId: callback.id });
      await settleLeadAfterCallbackInTransaction(tx, organizationId, callback.leadId, { status: 'missed', outcome: null }, null);
      await insertAudit(tx, ctx, 'callback.missed', callback.id, { status: 'pending' }, { status: 'missed', reason: 'grace_period_expired' }, 'callback');
      const supervisorId = await resolveSalesSupervisor(tx, ctx, callback.ownerId, callback.leadId);
      await notifyCallbackMissed(tx, ctx, callback.ownerId, supervisorId, callback.leadId, callback.id, new Date(callback.scheduledAt));
      processed += 1;
    }
    return processed;
  });
}

export async function runCallbackAutomation(): Promise<number> {
  const organizations = await platformDb.query<{ id: string }>('callback-automation', 'find organizations for callback automation', sql`SELECT id FROM organization WHERE status <> 'deleted'`);
  let total = 0;
  for (const organization of organizations) total += await processOrganization(organization.id);
  return total;
}
