import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { TelephonyCallResource } from './policy.js';
import type {
  CallAgentRef,
  CallOutcome,
  CallTotals,
  ConnectionStatus,
  DailyCallPoint,
  EmployeeCallStats,
  EmployeeOption,
  HourlyCallPoint,
  MatchMethod,
  NormalizedAgent,
  NormalizedCall,
  OutcomeCount,
  SyncStatus,
  SyncTrigger,
  TelephonyAgentView,
  TelephonyCallDetail,
  TelephonyCallListItem,
  TelephonyConnectionSummary,
  TelephonyConnectionView,
  TelephonyProvider,
  TelephonySyncRunView,
  VisibleEmployee,
} from './types.js';

/* ==================================================================== *
 * Connections
 * ==================================================================== */

export interface ConnectionRow {
  readonly id: string;
  readonly organizationId: string;
  readonly provider: TelephonyProvider;
  readonly label: string;
  readonly status: ConnectionStatus;
  readonly credentialsEncrypted: string | null;
  readonly backfillDays: number;
  readonly syncedThrough: Date | null;
  readonly lastSyncStatus: SyncStatus | null;
  readonly lastSyncStartedAt: Date | null;
}

const CONNECTION_ROW = sql`
  SELECT id, organization_id AS "organizationId", provider, label, status,
         credentials_encrypted AS "credentialsEncrypted", backfill_days AS "backfillDays",
         synced_through AS "syncedThrough", last_sync_status AS "lastSyncStatus",
         last_sync_started_at AS "lastSyncStartedAt"
  FROM telephony_connection`;

export async function findConnectionRow(ctx: RequestContext, id: string): Promise<ConnectionRow | null> {
  return db.maybeOne<ConnectionRow>(ctx, sql`${CONNECTION_ROW} WHERE organization_id = ${ctx.organizationId} AND id = ${id}`);
}

export async function findConnectionRowByProvider(
  ctx: RequestContext,
  provider: TelephonyProvider,
): Promise<ConnectionRow | null> {
  return db.maybeOne<ConnectionRow>(
    ctx,
    sql`${CONNECTION_ROW} WHERE organization_id = ${ctx.organizationId} AND provider = ${provider}`,
  );
}

const CONNECTION_VIEW = sql`
  SELECT conn.id, conn.provider, conn.label, conn.status,
         conn.credentials_hint AS "credentialsHint", conn.backfill_days AS "backfillDays",
         conn.synced_through AS "syncedThrough", conn.last_sync_status AS "lastSyncStatus",
         conn.last_sync_started_at AS "lastSyncStartedAt", conn.last_sync_finished_at AS "lastSyncFinishedAt",
         conn.last_sync_error AS "lastSyncError", conn.last_verified_at AS "lastVerifiedAt",
         COALESCE(agents.total, 0)::int AS "agentCount",
         COALESCE(agents.matched, 0)::int AS "matchedAgentCount",
         COALESCE(agents.unmatched, 0)::int AS "unmatchedAgentCount",
         COALESCE(calls.total, 0)::int AS "callCount",
         conn.created_at AS "createdAt", conn.updated_at AS "updatedAt"
  FROM telephony_connection conn
  LEFT JOIN LATERAL (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE a.employee_id IS NOT NULL) AS matched,
           count(*) FILTER (WHERE a.match_method = 'none') AS unmatched
    FROM telephony_agent a
    WHERE a.organization_id = conn.organization_id AND a.connection_id = conn.id
  ) agents ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS total FROM telephony_call c
    WHERE c.organization_id = conn.organization_id AND c.connection_id = conn.id
  ) calls ON true`;

export async function listConnectionViews(ctx: RequestContext): Promise<TelephonyConnectionView[]> {
  return db.query<TelephonyConnectionView>(
    ctx,
    sql`${CONNECTION_VIEW} WHERE conn.organization_id = ${ctx.organizationId} ORDER BY conn.provider`,
  );
}

export async function findConnectionView(ctx: RequestContext, id: string): Promise<TelephonyConnectionView | null> {
  return db.maybeOne<TelephonyConnectionView>(
    ctx,
    sql`${CONNECTION_VIEW} WHERE conn.organization_id = ${ctx.organizationId} AND conn.id = ${id}`,
  );
}

export async function listConnectionSummaries(ctx: RequestContext): Promise<TelephonyConnectionSummary[]> {
  return db.query<TelephonyConnectionSummary>(
    ctx,
    sql`SELECT id, provider, label, status, last_sync_finished_at AS "lastSyncFinishedAt", last_sync_status AS "lastSyncStatus"
        FROM telephony_connection
        WHERE organization_id = ${ctx.organizationId} AND status <> 'disconnected'
        ORDER BY provider`,
  );
}

export async function listSyncableConnectionIds(ctx: RequestContext): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    ctx,
    sql`SELECT id FROM telephony_connection
        WHERE organization_id = ${ctx.organizationId}
          AND status IN ('active', 'error')
          AND credentials_encrypted IS NOT NULL
        ORDER BY provider`,
  );
  return rows.map((row) => row.id);
}

