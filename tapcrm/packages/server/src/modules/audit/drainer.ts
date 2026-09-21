import type { Principal } from '@tapcrm/contracts';
import { loadConfig } from '../../config.js';
import { createJobContext } from '../../platform/dal/context.js';
import { db, platformDb, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { HASH_VERSION, chainPayload, computeHash, normalizePayload } from './chain.js';

/**
 * The audit writer — TECH.md §9.5.1.
 *
 * Business transactions write `audit_outbox` (AU-I1). This drains it into the
 * hash-chained `audit_entry` table, the only place a sequence number is
 * allocated (AU-L1).
 *
 * Ownership is the PostgreSQL row lock on `audit_stream_state`, not Redis
 * (§9.5.1). Any number of API replicas may run this loop: a second writer
 * blocks on the lock, then sees the committed sequence and hash. Sequence
 * allocation, the entry insert and the outbox acknowledgement share ONE
 * transaction (AU-L2), so a crash leaves nothing half-chained and a
 * reprocessed outbox row is a no-op (AU-I3) — its `processed_at` is already set.
 *
 * Parallelism is across organizations and streams, never within one (AU-L5).
 */

type Stream = 'access' | 'activity';
const STREAMS: readonly Stream[] = ['access', 'activity'];

/** Audit writes are made by the platform, not by any human principal. */
function auditWriter(organizationId: string): Principal {
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

interface OutboxRow {
  id: string;
  payload: unknown;
  enqueuedAt: Date;
}

interface StreamState {
  nextSequence: string;
  lastHash: Buffer | null;
}

function contextFor(organizationId: string) {
  return createJobContext({
    organizationId,
    principal: auditWriter(organizationId),
    jobName: 'audit-drain',
    runId: 'loop',
  });
}

/**
 * Chains up to `batchSize` pending outbox rows for one stream, inside `tx`.
 * Returns how many were written. The caller owns the transaction.
 */
export async function chainPendingBatch(
  tx: Tx,
  organizationId: string,
  stream: Stream,
  batchSize: number,
): Promise<number> {
  await tx.query(sql`
    INSERT INTO audit_stream_state (organization_id, stream)
    VALUES (${organizationId}, ${stream})
    ON CONFLICT (organization_id, stream) DO NOTHING
  `);
  // The stream lock. Taken before reading the outbox so that only the lock
  // holder ever sees, and orders, the pending rows of this stream.
  const state = await tx.one<StreamState>(sql`
    SELECT next_sequence, last_hash FROM audit_stream_state
    WHERE organization_id = ${organizationId} AND stream = ${stream}
    FOR UPDATE
  `);

  const pending = await tx.query<OutboxRow>(sql`
    SELECT id, payload, enqueued_at FROM audit_outbox
    WHERE organization_id = ${organizationId} AND stream = ${stream} AND processed_at IS NULL
    ORDER BY enqueued_at, id
    LIMIT ${batchSize}
  `);
  if (pending.length === 0) return 0;

  let sequence = BigInt(state.nextSequence);
  let prevHash = state.lastHash;

  for (const row of pending) {
    const entry = normalizePayload(row.payload);
    // The outbox timestamp is the moment the business transaction started.
    // Sequence, not time, defines chain order; a transaction that commits late
    // can legitimately carry an earlier `occurred_at` than its neighbours.
    const occurredAt = row.enqueuedAt;
    const hash = computeHash(
      prevHash,
      chainPayload({ organizationId, stream, sequence, occurredAt }, entry),
    );

    await tx.query(sql`
      INSERT INTO audit_entry (
        organization_id, stream, sequence, occurred_at,
        actor_id, actor_type, action, target_type, target_id,
        before_data, after_data, reason, source_ip, request_id,
        hash_version, prev_hash, hash
      ) VALUES (
        ${organizationId}, ${stream}, ${sequence.toString()}, ${occurredAt},
        ${entry.actorId}, ${entry.actorType}, ${entry.action}, ${entry.targetType}, ${entry.targetId},
        ${entry.before === null ? null : JSON.stringify(entry.before)}::jsonb,
        ${entry.after === null ? null : JSON.stringify(entry.after)}::jsonb,
        ${entry.reason}, ${entry.sourceIp}::inet, ${entry.requestId},
        ${HASH_VERSION}, ${prevHash}, ${hash}
      )
    `);

    sequence += 1n;
    prevHash = hash;
  }

  await tx.query(sql`
    UPDATE audit_outbox SET processed_at = now(), attempts = attempts + 1, last_error = NULL
    WHERE organization_id = ${organizationId} AND id = ANY(${pending.map((row) => row.id)}::uuid[])
  `);
  await tx.query(sql`
    UPDATE audit_stream_state
    SET next_sequence = ${sequence.toString()}, last_hash = ${prevHash}, updated_at = now()
    WHERE organization_id = ${organizationId} AND stream = ${stream}
  `);
  return pending.length;
}

async function hasPending(organizationId: string, stream: Stream): Promise<boolean> {
  const rows = await db.query<{ one: number }>(
    contextFor(organizationId),
    sql`
      SELECT 1 AS one FROM audit_outbox
      WHERE organization_id = ${organizationId} AND stream = ${stream} AND processed_at IS NULL
      LIMIT 1
    `,
  );
  return rows.length > 0;
}

/** Drains every pending outbox row for one organization. Returns rows chained. */
export async function drainOrganization(
  organizationId: string,
  batchSize = loadConfig().AUDIT_DRAIN_BATCH_SIZE,
): Promise<number> {
  let total = 0;
  for (const stream of STREAMS) {
    // A cheap unlocked probe first: taking the stream lock writes a row
    // version, which an idle organization should not pay for on every poll.
    if (!(await hasPending(organizationId, stream))) continue;
    for (;;) {
      const written = await db.transaction(contextFor(organizationId), (tx) =>
        chainPendingBatch(tx, organizationId, stream, batchSize),
      );
      total += written;
      if (written < batchSize) break;
    }
  }
  return total;
}

/* ==================================================================== *
 * Loop
 * ==================================================================== */

/**
 * Organizations sit outside RLS, and pending outbox rows do not, so the loop
 * must iterate organizations explicitly (JB-3). The list is refreshed on a
 * slower cadence than the drain tick: every platformDb call is logged as a
 * cross-tenant operation (MT-5), and a poll every few seconds would bury it.
 * A new organization's first entries therefore wait at most this long.
 */
const ORGANIZATION_REFRESH_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let running: Promise<void> | null = null;
let stopping = false;
let organizationIds: string[] = [];
let organizationsFetchedAt = 0;

async function listOrganizationIds(): Promise<string[]> {
  // Deleted and suspended organizations are included on purpose: their audit
  // intent must still be chained.
  const rows = await platformDb.query<{ id: string }>(
    'audit-drain',
    'list organizations whose audit outbox may need draining',
    sql`SELECT id FROM organization ORDER BY id`,
  );
  return rows.map((row) => row.id);
}

async function tick(): Promise<void> {
  if (Date.now() - organizationsFetchedAt >= ORGANIZATION_REFRESH_MS) {
    organizationIds = await listOrganizationIds();
    organizationsFetchedAt = Date.now();
  }
  for (const organizationId of organizationIds) {
    if (stopping) return;
    try {
      const written = await drainOrganization(organizationId);
      if (written > 0) {
        console.log(
          JSON.stringify({ level: 'info', msg: 'audit outbox drained', organizationId, written }),
        );
      }
    } catch (error) {
      // One organization's failure must not stall the others. The outbox row
      // stays pending and is retried on the next tick.
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'audit drain failed',
          organizationId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

export function startAuditDrainer(): void {
  const config = loadConfig();
  if (config.AUDIT_DRAINER_ENABLED === 'false' || timer !== null) return;
  stopping = false;

  const schedule = (): void => {
    if (stopping) return;
    timer = setTimeout(() => {
      // Ticks never overlap: the next one is scheduled only when this ends.
      running = tick()
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              level: 'error',
              msg: 'audit drainer tick failed',
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          // Re-list organizations next tick in case the failure was the listing.
          organizationsFetchedAt = 0;
        })
        .finally(() => {
          running = null;
          schedule();
        });
    }, config.AUDIT_DRAIN_INTERVAL_MS);
  };
  schedule();
}

/** Stops scheduling and waits for the in-flight tick, so the pool can close. */
export async function stopAuditDrainer(): Promise<void> {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = null;
  await running;
  organizationIds = [];
  organizationsFetchedAt = 0;
}
