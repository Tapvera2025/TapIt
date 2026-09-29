import type { Principal } from '@tapcrm/contracts';
import { createJobContext, type RequestContext } from '../../../platform/dal/context.js';
import { platformDb, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { notifyCallbackMissed, notifyCallbackReminder } from './callback-notifications.js';
import { insertActivity, insertAudit, listHandoverTargets } from './repository.js';

const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';
const REMINDERS = [
  { type: 't_minus_60', offsetMinutes: 60 },
  { type: 't_minus_15', offsetMinutes: 15 },
  { type: 'due', offsetMinutes: 0 },
] as const;

export function reminderAt(scheduledAt: Date, offsetMinutes: number): Date {
  return new Date(scheduledAt.getTime() - offsetMinutes * 60_000);
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
    JOIN lead l ON l.organization_id = ${ctx.organizationId} AND l.id = ${leadId} AND l.sales_team_id = chain."teamId"
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
    const callbacks = await tx.query<{ id: string; leadId: string; ownerId: string; scheduledAt: Date }>(sql`
      SELECT c.id, c.lead_id AS "leadId", c.owner_id AS "ownerId", c.scheduled_at AS "scheduledAt"
      FROM lead_callback c
      WHERE c.organization_id = ${organizationId} AND c.status = 'pending'
        AND (c.scheduled_at <= now() OR c.scheduled_at <= now() + interval '60 minutes')
      FOR UPDATE SKIP LOCKED
    `);

    for (const callback of callbacks) {
      for (const reminder of REMINDERS) {
        const scheduledAt = reminderAt(new Date(callback.scheduledAt), reminder.offsetMinutes);
        if (scheduledAt > new Date()) continue;
        const rows = await tx.query<{ id: string }>(sql`
          INSERT INTO lead_callback_reminder (organization_id, callback_id, reminder_type, scheduled_at)
          VALUES (${organizationId}, ${callback.id}, ${reminder.type}, ${scheduledAt})
          ON CONFLICT (organization_id, callback_id, reminder_type) DO NOTHING
          RETURNING id
        `);
        const reminderRow = rows[0];
        if (!reminderRow) continue;
        await tx.query(sql`
          INSERT INTO lead_callback_reminder_delivery (organization_id, reminder_id, recipient_id, channel, status, scheduled_at, delivered_at, detail)
          VALUES (${organizationId}, ${reminderRow.id}, ${callback.ownerId}, 'in-app', 'delivered', ${scheduledAt}, now(), 'Persisted through the notification outbox'),
                 (${organizationId}, ${reminderRow.id}, ${callback.ownerId}, 'push', 'scheduled', ${scheduledAt}, NULL, 'Push provider integration deferred')
          ON CONFLICT (organization_id, reminder_id, recipient_id, channel) DO NOTHING
        `);
        await notifyCallbackReminder(tx, ctx, callback.ownerId, callback.leadId, reminder.type, reminderRow.id);
        processed += 1;
      }
    }

    const missed = await tx.query<{ id: string; leadId: string; ownerId: string }>(sql`
      UPDATE lead_callback c
      SET status = 'missed', missed_at = now()
      FROM app_user owner
      WHERE c.organization_id = ${organizationId}
        AND c.status = 'pending'
        AND c.scheduled_at <= now() - interval '30 minutes'
        AND owner.organization_id = c.organization_id AND owner.id = c.owner_id
      RETURNING c.id, c.lead_id AS "leadId", c.owner_id AS "ownerId"
    `);
    for (const callback of missed) {
      await insertActivity(tx, organizationId, callback.leadId, 'callback.missed', null, { callbackId: callback.id, reason: 'grace_period_expired' });
      await insertAudit(tx, ctx, 'callback.missed', callback.id, { status: 'pending' }, { status: 'missed', reason: 'grace_period_expired' }, 'callback');
      const supervisorId = await resolveSalesSupervisor(tx, ctx, callback.ownerId, callback.leadId);
      await notifyCallbackMissed(tx, ctx, callback.ownerId, supervisorId, callback.leadId, callback.id);
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
