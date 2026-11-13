import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { decryptCredentials } from './crypto.js';
import { ApplicationError } from '../../../errors.js';
import { ProviderError, SyncBudgetExhausted, TELEPHONY_ERROR_CODES } from './errors.js';
import { createBudget, createTelephonyClient, JUSTCALL_HISTORY_DAYS, type ClientOverrides } from './providers/index.js';
import {
  agentIdsByExternalId,
  claimConnectionForSync,
  countAgents,
  ensureAgentsFromCalls,
  finishSync,
  matchAgentsByEmail,
  upsertAgents,
  upsertCalls,
  type SyncRunOutcome,
} from './repository.js';
import type { CallAgentRef, NormalizedCall, SyncTrigger } from './types.js';

/**
 * One sync of one connection.
 *
 *   1. Claim the connection (a second sync of the same connection waits).
 *   2. Platform users → telephony_agent, then match them to employees by email.
 *   3. Calls from the high-water mark (minus an overlap, so notes, recordings
 *      and AI results that land after a call ends are picked up) to now, one
 *      page at a time, each page upserted in its own short transaction.
 *   4. Record the outcome on the connection and on the run row.
 *
 * TX-2: no HTTP inside a transaction. Pages are fetched first, then written.
 * A run has a request and time budget; when it runs out the run is 'partial'
 * and the mark moves to the newest call stored, so the next run continues
 * from there rather than starting over.
 */

/** Re-read this much history on every run. */
export const SYNC_OVERLAP_MS = 6 * 60 * 60 * 1000;
const RUN_MAX_REQUESTS = 300;
const RUN_MAX_DURATION_MS = 4 * 60 * 1000;

export interface SyncResult {
  readonly skipped: boolean;
  readonly runId: string | null;
  readonly outcome: SyncRunOutcome | null;
}

export interface SyncOptions {
  readonly now?: Date;
  /** Test seam: platform fetch, sleep and budget. */
  readonly clientOverrides?: ClientOverrides;
}

function dedupe(calls: readonly NormalizedCall[]): NormalizedCall[] {
  const byId = new Map<string, NormalizedCall>();
  for (const call of calls) byId.set(call.externalId, call);
  return [...byId.values()];
}

function agentRefs(calls: readonly NormalizedCall[]): CallAgentRef[] {
  const refs = new Map<string, CallAgentRef>();
  for (const call of calls) if (call.agent) refs.set(call.agent.externalId, call.agent);
  return [...refs.values()];
}

export function syncWindow(
  connection: { syncedThrough: Date | null; backfillDays: number; provider: 'justcall' | 'aircall' },
  now: Date,
): { from: Date; to: Date } {
  const backfillDays =
    connection.provider === 'justcall' ? Math.min(connection.backfillDays, JUSTCALL_HISTORY_DAYS) : connection.backfillDays;
  const from = connection.syncedThrough
    ? new Date(connection.syncedThrough.getTime() - SYNC_OVERLAP_MS)
    : new Date(now.getTime() - backfillDays * 86_400_000);
  return { from, to: now };
}

export async function runConnectionSync(
  ctx: RequestContext,
  connectionId: string,
  trigger: SyncTrigger,
  requestedBy: string | null,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const claim = await claimConnectionForSync(ctx, connectionId, trigger, requestedBy);
  if (!claim) return { skipped: true, runId: null, outcome: null };
  const { connection, runId } = claim;
  const organizationId = ctx.organizationId;
  const now = options.now ?? new Date();
  const window = syncWindow(connection, now);
  const budget = options.clientOverrides?.budget ?? createBudget(RUN_MAX_REQUESTS, RUN_MAX_DURATION_MS);

  let agentsSeen = 0;
  let agentsMatched = 0;
  let callsSeen = 0;
  let callsCreated = 0;
  let callsUpdated = 0;
  let newestCall: Date | null = null;

  const finish = async (
    status: SyncRunOutcome['status'],
    error: string | null,
    syncedThrough: Date | null,
    credentialsRejected = false,
  ): Promise<SyncResult> => {
    const outcome: SyncRunOutcome = {
      status,
      error,
      credentialsRejected,
      windowFrom: window.from,
      windowTo: window.to,
      syncedThrough,
      agentsSeen,
      agentsMatched,
      callsSeen,
      callsCreated,
      callsUpdated,
      apiRequests: budget.used,
    };
    await finishSync(ctx, connectionId, runId, outcome);
    return { skipped: false, runId, outcome };
  };

  try {
    if (!connection.credentialsEncrypted) return await finish('failed', 'The connection has no saved API key.', null);
    const credentials = decryptCredentials(connection.credentialsEncrypted, {
      organizationId,
      connectionId,
      provider: connection.provider,
    });
    const client = createTelephonyClient(credentials, { ...options.clientOverrides, budget });

    // Users first, so the calls that follow can be attributed.
    const agents = await client.listAgents();
    await db.transaction(ctx, async (tx) => {
      await upsertAgents(tx, organizationId, connectionId, connection.provider, agents);
      await matchAgentsByEmail(tx, organizationId);
    });

    let agentIds = await db.transaction(ctx, (tx) => agentIdsByExternalId(tx, organizationId, connectionId));

    await client.listCalls(window, async (page) => {
      const calls = dedupe(page);
      callsSeen += calls.length;
      if (calls.length === 0) return;
      const unknown = agentRefs(calls).filter((ref) => !agentIds.has(ref.externalId));
      const written = await db.transaction(ctx, async (tx) => {
        if (unknown.length > 0) {
          await ensureAgentsFromCalls(tx, organizationId, connectionId, connection.provider, unknown);
          await matchAgentsByEmail(tx, organizationId);
          agentIds = await agentIdsByExternalId(tx, organizationId, connectionId);
        }
        return upsertCalls(tx, organizationId, connectionId, connection.provider, calls, agentIds);
      });
      callsCreated += written.created;
      callsUpdated += written.updated;
      for (const call of calls) {
        if (call.startedAt <= now && (!newestCall || call.startedAt > newestCall)) newestCall = call.startedAt;
      }
    });

    const counts = await db.transaction(ctx, (tx) => countAgents(tx, organizationId, connectionId));
    agentsSeen = counts.seen;
    agentsMatched = counts.matched;
    // Everything up to `now` is in: the next run starts from here (less the overlap).
    return await finish('succeeded', null, window.to);
  } catch (error) {
    try {
      const counts = await db.transaction(ctx, (tx) => countAgents(tx, organizationId, connectionId));
      agentsSeen = counts.seen;
      agentsMatched = counts.matched;
    } catch {
      // Counting is best effort; the outcome below is what matters.
    }
    if (error instanceof SyncBudgetExhausted) {
      return finish('partial', 'Stopped at this run’s request limit; the next sync continues from here.', newestCall);
    }
    if (error instanceof ProviderError) {
      const partial = callsCreated + callsUpdated > 0;
      return finish(
        partial && error.kind !== 'rejected' ? 'partial' : 'failed',
        error.message,
        partial ? newestCall : null,
        error.kind === 'rejected',
      );
    }
    // A key that no longer decrypts cannot work until someone reconnects.
    const unreadable = error instanceof ApplicationError && error.code === TELEPHONY_ERROR_CODES.CREDENTIALS_UNREADABLE;
    const message = error instanceof Error ? error.message : 'The sync failed.';
    return finish('failed', message.slice(0, 500), callsCreated + callsUpdated > 0 ? newestCall : null, unreadable);
  }
}