export async function newConnectionId(ctx: RequestContext): Promise<string> {
  const row = await db.one<{ id: string }>(ctx, sql`SELECT uuidv7() AS id`);
  return row.id;
}

export async function insertConnection(
  tx: Tx,
  ctx: RequestContext,
  input: {
    id: string;
    provider: TelephonyProvider;
    label: string;
    credentialsEncrypted: string;
    credentialsHint: string;
    backfillDays: number;
  },
): Promise<void> {
  await tx.query(sql`
    INSERT INTO telephony_connection
      (id, organization_id, provider, label, status, credentials_encrypted, credentials_hint,
       backfill_days, last_verified_at, created_by, updated_by)
    VALUES (${input.id}, ${ctx.organizationId}, ${input.provider}, ${input.label}, 'active',
            ${input.credentialsEncrypted}, ${input.credentialsHint}, ${input.backfillDays}, now(),
            ${ctx.principal.id}, ${ctx.principal.id})`);
}

/** Reconnect, or replace the key of a live connection. */
export async function replaceConnectionCredentials(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  input: { credentialsEncrypted: string; credentialsHint: string; label?: string | undefined; backfillDays?: number | undefined },
): Promise<void> {
  await tx.query(sql`
    UPDATE telephony_connection
    SET credentials_encrypted = ${input.credentialsEncrypted},
        credentials_hint = ${input.credentialsHint},
        status = 'active',
        label = COALESCE(${input.label ?? null}::text, label),
        backfill_days = COALESCE(${input.backfillDays ?? null}::int, backfill_days),
        last_verified_at = now(),
        last_sync_error = NULL,
        updated_by = ${ctx.principal.id}
    WHERE organization_id = ${ctx.organizationId} AND id = ${id}`);
}

export async function updateConnectionSettings(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  input: { label?: string | undefined; backfillDays?: number | undefined; status?: 'active' | 'paused' | undefined },
): Promise<void> {
  await tx.query(sql`
    UPDATE telephony_connection
    SET label = COALESCE(${input.label ?? null}::text, label),
        backfill_days = COALESCE(${input.backfillDays ?? null}::int, backfill_days),
        status = COALESCE(${input.status ?? null}::text, status),
        updated_by = ${ctx.principal.id}
    WHERE organization_id = ${ctx.organizationId} AND id = ${id}`);
}

export async function markDisconnected(tx: Tx, ctx: RequestContext, id: string): Promise<void> {
  await tx.query(sql`
    UPDATE telephony_connection
    SET status = 'disconnected', credentials_encrypted = NULL, credentials_hint = NULL,
        last_sync_status = CASE WHEN last_sync_status = 'running' THEN 'failed' ELSE last_sync_status END,
        updated_by = ${ctx.principal.id}
    WHERE organization_id = ${ctx.organizationId} AND id = ${id}`);
}

export async function recordVerification(
  ctx: RequestContext,
  id: string,
  result: { ok: true } | { ok: false; rejected: boolean; message: string },
): Promise<void> {
  if (result.ok) {
    await db.query(ctx, sql`
      UPDATE telephony_connection
      SET last_verified_at = now(),
          status = CASE WHEN status = 'error' THEN 'active' ELSE status END,
          last_sync_error = CASE WHEN status = 'error' THEN NULL ELSE last_sync_error END
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}`);
    return;
  }
  await db.query(ctx, sql`
    UPDATE telephony_connection
    SET status = CASE WHEN ${result.rejected}::boolean AND status = 'active' THEN 'error' ELSE status END,
        last_sync_error = ${result.message}
    WHERE organization_id = ${ctx.organizationId} AND id = ${id}`);
}

/* ==================================================================== *
 * Sync bookkeeping
 * ==================================================================== */

/** A sync that has not reported back in this long is treated as dead. */
const STALE_RUN = '20 minutes';

export async function claimConnectionForSync(
  ctx: RequestContext,
  id: string,
  trigger: SyncTrigger,
  requestedBy: string | null,
): Promise<{ connection: ConnectionRow; runId: string } | null> {
  return db.transaction(ctx, async (tx) => {
    const connection = await tx.maybeOne<ConnectionRow>(sql`
      UPDATE telephony_connection
      SET last_sync_status = 'running', last_sync_started_at = now(), last_sync_finished_at = NULL
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}
        AND status IN ('active', 'error')
        AND credentials_encrypted IS NOT NULL
        AND (last_sync_status IS DISTINCT FROM 'running' OR last_sync_started_at < now() - ${STALE_RUN}::interval)
      RETURNING id, organization_id AS "organizationId", provider, label, status,
                credentials_encrypted AS "credentialsEncrypted", backfill_days AS "backfillDays",
                synced_through AS "syncedThrough", last_sync_status AS "lastSyncStatus",
                last_sync_started_at AS "lastSyncStartedAt"`);
    if (!connection) return null;
    // A run left 'running' by a crashed worker is closed off, not left dangling.
    await tx.query(sql`
      UPDATE telephony_sync_run SET status = 'failed', finished_at = now(), error = 'The sync stopped without reporting back.'
      WHERE organization_id = ${ctx.organizationId} AND connection_id = ${id} AND status = 'running'`);
    const run = await tx.one<{ id: string }>(sql`
      INSERT INTO telephony_sync_run (organization_id, connection_id, trigger, requested_by)
      VALUES (${ctx.organizationId}, ${id}, ${trigger}, ${requestedBy})
      RETURNING id`);
    return { connection, runId: run.id };
  });
}

