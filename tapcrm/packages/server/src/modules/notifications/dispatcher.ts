import type { Principal } from '@tapcrm/contracts';
import { createJobContext, type RequestContext } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { loadConfig } from '../../config.js';
import { emitToUser } from '../../platform/realtime/index.js';
import { resolveAudience } from './audience.js';
import {
  claimOutboxRow,
  insertDeliveries,
  insertNotifications,
  markOutboxFailed,
  markOutboxProcessed,
  pendingOutboxIds,
} from './repository.js';
import { outboxPayloadSchema } from './types.js';

/**
 * The notification dispatcher — drains `notification_outbox` (TECH §3.1, MB-3).
 *
 * Per outbox row, ONE transaction: resolve audience → insert one
 * `notification` per recipient → record the in-app delivery → mark the row
 * processed. Crash-safe: a failure rolls the whole row back and it is retried;
 * a processed row is never picked again, so a replay is a no-op. Realtime emits
 * happen AFTER commit (TX-2) and are best-effort.
 *
 * Like the audit drainer it needs PostgreSQL only, runs on every API replica,
 * and relies on FOR UPDATE SKIP LOCKED — not Redis — for ownership.
 *
 * ADDING A CHANNEL (email, push, WhatsApp — Phase 2+): after the commit in
 * `dispatchOrganization`, hand the delivered rows to the channel adapter and
 * record its outcome with `insertDeliveries` (NT-4). Honour NT-3: preferences
 * may silence `informational` only; `operational` always goes.
 */

const MAX_ATTEMPTS = 5;
const PER_TICK_LIMIT = 200;

function dispatcherPrincipal(organizationId: string): Principal {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    organizationId,
    sessionVersion: 0,
    accountType: 'service',
    allowedActions: [],
    allowedResources: [],
    expiresAt: new Date(0),
  };
}

function contextFor(organizationId: string): RequestContext {
  return createJobContext({
    organizationId,
    principal: dispatcherPrincipal(organizationId),
    jobName: 'notification-dispatch',
    runId: 'loop',
  });
}

interface Delivered {
  readonly id: string;
  readonly recipientId: string;
  readonly type: string;
  readonly priority: string;
  readonly createdAt: string;
}

/** Processes one outbox row. Returns what was delivered, or null if locked/poison/failed. */
async function processRow(organizationId: string, outboxId: string): Promise<Delivered[] | null> {
  const ctx = contextFor(organizationId);
  try {
    return await db.transaction(ctx, async (tx) => {
      const row = await claimOutboxRow(tx, organizationId, outboxId, MAX_ATTEMPTS);
      if (!row) return null; // another replica has it, or it is already done

      const parsed = outboxPayloadSchema.safeParse(row.payload);
      if (!parsed.success) {
        // A payload that can never succeed must leave the queue, not retry forever.
        await markOutboxProcessed(tx, organizationId, outboxId, `invalid payload: ${parsed.error.message}`.slice(0, 1000));
        return null;
      }
      const payload = parsed.data;

      const recipientIds = await resolveAudience(tx, organizationId, payload);
      if (recipientIds.length === 0) {
        await markOutboxProcessed(tx, organizationId, outboxId, 'audience resolved to no active recipients');
        return [];
      }

      const created = await insertNotifications(tx, organizationId, recipientIds, {
        type: payload.type,
        priority: payload.priority,
        title: payload.title,
        body: payload.body,
        link: payload.link,
        metadata: payload.metadata,
        expiresInDays: payload.expiresInDays,
      });
      // In-app "delivery" is persistence: the row IS the notification-centre entry.
      await insertDeliveries(tx, organizationId, 'in-app', 'delivered', created);
      await markOutboxProcessed(tx, organizationId, outboxId, null);

      const createdAt = new Date().toISOString();
      return created.map((n) => ({
        id: n.id,
        recipientId: n.recipientId,
        type: payload.type,
        priority: payload.priority,
        createdAt,
      }));
    });
  } catch (error) {
    // The transaction rolled back, so attempts did not advance. Record the
    // failure separately; after MAX_ATTEMPTS the row stays unprocessed for the
    // backlog alert to surface (same posture as audit_outbox).
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ level: 'error', msg: 'notification dispatch failed', organizationId, outboxId, error: message }));
    await db
      .transaction(ctx, (tx) => markOutboxFailed(tx, organizationId, outboxId, message))
      .catch(() => undefined);
    return null;
  }
}

/** Drains pending intents for one organization. Returns notifications created. */
export async function dispatchOrganization(organizationId: string): Promise<number> {
  const ids = await pendingOutboxIds(contextFor(organizationId), organizationId, MAX_ATTEMPTS, PER_TICK_LIMIT);
  let total = 0;
  for (const id of ids) {
    const delivered = await processRow(organizationId, id);
    if (!delivered) continue;
    total += delivered.length;
    // Post-commit, best-effort. RT-4: identifiers and a change type only.
    for (const n of delivered) {
      emitToUser(organizationId, n.recipientId, 'notification:new', {
        id: n.id,
        type: n.type,
        priority: n.priority,
        createdAt: n.createdAt,
      });
    }
  }
  return total;
}

/* ------------------------------ loop --------------------------------- */

const ORGANIZATION_REFRESH_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let running: Promise<void> | null = null;
let stopping = false;
let organizationIds: string[] = [];
let organizationsFetchedAt = 0;

async function tick(): Promise<void> {
  if (Date.now() - organizationsFetchedAt >= ORGANIZATION_REFRESH_MS) {
    // Cross-tenant listing is allow-listed and logged (MT-5), so it runs on a
    // slower cadence than the drain tick.
    const rows = await platformDb.query<{ id: string }>(
      'notification-dispatch',
      'list organizations whose notification outbox may need dispatching',
      sql`SELECT id FROM organization WHERE status = 'active' ORDER BY id`,
    );
    organizationIds = rows.map((r) => r.id);
    organizationsFetchedAt = Date.now();
  }
  for (const organizationId of organizationIds) {
    if (stopping) return;
    try {
      const created = await dispatchOrganization(organizationId);
      if (created > 0) {
        console.log(JSON.stringify({ level: 'info', msg: 'notifications dispatched', organizationId, created }));
      }
    } catch (error) {
      // One organization's failure must not stall the others.
      console.error(JSON.stringify({
        level: 'error',
        msg: 'notification dispatch failed for organization',
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}

export function startNotificationDispatcher(): void {
  const config = loadConfig();
  if (config.NOTIFICATION_DISPATCHER_ENABLED === 'false' || timer !== null) return;
  stopping = false;

  const schedule = (): void => {
    if (stopping) return;
    timer = setTimeout(() => {
      // Ticks never overlap: the next is scheduled only when this one ends.
      running = tick()
        .catch((error: unknown) => {
          console.error(JSON.stringify({
            level: 'error',
            msg: 'notification dispatcher tick failed',
            error: error instanceof Error ? error.message : String(error),
          }));
          organizationsFetchedAt = 0;
        })
        .finally(() => {
          running = null;
          schedule();
        });
    }, config.NOTIFICATION_DISPATCH_INTERVAL_MS);
  };
  schedule();
}

/** Stops scheduling and waits for the in-flight tick, so the pool can close. */
export async function stopNotificationDispatcher(): Promise<void> {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = null;
  await running;
  organizationIds = [];
  organizationsFetchedAt = 0;
}
