import type { RequestContext } from '../../platform/dal/context.js';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { connectedUserIds, emitToUser } from '../../platform/realtime/index.js';
import type { OutboxEvent } from '../../platform/outbox/registry.js';
import { readPresenceToday, type PresenceSnapshot } from '../live-status/facade.js';
import type { ChatPresence } from './types.js';

/**
 * Presence on chat avatars — attendance (the live-status module) plus whether
 * the person has TapIt open right now:
 *
 *   active   green   punched in and working, or has TapIt open
 *   idle     orange  on a break (even with TapIt open)
 *   offline  grey    neither: not in yet, finished for the day, on leave
 *                    or a holiday, or no record — and TapIt is closed
 *
 * Only this coarse state leaves the module — never punch times, lateness or
 * the attendance board itself (that stays behind `attendance:view-live`).
 */
export function coarsePresence(snapshot: PresenceSnapshot | undefined, connected = false): ChatPresence {
  const atWork = snapshot !== undefined && snapshot.dayGroup !== 'leave' && snapshot.dayGroup !== 'holiday';
  if (atWork && snapshot.state === 'ON_BREAK') return 'idle';
  if (atWork && snapshot.state === 'WORKING') return 'active';
  return connected ? 'active' : 'offline';
}

/** Everyone a person can message (CH-1: anyone may message anyone), with their presence. */
export async function presenceForColleagues(ctx: RequestContext): Promise<Record<string, ChatPresence>> {
  const people = await db.query<{ id: string }>(ctx, sql`
    SELECT id FROM app_user
    WHERE organization_id = ${ctx.organizationId} AND status = 'active' AND account_type IN ('employee', 'super-admin')
  `);
  const ids = people.map((person) => person.id);
  const [snapshots, connected] = await Promise.all([
    readPresenceToday(ctx, ids),
    connectedUserIds(ctx.organizationId, ids),
  ]);
  return Object.fromEntries(ids.map((id) => [id, coarsePresence(snapshots.get(id), connected.has(id))]));
}

/**
 * Tells the people who share a conversation with `userId` to refresh their
 * presence dots. The payload is the person's id only (RT-4); idempotent,
 * because a repeated delivery just triggers one more refresh.
 */
async function notifyPresenceAudience(organizationId: string, userId: string, jobName: string, runId: string): Promise<void> {
  const ctx = createJobContext({ organizationId, principal: systemPrincipal(organizationId), jobName, runId });
  const audience = await db.query<{ userId: string }>(ctx, sql`
    SELECT DISTINCT other.user_id AS "userId"
      FROM conversation_member mine
      JOIN app_user subject ON subject.organization_id = mine.organization_id AND subject.id = mine.user_id
       AND subject.account_type IN ('employee', 'super-admin')
      JOIN conversation c ON c.organization_id = mine.organization_id AND c.id = mine.conversation_id AND c.archived_at IS NULL
      JOIN conversation_member other ON other.organization_id = mine.organization_id
       AND other.conversation_id = mine.conversation_id AND other.left_at IS NULL
      JOIN app_user u ON u.organization_id = other.organization_id AND u.id = other.user_id
       AND u.status = 'active' AND u.account_type IN ('employee', 'super-admin')
     WHERE mine.organization_id = ${organizationId} AND mine.user_id = ${userId} AND mine.left_at IS NULL
  `);
  for (const member of audience) {
    emitToUser(organizationId, member.userId, 'chat:presence', { userId });
  }
}

/** live-status → chat: someone's attendance state changed. */
export async function deliverPresenceChanged(event: OutboxEvent): Promise<void> {
  const userId = (event.payload as { userId?: unknown } | null)?.userId;
  if (typeof userId !== 'string') return;
  await notifyPresenceAudience(event.organizationId, userId, 'chat.presence-changed', event.id);
}

/** realtime → chat: someone opened TapIt, or closed their last tab. */
export function connectionChanged(organizationId: string, userId: string): void {
  void notifyPresenceAudience(organizationId, userId, 'chat.presence-connection', `connection:${userId}:${Date.now()}`)
    .catch((error: unknown) => {
      console.error(JSON.stringify({ level: 'warn', msg: 'chat presence notice failed', error: String(error) }));
    });
}