export interface SyncRunOutcome {
  readonly status: Exclude<SyncStatus, 'running'>;
  readonly error: string | null;
  readonly credentialsRejected: boolean;
  readonly windowFrom: Date | null;
  readonly windowTo: Date | null;
  /** New high-water mark, or null to keep the current one. */
  readonly syncedThrough: Date | null;
  readonly agentsSeen: number;
  readonly agentsMatched: number;
  readonly callsSeen: number;
  readonly callsCreated: number;
  readonly callsUpdated: number;
  readonly apiRequests: number;
}

export async function finishSync(
  ctx: RequestContext,
  connectionId: string,
  runId: string,
  outcome: SyncRunOutcome,
): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    await tx.query(sql`
      UPDATE telephony_connection
      SET last_sync_status = ${outcome.status},
          last_sync_finished_at = now(),
          last_sync_error = ${outcome.error},
          synced_through = CASE
            WHEN ${outcome.syncedThrough}::timestamptz IS NULL THEN synced_through
            ELSE GREATEST(COALESCE(synced_through, ${outcome.syncedThrough}::timestamptz), ${outcome.syncedThrough}::timestamptz)
          END,
          status = CASE
            WHEN status IN ('disconnected', 'paused') THEN status
            WHEN ${outcome.credentialsRejected}::boolean THEN 'error'
            WHEN ${outcome.status}::text IN ('succeeded', 'partial') THEN 'active'
            ELSE status
          END
      WHERE organization_id = ${ctx.organizationId} AND id = ${connectionId}`);
    await tx.query(sql`
      UPDATE telephony_sync_run
      SET status = ${outcome.status}, finished_at = now(), error = ${outcome.error},
          window_from = ${outcome.windowFrom}, window_to = ${outcome.windowTo},
          agents_seen = ${outcome.agentsSeen}, agents_matched = ${outcome.agentsMatched},
          calls_seen = ${outcome.callsSeen}, calls_created = ${outcome.callsCreated},
          calls_updated = ${outcome.callsUpdated}, api_requests = ${outcome.apiRequests}
      WHERE organization_id = ${ctx.organizationId} AND id = ${runId}`);
  });
}

export async function listSyncRuns(ctx: RequestContext, connectionId: string, limit: number): Promise<TelephonySyncRunView[]> {
  return db.query<TelephonySyncRunView>(
    ctx,
    sql`SELECT r.id, r.connection_id AS "connectionId", r.trigger, r.status,
               r.window_from AS "windowFrom", r.window_to AS "windowTo",
               r.agents_seen AS "agentsSeen", r.agents_matched AS "agentsMatched",
               r.calls_seen AS "callsSeen", r.calls_created AS "callsCreated", r.calls_updated AS "callsUpdated",
               r.api_requests AS "apiRequests", r.error, u.full_name AS "requestedByName",
               r.started_at AS "startedAt", r.finished_at AS "finishedAt"
        FROM telephony_sync_run r
        LEFT JOIN app_user u ON u.organization_id = r.organization_id AND u.id = r.requested_by
        WHERE r.organization_id = ${ctx.organizationId} AND r.connection_id = ${connectionId}
        ORDER BY r.started_at DESC
        LIMIT ${limit}`,
  );
}

/* ==================================================================== *
 * Platform users → employees
 * ==================================================================== */

