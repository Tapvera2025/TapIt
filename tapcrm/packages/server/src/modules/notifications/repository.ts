import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { NotificationView } from './types.js';

/**
 * Read side. Every query is scoped to `ctx.principal.id` — there is no function
 * here that accepts a recipient parameter, so "read someone else's
 * notifications" is not expressible by a caller (PRD: notifications read `own`).
 */

interface Row {
  id: string;
  type: string;
  priority: NotificationView['priority'];
  title: string;
  body: string;
  link: string | null;
  metadata: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

const toView = (row: Row): NotificationView => ({
  id: row.id,
  type: row.type,
  priority: row.priority,
  title: row.title,
  body: row.body,
  link: row.link,
  metadata: row.metadata,
  read: row.readAt !== null,
  readAt: row.readAt ? row.readAt.toISOString() : null,
  createdAt: row.createdAt.toISOString(),
});

/** Opaque keyset cursor: (created_at, id) of the last row of the previous page. */
export function encodeCursor(row: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt, row.id])).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [string, string];
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime()) || typeof id !== 'string') return null;
    return { createdAt: date, id };
  } catch {
    return null;
  }
}

export async function listForRecipient(
  ctx: RequestContext,
  options: { unreadOnly: boolean; limit: number; cursor: { createdAt: Date; id: string } | null },
): Promise<NotificationView[]> {
  const cursorAt = options.cursor?.createdAt ?? null;
  const cursorId = options.cursor?.id ?? null;
  const rows = await db.query<Row>(ctx, sql`
    SELECT id, type, priority, title, body, link, metadata, read_at, created_at
    FROM notification
    WHERE organization_id = ${ctx.organizationId}
      AND recipient_id = ${ctx.principal.id}
      AND (expires_at IS NULL OR expires_at > now())
      AND (${options.unreadOnly}::boolean = false OR read_at IS NULL)
      AND (${cursorAt}::timestamptz IS NULL
           OR (created_at, id) < (${cursorAt}::timestamptz, ${cursorId}::uuid))
    ORDER BY created_at DESC, id DESC
    LIMIT ${options.limit}
  `);
  return rows.map(toView);
}

export async function countUnread(ctx: RequestContext): Promise<number> {
  const row = await db.one<{ count: string }>(ctx, sql`
    SELECT count(*)::text AS count FROM notification
    WHERE organization_id = ${ctx.organizationId}
      AND recipient_id = ${ctx.principal.id}
      AND read_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
  `);
  return Number(row.count);
}

/** Owner-scoped: another user's id simply matches no row. */
export async function markOneRead(ctx: RequestContext, id: string): Promise<NotificationView | null> {
  const rows = await db.query<Row>(ctx, sql`
    UPDATE notification SET read_at = COALESCE(read_at, now())
    WHERE organization_id = ${ctx.organizationId}
      AND recipient_id = ${ctx.principal.id}
      AND id = ${id}
    RETURNING id, type, priority, title, body, link, metadata, read_at, created_at
  `);
  return rows[0] ? toView(rows[0]) : null;
}

export async function markAllReadForRecipient(ctx: RequestContext): Promise<number> {
  const rows = await db.query<{ id: string }>(ctx, sql`
    UPDATE notification SET read_at = now()
    WHERE organization_id = ${ctx.organizationId}
      AND recipient_id = ${ctx.principal.id}
      AND read_at IS NULL
    RETURNING id
  `);
  return rows.length;
}

/* ---------------------------- write side ----------------------------- */

export interface OutboxRow {
  id: string;
  payload: unknown;
  attempts: number;
}

/** Ids only, unlocked: the per-row transaction takes the lock. */
export async function pendingOutboxIds(
  ctx: RequestContext,
  organizationId: string,
  maxAttempts: number,
  limit: number,
): Promise<string[]> {
  const rows = await db.query<{ id: string }>(ctx, sql`
    SELECT id FROM notification_outbox
    WHERE organization_id = ${organizationId} AND processed_at IS NULL AND attempts < ${maxAttempts}
    ORDER BY enqueued_at, id
    LIMIT ${limit}
  `);
  return rows.map((r) => r.id);
}

/** SKIP LOCKED: a second API replica processing the same organization never blocks or double-delivers. */
export async function claimOutboxRow(
  tx: Tx,
  organizationId: string,
  id: string,
  maxAttempts: number,
): Promise<OutboxRow | null> {
  return tx.maybeOne<OutboxRow>(sql`
    SELECT id, payload, attempts FROM notification_outbox
    WHERE organization_id = ${organizationId} AND id = ${id}
      AND processed_at IS NULL AND attempts < ${maxAttempts}
    FOR UPDATE SKIP LOCKED
  `);
}

export async function insertNotifications(
  tx: Tx,
  organizationId: string,
  recipientIds: readonly string[],
  content: {
    type: string;
    priority: string;
    title: string;
    body: string;
    link: string | null;
    metadata: unknown;
    expiresInDays: number;
  },
): Promise<Array<{ id: string; recipientId: string }>> {
  return tx.query<{ id: string; recipientId: string }>(sql`
    INSERT INTO notification (organization_id, recipient_id, type, priority, title, body, link, metadata, expires_at)
    SELECT ${organizationId}::uuid, r, ${content.type}, ${content.priority}, ${content.title}, ${content.body},
           ${content.link}, ${JSON.stringify(content.metadata)}::jsonb,
           now() + make_interval(days => ${content.expiresInDays}::int)
    FROM unnest(${[...recipientIds]}::uuid[]) AS r
    RETURNING id, recipient_id
  `);
}

export async function insertDeliveries(
  tx: Tx,
  organizationId: string,
  channel: string,
  status: 'delivered' | 'failed' | 'skipped',
  rows: ReadonlyArray<{ id: string; recipientId: string }>,
  detail: string | null = null,
): Promise<void> {
  if (rows.length === 0) return;
  await tx.query(sql`
    INSERT INTO notification_delivery (organization_id, notification_id, recipient_id, channel, status, detail)
    SELECT ${organizationId}::uuid, t.n, t.r, ${channel}, ${status}, ${detail}
    FROM unnest(${rows.map((x) => x.id)}::uuid[], ${rows.map((x) => x.recipientId)}::uuid[]) AS t(n, r)
  `);
}

export async function markOutboxProcessed(
  tx: Tx,
  organizationId: string,
  id: string,
  note: string | null,
): Promise<void> {
  await tx.query(sql`
    UPDATE notification_outbox
    SET processed_at = now(), attempts = attempts + 1, last_error = ${note}
    WHERE organization_id = ${organizationId} AND id = ${id}
  `);
}

export async function markOutboxFailed(tx: Tx, organizationId: string, id: string, error: string): Promise<void> {
  await tx.query(sql`
    UPDATE notification_outbox SET attempts = attempts + 1, last_error = ${error.slice(0, 1000)}
    WHERE organization_id = ${organizationId} AND id = ${id}
  `);
}

export async function pruneExpired(tx: Tx, organizationId: string): Promise<number> {
  const rows = await tx.query<{ id: string }>(sql`
    DELETE FROM notification
    WHERE organization_id = ${organizationId} AND expires_at IS NOT NULL AND expires_at <= now()
    RETURNING id
  `);
  // Processed outbox rows are bookkeeping only; keep a week for diagnosis.
  await tx.query(sql`
    DELETE FROM notification_outbox
    WHERE organization_id = ${organizationId} AND processed_at IS NOT NULL
      AND processed_at < now() - interval '7 days'
  `);
  return rows.length;
}
