import type { SocialPostQuery, SocialSettings } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type {
  AccountRow,
  ApprovalRow,
  DestinationRow,
  MediaRow,
  PostRow,
} from './types.js';
import { SocialNotFoundError } from './errors.js';
import { notify } from '../notifications/facade.js';

const POST = sql`SELECT p.*, ARRAY(SELECT media_id FROM social_post_media pm WHERE pm.organization_id=p.organization_id AND pm.client_id=p.client_id AND pm.post_id=p.id ORDER BY position) AS shared_media_ids, u.full_name AS created_by_name FROM social_post p JOIN app_user u ON u.organization_id = p.organization_id AND u.id = p.created_by`;
// An account's connection is either its client's own or the company's (client_id NULL).
// A company location may hold a token of its own (a Facebook Page's).
const ACCOUNT = sql`SELECT a.*, c.scopes, c.credentials_encrypted, c.expires_at, c.client_id AS connection_client_id, c.platform AS connection_platform, c.connected_via AS connection_origin,
  c.external_account_id AS connection_external_account_id, loc.credentials_encrypted AS location_credentials_encrypted
  FROM social_account a JOIN social_connection c ON c.organization_id = a.organization_id AND c.id = a.connection_id
  LEFT JOIN social_connection_location loc ON loc.organization_id = a.organization_id AND loc.connection_id = a.connection_id AND loc.id = a.location_id`;
const DESTINATION = sql`SELECT d.*, a.name AS account_name, a.platform, d.last_error AS error,
  ARRAY(SELECT dm.media_id FROM social_destination_media dm WHERE dm.organization_id = d.organization_id AND dm.client_id = d.client_id AND dm.destination_id = d.id ORDER BY dm.position) AS media_ids
  FROM social_post_destination d JOIN social_account a ON a.organization_id = d.organization_id AND a.client_id = d.client_id AND a.id = d.account_id`;

export async function ensureClient(
  tx: Tx,
  organizationId: string,
  clientId: string,
): Promise<{ timezone: string }> {
  const client = await tx.maybeOne<{ timezone: string }>(
    sql`SELECT timezone FROM client WHERE organization_id = ${organizationId} AND id = ${clientId} AND status = 'active'`,
  );
  if (!client) throw new SocialNotFoundError('Active client');
  return client;
}
export async function findSettings(
  tx: Tx,
  organizationId: string,
  clientId: string,
): Promise<SocialSettings> {
  const client = await ensureClient(tx, organizationId, clientId);
  return (
    (await tx.maybeOne<SocialSettings>(
      sql`SELECT client_id, timezone, approval_required, client_review_enabled FROM social_workspace_settings WHERE organization_id = ${organizationId} AND client_id = ${clientId}`,
    )) ?? {
      clientId,
      timezone: client.timezone,
      approvalRequired: false,
      clientReviewEnabled: false,
    }
  );
}
/** Serializes everything that can give a platform account (a Facebook Page, an
 * Instagram account, ...) to a client, so two people connecting the same one to two
 * clients at once cannot both succeed. Taken before any row lock, in a stable order. */