export async function upsertAgents(
  tx: Tx,
  organizationId: string,
  connectionId: string,
  provider: TelephonyProvider,
  agents: readonly NormalizedAgent[],
): Promise<void> {
  for (const agent of agents) {
    // A changed email undoes an email match (the old match may now be wrong);
    // an admin's manual decision stands.
    await tx.query(sql`
      INSERT INTO telephony_agent
        (organization_id, connection_id, provider, external_id, name, email, role, extension, time_zone,
         phone_numbers, provider_groups, metadata, is_active, last_seen_at)
      VALUES (${organizationId}, ${connectionId}, ${provider}, ${agent.externalId}, ${agent.name}, ${agent.email},
              ${agent.role}, ${agent.extension}, ${agent.timeZone}, ${[...agent.phoneNumbers]}::text[],
              ${[...agent.groups]}::text[], ${JSON.stringify(agent.metadata)}::jsonb, ${agent.isActive}, now())
      ON CONFLICT (organization_id, connection_id, external_id) DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        role = EXCLUDED.role,
        extension = EXCLUDED.extension,
        time_zone = EXCLUDED.time_zone,
        phone_numbers = EXCLUDED.phone_numbers,
        provider_groups = EXCLUDED.provider_groups,
        metadata = EXCLUDED.metadata,
        is_active = EXCLUDED.is_active,
        last_seen_at = now(),
        employee_id = CASE WHEN telephony_agent.match_method = 'email' AND telephony_agent.email IS DISTINCT FROM EXCLUDED.email
                           THEN NULL ELSE telephony_agent.employee_id END,
        matched_at = CASE WHEN telephony_agent.match_method = 'email' AND telephony_agent.email IS DISTINCT FROM EXCLUDED.email
                          THEN NULL ELSE telephony_agent.matched_at END,
        match_method = CASE WHEN telephony_agent.match_method = 'email' AND telephony_agent.email IS DISTINCT FROM EXCLUDED.email
                            THEN 'none' ELSE telephony_agent.match_method END`);
  }
}

/** Platform users only seen on calls (deleted users, ring groups) still need a row. */
export async function ensureAgentsFromCalls(
  tx: Tx,
  organizationId: string,
  connectionId: string,
  provider: TelephonyProvider,
  refs: readonly CallAgentRef[],
): Promise<void> {
  for (const ref of refs) {
    await tx.query(sql`
      INSERT INTO telephony_agent (organization_id, connection_id, provider, external_id, name, email)
      VALUES (${organizationId}, ${connectionId}, ${provider}, ${ref.externalId}, ${ref.name}, ${ref.email})
      ON CONFLICT (organization_id, connection_id, external_id) DO UPDATE SET
        name = COALESCE(telephony_agent.name, EXCLUDED.name),
        email = COALESCE(telephony_agent.email, EXCLUDED.email)`);
  }
}

/**
 * Email matching. citext makes the comparison case-insensitive; employee
 * emails are unique per organization, so a match is never ambiguous. Former
 * employees match too — their calls are still history.
 */
export async function matchAgentsByEmail(tx: Tx, organizationId: string): Promise<number> {
  const rows = await tx.query<{ id: string }>(sql`
    UPDATE telephony_agent a
    SET employee_id = u.id, match_method = 'email', matched_at = now(), matched_by = NULL
    FROM app_user u
    WHERE a.organization_id = ${organizationId}
      AND a.match_method = 'none'
      AND a.email IS NOT NULL
      AND u.organization_id = a.organization_id
      AND u.account_type = 'employee'
      AND u.email = a.email
    RETURNING a.id`);
  return rows.length;
}

export async function agentIdsByExternalId(tx: Tx, organizationId: string, connectionId: string): Promise<Map<string, string>> {
  const rows = await tx.query<{ id: string; externalId: string }>(sql`
    SELECT id, external_id AS "externalId" FROM telephony_agent
    WHERE organization_id = ${organizationId} AND connection_id = ${connectionId}`);
  return new Map(rows.map((row) => [row.externalId, row.id]));
}

export async function countAgents(tx: Tx, organizationId: string, connectionId: string): Promise<{ seen: number; matched: number }> {
  const row = await tx.one<{ seen: number; matched: number }>(sql`
    SELECT count(*)::int AS seen, count(*) FILTER (WHERE employee_id IS NOT NULL)::int AS matched
    FROM telephony_agent WHERE organization_id = ${organizationId} AND connection_id = ${connectionId}`);
  return row;
}

const AGENT_VIEW = sql`
  SELECT a.id, a.connection_id AS "connectionId", a.provider, a.external_id AS "externalId", a.name,
         a.email::text AS email, a.role, a.extension, a.phone_numbers AS "phoneNumbers",
         a.provider_groups AS "groups", a.is_active AS "isActive", a.employee_id AS "employeeId",
         emp.full_name AS "employeeName", emp.email::text AS "employeeEmail",
         a.match_method AS "matchMethod", a.matched_at AS "matchedAt",
         COALESCE(stats.calls, 0)::int AS "callCount", stats.last_call_at AS "lastCallAt",
         a.last_seen_at AS "lastSeenAt"
  FROM telephony_agent a
  JOIN telephony_connection conn ON conn.organization_id = a.organization_id AND conn.id = a.connection_id
  LEFT JOIN app_user emp ON emp.organization_id = a.organization_id AND emp.id = a.employee_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS calls, max(c.started_at) AS last_call_at
    FROM telephony_call c
    WHERE c.organization_id = a.organization_id AND c.agent_id = a.id
  ) stats ON true`;

