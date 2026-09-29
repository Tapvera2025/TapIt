import { createJobContext, systemPrincipal } from '../dal/context.js';
import { db, platformDb } from '../dal/db.js';
import { listen, type Listener } from '../dal/pool.js';
import { sql } from '../dal/sql.js';
import {
  handledEventNames,
  handlersFor,
  retriedUntilDelivered,
  type OutboxEvent,
} from './registry.js';

/**
 * The domain outbox drainer — attendance design §5.5, TX-2, D22.
 *
 * 1. Claim a batch in a short transaction: each row gets a lease
 *    (`claimed_until`) and one more attempt. `SKIP LOCKED` keeps two drainers
 *    off the same rows.
 * 2. Publish outside any transaction (TX-2): each handler enqueues a job or
 *    emits a socket event.
 * 3. Mark the published rows processed. A failed row waits a backoff and is
 *    claimed again; after ten attempts it stops and raises an alert. An event
 *    registered with `retryUntilDelivered` never stops: at ten attempts it
 *    raises its alert and carries on, every five minutes, until delivered.
 *
 * A drainer that dies between 2 and 3 leaves its lease to lapse, and the rows
 * are published again: at least once, never lost.
 *
 * It wakes on the `domain_outbox` NOTIFY that an insert sends when its
 * transaction commits, and polls every second in case a notification was
 * missed — so a punch reaches the board well inside NF-2's three seconds.
 */

const POLL_MS = 1_000;
const ORGANIZATION_REFRESH_MS = 60_000;
const LEASE_SECONDS = 30;
const BATCH_SIZE = 100;
export const MAX_OUTBOX_ATTEMPTS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ClaimedRow {
  id: string;
  eventName: string;
  payload: unknown;
  enqueuedAt: Date;
  attempts: number;
}