export async function lockPlatformAccounts(
  tx: Tx,
  organizationId: string,
  accounts: readonly { platform: string; externalId: string }[],
): Promise<void> {
  const keys = [
    ...new Set(
      accounts.map(
        (account) =>
          `social-account:${organizationId}:${account.platform}:${account.externalId}`,
      ),
    ),
  ].sort();
  for (const key of keys)
    await tx.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/** The clients platform accounts already serve, other than `clientId`, keyed by
 * `platform:externalId`. A Page serves one client at a time, however it was connected. */
export async function platformAccountHolders(
  tx: Tx,
  organizationId: string,
  accounts: readonly { platform: string; externalId: string }[],
  clientId: string,
): Promise<Map<string, { clientName: string; viaCompany: boolean }>> {
  const holders = new Map<string, { clientName: string; viaCompany: boolean }>();
  if (!accounts.length) return holders;
  const rows = await tx.query<{
    platform: string;
    externalId: string;
    clientName: string;
    viaCompany: boolean;
  }>(
    sql`SELECT DISTINCT ON (a.platform, a.external_id) a.platform, a.external_id,
        COALESCE(NULLIF(c.business_name, ''), c.client_name) AS client_name, a.location_id IS NOT NULL AS via_company
      FROM social_account a JOIN client c ON c.organization_id = a.organization_id AND c.id = a.client_id
      JOIN unnest(${accounts.map((item) => item.platform)}::text[], ${accounts.map((item) => item.externalId)}::text[]) AS wanted(platform, external_id)
        ON wanted.platform = a.platform AND wanted.external_id = a.external_id
      WHERE a.organization_id = ${organizationId} AND a.status <> 'disconnected' AND a.client_id <> ${clientId}
      ORDER BY a.platform, a.external_id, a.connected_at`,
  );
  for (const row of rows)
    holders.set(`${row.platform}:${row.externalId}`, {
      clientName: row.clientName,
      viaCompany: row.viaCompany,
    });
  return holders;
}

/** How platform accounts already serve `clientId` itself, keyed by `platform:externalId`:
 * `client_portal` when the client connected it from the client portal, `agency` when the
 * agency did (with a company login or a sign-in for this client). Neither side may take
 * over the other's live account without an explicit disconnect first. */
export async function sameClientHolders(
  tx: Tx,
  organizationId: string,
  accounts: readonly { platform: string; externalId: string }[],
  clientId: string,
): Promise<Map<string, 'agency' | 'client_portal'>> {
  const holders = new Map<string, 'agency' | 'client_portal'>();
  if (!accounts.length) return holders;
  const rows = await tx.query<{
    platform: string;
    externalId: string;
    origin: 'agency' | 'client_portal';
  }>(
    sql`SELECT a.platform, a.external_id, c.connected_via AS origin
      FROM social_account a JOIN social_connection c ON c.organization_id = a.organization_id AND c.id = a.connection_id
      JOIN unnest(${accounts.map((item) => item.platform)}::text[], ${accounts.map((item) => item.externalId)}::text[]) AS wanted(platform, external_id)
        ON wanted.platform = a.platform AND wanted.external_id = a.external_id
      WHERE a.organization_id = ${organizationId} AND a.client_id = ${clientId} AND a.status <> 'disconnected'`,
  );
  for (const row of rows) holders.set(`${row.platform}:${row.externalId}`, row.origin);
  return holders;
}

/** `clientId` is null for company-wide events, such as connecting the company's Google account. */
export async function writeAudit(
  tx: Tx,
  ctx: RequestContext,
  clientId: string | null,
  action: string,
  resourceId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  const actorId = ctx.principal.accountType === 'service' ? null : ctx.principal.id;
  await tx.query(
    sql`INSERT INTO social_audit_log(organization_id, client_id, actor_id, action, resource_id, details) VALUES (${ctx.organizationId}, ${clientId}, ${actorId}, ${action}, ${resourceId}, ${JSON.stringify(details)}::jsonb)`,
  );
}
export async function findAccounts(
  tx: Tx,
  organizationId: string,
  clientId: string,
  accountIds?: readonly string[],
): Promise<AccountRow[]> {
  return tx.query<AccountRow>(
    sql`${ACCOUNT} WHERE a.organization_id = ${organizationId} AND a.client_id = ${clientId} ${accountIds ? sql`AND a.id = ANY(${[...accountIds]}::uuid[])` : sql``} ORDER BY a.platform, a.name`,
  );
}
export async function findMedia(
  tx: Tx,
  organizationId: string,
  clientId: string,
  mediaIds?: readonly string[],
): Promise<MediaRow[]> {
  return tx.query<MediaRow>(
    sql`SELECT * FROM social_media WHERE organization_id = ${organizationId} AND client_id = ${clientId} ${mediaIds ? sql`AND id = ANY(${[...mediaIds]}::uuid[])` : sql``} ORDER BY created_at DESC LIMIT 500`,
  );
}
export async function findPost(
  tx: Tx,
  organizationId: string,
  clientId: string,
  postId: string,
  lock = false,
): Promise<PostRow> {
  const row = await tx.maybeOne<PostRow>(
    sql`${POST} WHERE p.organization_id = ${organizationId} AND p.client_id = ${clientId} AND p.id = ${postId} ${lock ? sql`FOR UPDATE OF p` : sql``}`,
  );
  if (!row) throw new SocialNotFoundError('Post');
  return row;
}
export async function findPostParts(
  tx: Tx,
  organizationId: string,
  clientId: string,
  postId: string,
): Promise<{
  media: MediaRow[];
  destinations: DestinationRow[];
  approvals: ApprovalRow[];
}> {
  const media = await tx.query<MediaRow>(sql`
    SELECT m.* FROM social_media m WHERE m.organization_id=${organizationId} AND m.client_id=${clientId}
    AND (EXISTS(SELECT 1 FROM social_post_media pm WHERE pm.organization_id=m.organization_id AND pm.client_id=m.client_id AND pm.media_id=m.id AND pm.post_id=${postId})
      OR EXISTS(SELECT 1 FROM social_destination_media dm JOIN social_post_destination d ON d.organization_id=dm.organization_id AND d.client_id=dm.client_id AND d.id=dm.destination_id
        WHERE dm.organization_id=m.organization_id AND dm.client_id=m.client_id AND dm.media_id=m.id AND d.post_id=${postId}))
    ORDER BY m.created_at,m.id
  `);
  const destinations = await tx.query<DestinationRow>(
    sql`${DESTINATION} WHERE d.organization_id = ${organizationId} AND d.client_id = ${clientId} AND d.post_id = ${postId} ORDER BY a.platform, a.name`,
  );
  const approvals = await tx.query<ApprovalRow>(
    sql`SELECT ap.*, u.full_name AS actor_name FROM social_approval ap JOIN app_user u ON u.organization_id = ap.organization_id AND u.id = ap.actor_id WHERE ap.organization_id = ${organizationId} AND ap.client_id = ${clientId} AND ap.post_id = ${postId} ORDER BY ap.created_at`,
  );
  return { media, destinations, approvals };
}
export async function queryPosts(
  ctx: RequestContext,
  clientId: string,
  query: SocialPostQuery,
): Promise<{ rows: PostRow[]; total: number; page: number; pageSize: number }> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const statuses = query.status?.length ? [...query.status] : null;
  const clauses = sql`p.organization_id = ${ctx.organizationId} AND p.client_id = ${clientId}
    AND (${query.search ?? null}::text IS NULL OR p.caption ILIKE ${`%${query.search ?? ''}%`})
    AND (${statuses}::text[] IS NULL OR p.status = ANY(${statuses}::text[]))
    AND (${query.from ?? null}::timestamptz IS NULL OR COALESCE(p.scheduled_at,p.published_at,p.created_at) >= ${query.from ?? null}::timestamptz)
    AND (${query.to ?? null}::timestamptz IS NULL OR COALESCE(p.scheduled_at,p.published_at,p.created_at) <= ${query.to ?? null}::timestamptz)
    AND (${query.platform ?? null}::text IS NULL OR EXISTS(SELECT 1 FROM social_post_destination d JOIN social_account a ON a.organization_id = d.organization_id AND a.client_id = d.client_id AND a.id = d.account_id WHERE d.organization_id = p.organization_id AND d.client_id = p.client_id AND d.post_id = p.id AND a.platform = ${query.platform ?? null}))`;
  const [rows, count] = await Promise.all([
    db.query<PostRow>(
      ctx,
      sql`${POST} WHERE ${clauses} ORDER BY p.created_at ${query.sort === 'oldest' ? sql`ASC` : sql`DESC`} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    ),
    db.one<{ count: string }>(
      ctx,
      sql`SELECT count(*)::text AS count FROM social_post p WHERE ${clauses}`,
    ),
  ]);
  return { rows, total: Number(count.count), page, pageSize };
}

/** Recompute the aggregate from recorded destination outcomes, never guesses. */
export async function refreshPostStatus(
  tx: Tx,
  organizationId: string,
  clientId: string,
  postId: string,
): Promise<void> {
  await tx.query(sql`UPDATE social_post p SET status = CASE
    WHEN EXISTS(SELECT 1 FROM social_post_destination d WHERE d.post_id = p.id AND d.status = 'publishing') THEN 'publishing'
    WHEN EXISTS(SELECT 1 FROM social_post_destination d WHERE d.post_id = p.id AND d.status = 'scheduled') THEN 'scheduled'
    WHEN NOT EXISTS(SELECT 1 FROM social_post_destination d WHERE d.post_id = p.id AND d.status <> 'published') THEN 'published'
    WHEN EXISTS(SELECT 1 FROM social_post_destination d WHERE d.post_id = p.id AND d.status = 'published') THEN 'partially_published'
    WHEN NOT EXISTS(SELECT 1 FROM social_post_destination d WHERE d.post_id = p.id AND d.status <> 'cancelled') THEN 'cancelled'
    ELSE 'failed' END,
    published_at = CASE WHEN NOT EXISTS(SELECT 1 FROM social_post_destination d WHERE d.post_id = p.id AND d.status <> 'published') THEN COALESCE(p.published_at,now()) ELSE p.published_at END,
    updated_at = now()
    WHERE p.organization_id = ${organizationId} AND p.client_id = ${clientId} AND p.id = ${postId}`);
}

/** Cancels an account's scheduled destinations before it stops serving a client.
 * Each post is locked before its destinations, the order every writer uses. */
export async function cancelScheduledForAccount(
  tx: Tx,
  organizationId: string,
  clientId: string,
  accountId: string,
  reason: string,
): Promise<number> {
  const pending = await tx.query<{ postId: string }>(
    sql`SELECT DISTINCT post_id FROM social_post_destination WHERE organization_id = ${organizationId} AND client_id = ${clientId} AND account_id = ${accountId} AND status = 'scheduled'`,
  );
  let cancelled = 0;
  for (const item of pending) {
    await findPost(tx, organizationId, clientId, item.postId, true);
    const rows = await tx.query<{ id: string }>(
      sql`UPDATE social_post_destination SET status = 'cancelled', next_attempt_at = NULL, last_error = ${reason} WHERE organization_id = ${organizationId} AND client_id = ${clientId} AND post_id = ${item.postId} AND account_id = ${accountId} AND status = 'scheduled' RETURNING id`,
    );
    cancelled += rows.length;
    await refreshPostStatus(tx, organizationId, clientId, item.postId);
  }
  return cancelled;
}

export interface DueDestination {
  id: string;
  clientId: string;
  postId: string;
  publishingActorId: string | null;
}
export async function dueDestinations(
  ctx: RequestContext,
  now: Date,
): Promise<DueDestination[]> {
  return db.query<DueDestination>(
    ctx,
    sql`SELECT d.id, d.client_id, d.post_id, p.publishing_actor_id FROM social_post_destination d JOIN social_post p ON p.organization_id = d.organization_id AND p.client_id = d.client_id AND p.id = d.post_id WHERE d.organization_id = ${ctx.organizationId} AND d.status = 'scheduled' AND d.next_attempt_at <= ${now} AND p.status IN ('scheduled','publishing','partially_published') ORDER BY d.next_attempt_at LIMIT 50`,
  );
}
export async function claimDestination(
  ctx: RequestContext,
  item: DueDestination,
  leaseId: string,
  now: Date,
): Promise<DestinationRow | null> {
  return db.transaction(ctx, async (tx) => {
    // Always lock the parent before the destination. Cancellation and edits use
    // this order too, so a post cannot be cancelled between checking and claim.
    const parent = await findPost(
      tx,
      ctx.organizationId,
      item.clientId,
      item.postId,
      true,
    );
    if (!['scheduled', 'publishing', 'partially_published'].includes(parent.status))
      return null;
    if (parent.approvalRequired && parent.approvedAt === null) return null;
    const row = await tx.maybeOne<{ id: string }>(
      sql`UPDATE social_post_destination SET status = 'publishing', attempts = attempts + 1, lease_id = ${leaseId}, lease_expires_at = ${new Date(now.getTime() + 10 * 60_000)}, next_attempt_at = NULL WHERE organization_id = ${ctx.organizationId} AND client_id = ${item.clientId} AND id = ${item.id} AND status = 'scheduled' AND next_attempt_at <= ${now} AND attempts < 5 RETURNING id`,
    );
    if (!row) return null;
    const claimed = await tx.one<DestinationRow>(
      sql`${DESTINATION} WHERE d.organization_id = ${ctx.organizationId} AND d.client_id = ${item.clientId} AND d.id = ${item.id}`,
    );
    await tx.query(
      sql`INSERT INTO social_publish_attempt(organization_id,client_id,destination_id,attempt,lease_id) VALUES (${ctx.organizationId},${item.clientId},${item.id},${claimed.attempts},${leaseId})`,
    );
    await tx.query(
      sql`UPDATE social_post SET status = 'publishing', updated_at = now() WHERE organization_id = ${ctx.organizationId} AND client_id = ${item.clientId} AND id = ${item.postId}`,
    );
    return claimed;
  });
}

export interface PublishOutcome {
  status: 'published' | 'scheduled' | 'failed' | 'outcome_unknown';
  errorCode?: string;
  error?: string;
  externalPostId?: string;
  url?: string;
  nextAttemptAt?: Date;
}
export async function recordDestinationOutcome(
  ctx: RequestContext,
  destination: DestinationRow,
  outcome: PublishOutcome,
): Promise<boolean> {
  return db.transaction(ctx, async (tx) => {
    await findPost(
      tx,
      ctx.organizationId,
      destination.clientId,
      destination.postId,
      true,
    );
    const saved = await tx.maybeOne<{
      id: string;
    }>(sql`UPDATE social_post_destination SET status = ${outcome.status}, lease_id = NULL, lease_expires_at = NULL,
      next_attempt_at = ${outcome.nextAttemptAt ?? null}, platform_post_id = ${outcome.externalPostId ?? null}, platform_post_url = ${outcome.url ?? null}, last_error = ${outcome.error ?? null}, published_at = ${outcome.status === 'published' ? new Date() : null}
      WHERE organization_id = ${ctx.organizationId} AND client_id = ${destination.clientId} AND id = ${destination.id} AND status = 'publishing' AND lease_id = ${destination.leaseId} RETURNING id`);
    if (!saved) return false;
    await tx.query(
      sql`UPDATE social_publish_attempt SET finished_at = now(), outcome = ${outcome.status === 'scheduled' ? 'retry_scheduled' : outcome.status}, error_code = ${outcome.errorCode ?? null}, error_message = ${outcome.error ?? null}, platform_post_id = ${outcome.externalPostId ?? null} WHERE organization_id = ${ctx.organizationId} AND client_id = ${destination.clientId} AND destination_id = ${destination.id} AND lease_id = ${destination.leaseId}`,
    );
    await refreshPostStatus(
      tx,
      ctx.organizationId,
      destination.clientId,
      destination.postId,
    );
    await writeAudit(
      tx,
      ctx,
      destination.clientId,
      `destination.${outcome.status}`,
      destination.id,
      {
        attempt: destination.attempts,
        ...(outcome.errorCode ? { code: outcome.errorCode } : {}),
      },
    );
    const post = await findPost(
      tx,
      ctx.organizationId,
      destination.clientId,
      destination.postId,
    );
    if (['published', 'partially_published', 'failed'].includes(post.status))
      await notify(tx, ctx, {
        type: 'social.publish_completed',
        priority: 'operational',
        audience: { users: [post.createdBy] },
        title:
          post.status === 'published'
            ? 'Your social post was published'
            : post.status === 'partially_published'
              ? 'Your social post has mixed publishing results'
              : 'Your social post needs attention',
        link: `/company/social?clientId=${destination.clientId}&postId=${destination.postId}`,
        metadata: { clientId: destination.clientId, postId: destination.postId },
      });
    return true;
  });
}

export async function rejectScheduledDestination(
  ctx: RequestContext,
  item: DueDestination,
  message: string,
): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    await findPost(tx, ctx.organizationId, item.clientId, item.postId, true);
    const row = await tx.maybeOne<{ id: string }>(
      sql`UPDATE social_post_destination SET status = 'failed', next_attempt_at = NULL, last_error = ${message} WHERE organization_id = ${ctx.organizationId} AND client_id = ${item.clientId} AND id = ${item.id} AND status = 'scheduled' RETURNING id`,
    );
    if (row) {
      await refreshPostStatus(tx, ctx.organizationId, item.clientId, item.postId);
      await writeAudit(
        tx,
        ctx,
        item.clientId,
        'destination.authorization_failed',
        item.id,
      );
    }
  });
}

export async function analyticsClients(ctx: RequestContext): Promise<string[]> {
  const rows = await db.query<{ clientId: string }>(
    ctx,
    sql`SELECT DISTINCT a.client_id FROM social_account a JOIN client c ON c.organization_id = a.organization_id AND c.id = a.client_id WHERE a.organization_id = ${ctx.organizationId} AND a.status = 'connected' AND c.status = 'active'`,
  );
  return rows.map((row) => row.clientId);
}

/** After a crash we cannot know whether the remote side accepted the create.
 * Persist that uncertainty; resending blindly could publish duplicates. */
export async function expireLeases(ctx: RequestContext, now: Date): Promise<number> {
  const items = await db.query<{ clientId: string; postId: string }>(
    ctx,
    sql`SELECT DISTINCT client_id,post_id FROM social_post_destination WHERE organization_id = ${ctx.organizationId} AND status = 'publishing' AND lease_expires_at < ${now}`,
  );
  let count = 0;
  for (const item of items) {
    count += await db.transaction(ctx, async (tx) => {
      await findPost(tx, ctx.organizationId, item.clientId, item.postId, true);
      const rows = await tx.query<{ id: string; leaseId: string }>(
        sql`UPDATE social_post_destination SET status = 'outcome_unknown', last_error = 'The worker stopped before confirming the result. Check the social account before creating another post.', lease_id = NULL, lease_expires_at = NULL WHERE organization_id = ${ctx.organizationId} AND client_id = ${item.clientId} AND post_id = ${item.postId} AND status = 'publishing' AND lease_expires_at < ${now} RETURNING id`,
      );
      for (const row of rows)
        await tx.query(
          sql`UPDATE social_publish_attempt SET outcome = 'outcome_unknown', finished_at = now(), error_code = 'WORKER_INTERRUPTED', error_message = 'Remote publishing outcome could not be confirmed.' WHERE organization_id = ${ctx.organizationId} AND client_id = ${item.clientId} AND destination_id = ${row.id} AND outcome = 'started'`,
        );
      if (rows.length)
        await refreshPostStatus(tx, ctx.organizationId, item.clientId, item.postId);
      return rows.length;
    });
  }
  return count;
}