export async function listAgentViews(
  ctx: RequestContext,
  filter: { connectionId?: string | undefined; status: 'all' | 'matched' | 'unmatched' | 'ignored' },
): Promise<TelephonyAgentView[]> {
  const parts: SqlFragment[] = [sql`a.organization_id = ${ctx.organizationId}`, sql`conn.status <> 'disconnected'`];
  if (filter.connectionId) parts.push(sql`a.connection_id = ${filter.connectionId}`);
  if (filter.status === 'matched') parts.push(sql`a.employee_id IS NOT NULL`);
  if (filter.status === 'unmatched') parts.push(sql`a.match_method = 'none'`);
  if (filter.status === 'ignored') parts.push(sql`a.match_method = 'ignored'`);
  return db.query<TelephonyAgentView>(
    ctx,
    sql`${AGENT_VIEW} WHERE ${sql.join(parts, ' AND ')}
        ORDER BY (a.match_method = 'none') DESC, COALESCE(stats.calls, 0) DESC, a.name NULLS LAST`,
  );
}

export async function findAgentView(ctx: RequestContext, id: string): Promise<TelephonyAgentView | null> {
  return db.maybeOne<TelephonyAgentView>(ctx, sql`${AGENT_VIEW} WHERE a.organization_id = ${ctx.organizationId} AND a.id = ${id}`);
}

export async function findEmployee(
  ctx: RequestContext,
  id: string,
): Promise<{ id: string; fullName: string } | null> {
  return db.maybeOne(
    ctx,
    sql`SELECT id, full_name AS "fullName" FROM app_user
        WHERE organization_id = ${ctx.organizationId} AND id = ${id} AND account_type = 'employee'`,
  );
}

export async function setAgentMapping(
  tx: Tx,
  ctx: RequestContext,
  agentId: string,
  mapping: { method: Exclude<MatchMethod, 'email'>; employeeId: string | null },
): Promise<void> {
  await tx.query(sql`
    UPDATE telephony_agent
    SET employee_id = ${mapping.employeeId},
        match_method = ${mapping.method},
        matched_at = CASE WHEN ${mapping.method}::text = 'none' THEN NULL ELSE now() END,
        matched_by = CASE WHEN ${mapping.method}::text = 'none' THEN NULL ELSE ${ctx.principal.id}::uuid END
    WHERE organization_id = ${ctx.organizationId} AND id = ${agentId}`);
}

/** Forget every email match so the matcher can redo them; manual decisions stay. */
export async function resetEmailMatches(tx: Tx, organizationId: string): Promise<void> {
  await tx.query(sql`
    UPDATE telephony_agent SET employee_id = NULL, match_method = 'none', matched_at = NULL
    WHERE organization_id = ${organizationId} AND match_method = 'email'`);
}

export async function listEmployeeOptions(ctx: RequestContext): Promise<EmployeeOption[]> {
  return db.query<EmployeeOption>(
    ctx,
    sql`SELECT u.id, u.full_name AS "fullName", u.email::text AS email, t.name AS "teamName", d.name AS "departmentName"
        FROM app_user u
        LEFT JOIN team t ON t.organization_id = u.organization_id AND t.id = u.team_id
        LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
        WHERE u.organization_id = ${ctx.organizationId}
          AND u.account_type = 'employee'
          AND u.status <> 'offboarded'
        ORDER BY u.full_name`,
  );
}

/* ==================================================================== *
 * Calls
 * ==================================================================== */