function contextFor(organizationId: string) {
  return createJobContext({
    organizationId,
    principal: systemPrincipal(organizationId),
    jobName: 'outbox-drain',
    runId: 'loop',
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Publishes one claimed row to every handler. Returns the error, if any. */
async function publish(organizationId: string, row: ClaimedRow): Promise<string | null> {
  const event: OutboxEvent = {
    id: row.id,
    organizationId,
    name: row.eventName,
    payload: row.payload,
    enqueuedAt: row.enqueuedAt,
  };
  for (const handler of handlersFor(row.eventName)) {
    try {
      await handler(event);
    } catch (error) {
      return messageOf(error);
    }
  }
  return null;
}

/** Drains everything this process can handle for one organization. */
export async function drainOrganization(organizationId: string): Promise<number> {
  const names = handledEventNames();
  if (names.length === 0) return 0;
  const untilDelivered = retriedUntilDelivered();
  const ctx = contextFor(organizationId);
  let published = 0;

  for (;;) {
    const claimed = await db.transaction(ctx, (tx) =>
      tx.query<ClaimedRow>(sql`
        WITH picked AS (
          SELECT id FROM domain_outbox
          WHERE organization_id = ${organizationId}
            AND processed_at IS NULL
            AND event_name = ANY(${names}::text[])
            AND (attempts < ${MAX_OUTBOX_ATTEMPTS} OR event_name = ANY(${untilDelivered}::text[]))
            AND (claimed_until IS NULL OR claimed_until < now())
          ORDER BY enqueued_at, id
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE domain_outbox o
        SET claimed_until = now() + make_interval(secs => ${LEASE_SECONDS}),
            attempts = o.attempts + 1
        FROM picked
        WHERE o.organization_id = ${organizationId} AND o.id = picked.id
        RETURNING o.id, o.event_name, o.payload, o.enqueued_at, o.attempts
      `),
    );
    if (claimed.length === 0) return published;
    claimed.sort((a, b) => a.enqueuedAt.getTime() - b.enqueuedAt.getTime() || a.id.localeCompare(b.id));

    const done: string[] = [];
    const failed: { id: string; eventName: string; attempts: number; error: string }[] =
      [];
    for (const row of claimed) {
      const error = await publish(organizationId, row);
      if (error === null) done.push(row.id);
      else
        failed.push({
          id: row.id,
          eventName: row.eventName,
          attempts: row.attempts,
          error,
        });
    }

    await db.transaction(ctx, async (tx) => {
      if (done.length > 0) {
        await tx.query(sql`
          UPDATE domain_outbox SET processed_at = now(), claimed_until = NULL, last_error = NULL
          WHERE organization_id = ${organizationId} AND id = ANY(${done}::uuid[])
        `);
      }
      for (const row of failed) {
        // 2, 4, 8 … seconds, at most five minutes, before the next claim.
        const backoff = Math.min(2 ** row.attempts, 300);
        await tx.query(sql`
          UPDATE domain_outbox
          SET claimed_until = now() + make_interval(secs => ${backoff}), last_error = ${row.error}
          WHERE organization_id = ${organizationId} AND id = ${row.id}
        `);
      }
    });

    for (const row of failed) {
      const keepsTrying = untilDelivered.includes(row.eventName);
      const final = !keepsTrying && row.attempts >= MAX_OUTBOX_ATTEMPTS;
      // An event that is never given up on alerts once, when it reaches the
      // point where any other event would have stopped.
      const overdue = keepsTrying && row.attempts === MAX_OUTBOX_ATTEMPTS;
      console.error(
        JSON.stringify({
          level: 'error',
          msg: final
            ? 'outbox event gave up'
            : overdue
              ? 'outbox event still failing; it keeps retrying until delivered'
              : 'outbox event failed; will retry',
          ...(final ? { alert: 'outbox-event-dead-lettered' } : {}),
          ...(overdue ? { alert: 'outbox-event-overdue' } : {}),
          organizationId,
          eventId: row.id,
          attempts: row.attempts,
          error: row.error,
        }),
      );
    }
    published += done.length;
    if (claimed.length < BATCH_SIZE) return published;
  }
}

/* ==================================================================== *
 * Loop
 * ==================================================================== */

let listener: Listener | null = null;
let timer: NodeJS.Timeout | null = null;
let running: Promise<void> | null = null;
let rerun = false;
let stopping = true;
let organizationIds: string[] = [];
let organizationsFetchedAt = 0;
const woken = new Set<string>();

async function listOrganizationIds(): Promise<string[]> {
  const rows = await platformDb.query<{ id: string }>(
    'outbox-drain',
    'list organizations whose domain outbox may need draining',
    sql`SELECT id FROM organization ORDER BY id`,
  );
  return rows.map((row) => row.id);
}

async function tick(everyOrganization: boolean): Promise<void> {
  if (everyOrganization && Date.now() - organizationsFetchedAt >= ORGANIZATION_REFRESH_MS) {
    organizationIds = await listOrganizationIds();
    organizationsFetchedAt = Date.now();
  }
  const targets = new Set(woken);
  woken.clear();
  if (everyOrganization) for (const id of organizationIds) targets.add(id);
  for (const organizationId of targets) {
    if (stopping) return;
    try {
      await drainOrganization(organizationId);
    } catch (error) {
      // One organization's failure must not stall the others; its rows stay
      // pending and are claimed again next tick.
      console.error(
        JSON.stringify({ level: 'error', msg: 'outbox drain failed', organizationId, error: messageOf(error) }),
      );
    }
  }
}

function run(everyOrganization: boolean): void {
  if (stopping) return;
  if (running !== null) {
    rerun = true;
    return;
  }
  running = tick(everyOrganization)
    .catch((error: unknown) => {
      organizationsFetchedAt = 0;
      console.error(JSON.stringify({ level: 'error', msg: 'outbox drainer tick failed', error: messageOf(error) }));
    })
    .finally(() => {
      running = null;
      if (rerun) {
        rerun = false;
        run(false);
      }
    });
}

export async function startOutboxDrainer(): Promise<void> {
  if (!stopping) return;
  stopping = false;
  timer = setInterval(() => run(true), POLL_MS);
  try {
    listener = await listen('domain_outbox', (organizationId) => {
      if (!UUID.test(organizationId)) return;
      woken.add(organizationId);
      run(false);
    });
  } catch (error) {
    // Polling alone still delivers, one second slower.
    console.error(JSON.stringify({ level: 'error', msg: 'outbox LISTEN unavailable; polling only', error: messageOf(error) }));
  }
  run(true);
}

export async function stopOutboxDrainer(): Promise<void> {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
  await listener?.close();
  listener = null;
  await running;
  woken.clear();
  organizationIds = [];
  organizationsFetchedAt = 0;
}