export async function upsertCalls(
  tx: Tx,
  organizationId: string,
  connectionId: string,
  provider: TelephonyProvider,
  calls: readonly NormalizedCall[],
  agentIds: ReadonlyMap<string, string>,
): Promise<{ created: number; updated: number }> {
  if (calls.length === 0) return { created: 0, updated: 0 };
  const rows = calls.map((call) => {
    const agentId = call.agent ? (agentIds.get(call.agent.externalId) ?? null) : null;
    return sql`(
      ${organizationId}::uuid, ${connectionId}::uuid, ${provider}, ${call.externalId}, ${agentId}::uuid,
      ${call.direction}, ${call.outcome}, ${call.providerStatus}, ${call.missedReason},
      ${call.startedAt}::timestamptz, ${call.answeredAt}::timestamptz, ${call.endedAt}::timestamptz,
      ${call.durationSeconds}::int, ${call.talkSeconds}::int, ${call.ringSeconds}::int, ${call.holdSeconds}::int,
      ${call.queueWaitSeconds}::int, ${call.wrapUpSeconds}::int,
      ${call.contactNumber}, ${call.contactName}, ${call.contactEmail}, ${call.businessNumber}, ${call.businessNumberName},
      ${call.hasRecording}::boolean, ${call.hasVoicemail}::boolean, ${call.notes}, ${call.disposition},
      ${[...call.tags]}::text[], ${call.rating}::int, ${call.aiSummary}, ${call.aiSentiment}, ${call.aiScore}::numeric,
      ${call.providerLink}, ${JSON.stringify(call.metadata)}::jsonb
    )`;
  });
  const result = await tx.query<{ inserted: boolean }>(sql`
    INSERT INTO telephony_call (
      organization_id, connection_id, provider, external_id, agent_id,
      direction, outcome, provider_status, missed_reason,
      started_at, answered_at, ended_at,
      duration_seconds, talk_seconds, ring_seconds, hold_seconds, queue_wait_seconds, wrap_up_seconds,
      contact_number, contact_name, contact_email, business_number, business_number_name,
      has_recording, has_voicemail, notes, disposition, tags, rating, ai_summary, ai_sentiment, ai_score,
      provider_link, metadata
    ) VALUES ${sql.join(rows, ', ')}
    ON CONFLICT (organization_id, connection_id, external_id) DO UPDATE SET
      agent_id = COALESCE(EXCLUDED.agent_id, telephony_call.agent_id),
      direction = EXCLUDED.direction,
      outcome = EXCLUDED.outcome,
      provider_status = EXCLUDED.provider_status,
      missed_reason = EXCLUDED.missed_reason,
      started_at = EXCLUDED.started_at,
      answered_at = EXCLUDED.answered_at,
      ended_at = EXCLUDED.ended_at,
      duration_seconds = EXCLUDED.duration_seconds,
      talk_seconds = EXCLUDED.talk_seconds,
      ring_seconds = EXCLUDED.ring_seconds,
      hold_seconds = EXCLUDED.hold_seconds,
      queue_wait_seconds = EXCLUDED.queue_wait_seconds,
      wrap_up_seconds = EXCLUDED.wrap_up_seconds,
      contact_number = EXCLUDED.contact_number,
      contact_name = EXCLUDED.contact_name,
      contact_email = EXCLUDED.contact_email,
      business_number = EXCLUDED.business_number,
      business_number_name = EXCLUDED.business_number_name,
      has_recording = EXCLUDED.has_recording,
      has_voicemail = EXCLUDED.has_voicemail,
      notes = EXCLUDED.notes,
      disposition = EXCLUDED.disposition,
      tags = EXCLUDED.tags,
      rating = EXCLUDED.rating,
      ai_summary = COALESCE(EXCLUDED.ai_summary, telephony_call.ai_summary),
      ai_sentiment = COALESCE(EXCLUDED.ai_sentiment, telephony_call.ai_sentiment),
      ai_score = COALESCE(EXCLUDED.ai_score, telephony_call.ai_score),
      provider_link = EXCLUDED.provider_link,
      metadata = EXCLUDED.metadata,
      last_synced_at = now()
    RETURNING (xmax = 0) AS inserted`);
  const created = result.filter((row) => row.inserted).length;
  return { created, updated: result.length - created };
}

/** The joins every call read shares. `emp` is the employee the call is attributed to. */
const CALL_FROM = sql`
  FROM telephony_call c
  JOIN telephony_connection conn ON conn.organization_id = c.organization_id AND conn.id = c.connection_id
  LEFT JOIN telephony_agent a ON a.organization_id = c.organization_id AND a.id = c.agent_id
  LEFT JOIN app_user emp ON emp.organization_id = a.organization_id AND emp.id = a.employee_id
  LEFT JOIN team t ON t.organization_id = emp.organization_id AND t.id = emp.team_id`;

export interface CallFilter {
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
  readonly employeeId?: string | undefined;
  readonly teamId?: string | undefined;
  readonly provider?: TelephonyProvider | undefined;
  readonly direction?: 'inbound' | 'outbound' | undefined;
  readonly outcome?: CallOutcome | undefined;
  readonly search?: string | undefined;
  readonly unmatchedOnly?: boolean | undefined;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function callWhere(organizationId: string, visibility: SqlFragment, filter: CallFilter): SqlFragment {
  const parts: SqlFragment[] = [
    sql`c.organization_id = ${organizationId}`,
    visibility,
    // Days are the company's days: midnight to midnight in its timezone.
    sql`c.started_at >= (${filter.from}::date::timestamp AT TIME ZONE ${filter.timeZone})`,
    sql`c.started_at < ((${filter.to}::date + 1)::timestamp AT TIME ZONE ${filter.timeZone})`,
  ];
  if (filter.employeeId) parts.push(sql`emp.id = ${filter.employeeId}`);
  if (filter.teamId) parts.push(sql`emp.team_id = ${filter.teamId}`);
  if (filter.provider) parts.push(sql`c.provider = ${filter.provider}`);
  if (filter.direction) parts.push(sql`c.direction = ${filter.direction}`);
  if (filter.outcome) parts.push(sql`c.outcome = ${filter.outcome}`);
  if (filter.unmatchedOnly) parts.push(sql`emp.id IS NULL`);
  const search = filter.search?.trim();
  if (search) {
    const like = `%${escapeLike(search)}%`;
    const digits = search.replace(/\D/g, '');
    parts.push(
      digits.length >= 3
        ? sql`(c.contact_number LIKE ${`%${digits}%`} OR c.business_number LIKE ${`%${digits}%`} OR c.contact_name ILIKE ${like})`
        : sql`(c.contact_name ILIKE ${like} OR c.contact_email ILIKE ${like} OR a.name ILIKE ${like}
               OR emp.full_name ILIKE ${like} OR c.disposition ILIKE ${like} OR c.notes ILIKE ${like})`,
    );
  }
  return sql.join(parts, ' AND ');
}

const LIST_COLUMNS = sql`
  c.id, c.provider, c.direction, c.outcome, c.started_at AS "startedAt",
  c.duration_seconds AS "durationSeconds", c.talk_seconds AS "talkSeconds",
  c.contact_number AS "contactNumber", c.contact_name AS "contactName",
  c.business_number AS "businessNumber", c.business_number_name AS "businessNumberName",
  a.name AS "agentName", a.email::text AS "agentEmail",
  emp.id AS "employeeId", emp.full_name AS "employeeName", t.name AS "teamName",
  c.has_recording AS "hasRecording", c.has_voicemail AS "hasVoicemail",
  c.disposition, c.tags, c.ai_sentiment AS "aiSentiment"`;

export async function listCallRows(
  ctx: RequestContext,
  where: SqlFragment,
  page: number,
  pageSize: number,
): Promise<{ rows: TelephonyCallListItem[]; total: number }> {
  const [rows, count] = await Promise.all([
    db.query<TelephonyCallListItem>(
      ctx,
      sql`SELECT ${LIST_COLUMNS} ${CALL_FROM} WHERE ${where}
          ORDER BY c.started_at DESC, c.id DESC
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    ),
    db.one<{ total: number }>(ctx, sql`SELECT count(*)::int AS total ${CALL_FROM} WHERE ${where}`),
  ]);
  return { rows, total: count.total };
}

export async function findCallDetail(ctx: RequestContext, id: string): Promise<TelephonyCallDetail | null> {
  return db.maybeOne<TelephonyCallDetail>(
    ctx,
    sql`SELECT ${LIST_COLUMNS},
               c.external_id AS "externalId", c.provider_status AS "providerStatus", c.missed_reason AS "missedReason",
               c.answered_at AS "answeredAt", c.ended_at AS "endedAt", c.ring_seconds AS "ringSeconds",
               c.hold_seconds AS "holdSeconds", c.queue_wait_seconds AS "queueWaitSeconds",
               c.wrap_up_seconds AS "wrapUpSeconds", c.contact_email AS "contactEmail", c.notes, c.rating,
               c.ai_summary AS "aiSummary", c.ai_score::float8 AS "aiScore", c.provider_link AS "providerLink",
               c.metadata, conn.label AS "connectionLabel", c.last_synced_at AS "lastSyncedAt"
        ${CALL_FROM}
        WHERE c.organization_id = ${ctx.organizationId} AND c.id = ${id}`,
  );
}

export async function loadCallResource(ctx: RequestContext, id: string): Promise<TelephonyCallResource | null> {
  const row = await db.maybeOne<{ id: string; organizationId: string; employeeId: string | null; teamId: string | null; departmentId: string | null }>(
    ctx,
    sql`SELECT c.id, c.organization_id AS "organizationId", emp.id AS "employeeId",
               emp.team_id AS "teamId", emp.department_id AS "departmentId"
        FROM telephony_call c
        LEFT JOIN telephony_agent a ON a.organization_id = c.organization_id AND a.id = c.agent_id
        LEFT JOIN app_user emp ON emp.organization_id = a.organization_id AND emp.id = a.employee_id
        WHERE c.organization_id = ${ctx.organizationId} AND c.id = ${id}`,
  );
  return row ? { type: 'telephonyCall', ...row } : null;
}

export async function findCallForPlayback(
  ctx: RequestContext,
  id: string,
): Promise<{ externalId: string; connectionId: string; provider: TelephonyProvider; hasRecording: boolean; hasVoicemail: boolean } | null> {
  return db.maybeOne(
    ctx,
    sql`SELECT external_id AS "externalId", connection_id AS "connectionId", provider,
               has_recording AS "hasRecording", has_voicemail AS "hasVoicemail"
        FROM telephony_call WHERE organization_id = ${ctx.organizationId} AND id = ${id}`,
  );
}

/* ==================================================================== *
 * Analytics
 * ==================================================================== */

export async function organizationTimeZone(ctx: RequestContext): Promise<string> {
  const row = await db.maybeOne<{ timezone: string }>(ctx, sql`SELECT timezone FROM organization WHERE id = ${ctx.organizationId}`);
  return row?.timezone ?? 'UTC';
}

export async function selectTotals(ctx: RequestContext, where: SqlFragment): Promise<CallTotals> {
  return db.one<CallTotals>(
    ctx,
    sql`SELECT count(*)::int AS "totalCalls",
               count(*) FILTER (WHERE c.direction = 'inbound')::int AS inbound,
               count(*) FILTER (WHERE c.direction = 'outbound')::int AS outbound,
               count(*) FILTER (WHERE c.outcome = 'answered')::int AS answered,
               count(*) FILTER (WHERE c.direction = 'inbound' AND c.outcome IN ('missed', 'abandoned', 'voicemail'))::int AS "missedInbound",
               count(*) FILTER (WHERE c.outcome = 'voicemail')::int AS voicemail,
               count(*) FILTER (WHERE c.direction = 'outbound' AND c.outcome <> 'answered')::int AS "unansweredOutbound",
               COALESCE(sum(c.talk_seconds), 0)::float8 AS "talkSeconds",
               COALESCE(round(avg(c.talk_seconds) FILTER (WHERE c.outcome = 'answered')), 0)::float8 AS "avgTalkSeconds",
               count(DISTINCT c.contact_number)::int AS "uniqueContacts",
               max(c.started_at) AS "lastCallAt"
        ${CALL_FROM} WHERE ${where}`,
  );
}

export async function selectDaily(ctx: RequestContext, where: SqlFragment, timeZone: string): Promise<DailyCallPoint[]> {
  return db.query<DailyCallPoint>(
    ctx,
    sql`SELECT to_char((c.started_at AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS day,
               count(*) FILTER (WHERE c.direction = 'inbound')::int AS inbound,
               count(*) FILTER (WHERE c.direction = 'outbound')::int AS outbound,
               count(*) FILTER (WHERE c.outcome = 'answered')::int AS answered,
               count(*) FILTER (WHERE c.direction = 'inbound' AND c.outcome IN ('missed', 'abandoned', 'voicemail'))::int AS missed,
               COALESCE(sum(c.talk_seconds), 0)::float8 AS "talkSeconds"
        ${CALL_FROM} WHERE ${where}
        GROUP BY 1 ORDER BY 1`,
  );
}

export async function selectHourly(ctx: RequestContext, where: SqlFragment, timeZone: string): Promise<HourlyCallPoint[]> {
  return db.query<HourlyCallPoint>(
    ctx,
    sql`SELECT extract(hour FROM c.started_at AT TIME ZONE ${timeZone})::int AS hour, count(*)::int AS calls
        ${CALL_FROM} WHERE ${where}
        GROUP BY 1 ORDER BY 1`,
  );
}

export async function selectOutcomes(ctx: RequestContext, where: SqlFragment): Promise<OutcomeCount[]> {
  return db.query<OutcomeCount>(
    ctx,
    sql`SELECT c.outcome, count(*)::int AS calls ${CALL_FROM} WHERE ${where}
        GROUP BY c.outcome ORDER BY calls DESC`,
  );
}

export async function selectEmployees(ctx: RequestContext, where: SqlFragment): Promise<EmployeeCallStats[]> {
  return db.query<EmployeeCallStats>(
    ctx,
    sql`SELECT emp.id AS "employeeId", emp.full_name AS "employeeName", t.name AS "teamName",
               count(*)::int AS "totalCalls",
               count(*) FILTER (WHERE c.direction = 'inbound')::int AS inbound,
               count(*) FILTER (WHERE c.direction = 'outbound')::int AS outbound,
               count(*) FILTER (WHERE c.outcome = 'answered')::int AS answered,
               count(*) FILTER (WHERE c.direction = 'inbound' AND c.outcome IN ('missed', 'abandoned', 'voicemail'))::int AS "missedInbound",
               COALESCE(sum(c.talk_seconds), 0)::float8 AS "talkSeconds",
               COALESCE(round(avg(c.talk_seconds) FILTER (WHERE c.outcome = 'answered')), 0)::float8 AS "avgTalkSeconds",
               max(c.started_at) AS "lastCallAt"
        ${CALL_FROM} WHERE ${where}
        GROUP BY emp.id, emp.full_name, t.name
        ORDER BY count(*) DESC, emp.full_name NULLS LAST
        LIMIT 500`,
  );
}

/** Employees whose calls the caller may see, for the pickers. */
export async function listVisibleEmployees(ctx: RequestContext, visibility: SqlFragment): Promise<VisibleEmployee[]> {
  return db.query<VisibleEmployee>(
    ctx,
    sql`SELECT emp.id, emp.full_name AS "fullName", emp.team_id AS "teamId", t.name AS "teamName"
        FROM app_user emp
        LEFT JOIN team t ON t.organization_id = emp.organization_id AND t.id = emp.team_id
        WHERE emp.organization_id = ${ctx.organizationId}
          AND emp.account_type = 'employee'
          AND ${visibility}
          AND EXISTS (
            SELECT 1 FROM telephony_agent a
            WHERE a.organization_id = emp.organization_id AND a.employee_id = emp.id
          )
        ORDER BY emp.full_name`,
  );
}

/* ==================================================================== *
 * Audit (activity stream). Never carries a key, a secret or a hint.
 * ==================================================================== */

export async function insertAudit(
  tx: Tx,
  ctx: RequestContext,
  action: string,
  targetType: 'telephonyConnection' | 'telephonyAgent',
  targetId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO audit_outbox (organization_id, stream, payload)
    VALUES (${ctx.organizationId}, 'activity', ${JSON.stringify({
      action,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetType,
      targetId,
      before,
      after,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    })}::jsonb)`);
}
