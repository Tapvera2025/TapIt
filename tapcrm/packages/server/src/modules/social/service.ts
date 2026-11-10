import { addDays, instantAt, toDateOnly, toLocalTime } from '../../platform/time.js';
import type {
  SocialAccount,
  SocialAnalytics,
  SocialAnalyticsMetric,
  SocialAnalyticsPlatformAggregate,
  SocialAnalyticsSnapshot,
  SocialPlatform,
  SocialPost,
  SocialPostActionInput,
  SocialPostInput,
  SocialPostList,
  SocialPostQuery,
  SocialPostType,
  SocialPrivacyStatus,
  SocialSettings,
} from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { NOTIFICATION_TYPES, notify } from '../notifications/facade.js';
import {
  SocialConflictError,
  SocialNotFoundError,
  SocialValidationError,
} from './errors.js';
import { mediaDto } from './media.js';
import { getProvider } from './providers/index.js';
import {
  ProviderError,
  type DiscoveredAccount,
  type OAuthCredential,
  type SocialContent,
} from './providers/types.js';
import { authorizeSocialActor } from './policy.js';
import {
  decryptCredentials,
  encryptCredentials,
  type CredentialContext,
} from './security.js';
import {
  cancelScheduledForAccount,
  ensureClient,
  findAccounts,
  findMedia,
  findPost,
  findPostParts,
  findSettings,
  queryPosts,
  writeAudit,
} from './repository.js';
import {
  providerAccount,
  type AccountRow,
  type ConnectionRow,
  type MediaRow,
  type PostRow,
} from './types.js';

function accountDto(row: AccountRow): SocialAccount {
  return {
    id: row.id,
    clientId: row.clientId,
    platform: row.platform,
    externalId: row.externalId,
    name: row.name,
    profileImageUrl: row.profileImageUrl,
    status: row.status,
    connectionScope: row.connectionClientId === null ? 'company' : 'client',
    capabilities: row.capabilities,
    scopes: row.scopes,
    connectedAt: row.connectedAt.toISOString(),
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastError: row.lastError,
  };
}
async function postDto(tx: Tx, ctx: RequestContext, row: PostRow): Promise<SocialPost> {
  const { media, destinations, approvals } = await findPostParts(
    tx,
    ctx.organizationId,
    row.clientId,
    row.id,
  );
  return {
    id: row.id,
    clientId: row.clientId,
    caption: row.caption,
    title: row.title,
    link: row.link,
    status: row.status,
    timezone: row.timezone,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    approvalRequired: row.approvalRequired,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    media: media.map(mediaDto),
    sharedMediaIds: row.sharedMediaIds,
    destinations: destinations.map((d) => ({
      id: d.id,
      accountId: d.accountId,
      accountName: d.accountName,
      platform: d.platform,
      status: d.status,
      caption: d.caption,
      title: d.title,
      link: d.link,
      mediaIds: d.mediaIds,
      postType: d.postType,
      privacyStatus: d.privacyStatus,
      platformPostId: d.platformPostId,
      platformPostUrl: d.platformPostUrl,
      attempts: d.attempts,
      error: d.error,
      publishedAt: d.publishedAt?.toISOString() ?? null,
      nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
    })),
    approvals: approvals.map((a) => ({
      id: a.id,
      decision: a.decision,
      comment: a.comment,
      actorId: a.actorId,
      actorName: a.actorName,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}
export async function getSettings(
  ctx: RequestContext,
  clientId: string,
): Promise<SocialSettings> {
  return db.transaction(ctx, (tx) => findSettings(tx, ctx.organizationId, clientId));
}
export async function updateSettings(
  ctx: RequestContext,
  clientId: string,
  input: Pick<SocialSettings, 'timezone' | 'approvalRequired' | 'clientReviewEnabled'>,
): Promise<SocialSettings> {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: input.timezone });
  } catch {
    throw new SocialValidationError('Choose a valid IANA timezone.');
  }
  await db.transaction(ctx, async (tx) => {
    await ensureClient(tx, ctx.organizationId, clientId);
    await tx.query(
      sql`INSERT INTO social_workspace_settings(organization_id,client_id,timezone,approval_required,client_review_enabled) VALUES (${ctx.organizationId},${clientId},${input.timezone},${input.approvalRequired},${input.clientReviewEnabled}) ON CONFLICT(organization_id,client_id) DO UPDATE SET timezone = EXCLUDED.timezone, approval_required = EXCLUDED.approval_required, client_review_enabled = EXCLUDED.client_review_enabled, updated_at = now()`,
    );
    await writeAudit(tx, ctx, clientId, 'settings.updated', clientId, input);
  });
  return { clientId, ...input };
}
export async function listAccounts(
  ctx: RequestContext,
  clientId: string,
): Promise<SocialAccount[]> {
  return (
    await db.transaction(ctx, async (tx) => {
      await ensureClient(tx, ctx.organizationId, clientId);
      return findAccounts(tx, ctx.organizationId, clientId);
    })
  ).map(accountDto);
}
export async function getAccountConnection(
  ctx: RequestContext,
  clientId: string,
  accountId: string,
): Promise<AccountRow> {
  const row = await db.transaction(
    ctx,
    async (tx) => (await findAccounts(tx, ctx.organizationId, clientId, [accountId]))[0],
  );
  if (!row) throw new SocialNotFoundError('Connected account');
  return row;
}
export async function getAccount(
  ctx: RequestContext,
  clientId: string,
  accountId: string,
): Promise<SocialAccount> {
  return accountDto(await getAccountConnection(ctx, clientId, accountId));
}

/** Only explicitly selected accounts from a successfully validated OAuth grant. */
export async function saveConnectionAccounts(
  ctx: RequestContext,
  clientId: string,
  accounts: readonly DiscoveredAccount[],
): Promise<SocialAccount[]> {
  const encrypted = accounts.map((account) => ({
    account,
    encrypted: encryptCredentials(account.credentials, {
      organizationId: ctx.organizationId,
      clientId,
      platform: account.platform,
    }),
  }));
  await db.transaction(ctx, async (tx) => {
    await ensureClient(tx, ctx.organizationId, clientId);
    for (const { account, encrypted: credentials } of encrypted) {
      // A location the company connection already serves to ANOTHER client stays there.
      const elsewhere = await tx.maybeOne<{ clientName: string }>(
        sql`SELECT COALESCE(NULLIF(c.business_name, ''), c.client_name) AS client_name FROM social_account a JOIN client c ON c.organization_id = a.organization_id AND c.id = a.client_id
          WHERE a.organization_id = ${ctx.organizationId} AND a.platform = ${account.platform} AND a.external_id = ${account.externalId}
            AND a.location_id IS NOT NULL AND a.status <> 'disconnected' AND a.client_id <> ${clientId} LIMIT 1`,
      );
      if (elsewhere)
        throw new SocialConflictError(
          `${account.name} is assigned to ${elsewhere.clientName} through your company connection. Unassign it there first.`,
        );
      // Reuse only this client's own connection. An account that used the company
      // connection moves to the client's sign-in; the company token is never overwritten.
      const existing = await tx.maybeOne<{ connectionId: string }>(
        sql`SELECT a.connection_id FROM social_account a JOIN social_connection c ON c.organization_id = a.organization_id AND c.id = a.connection_id
          WHERE a.organization_id = ${ctx.organizationId} AND a.client_id = ${clientId} AND a.platform = ${account.platform} AND a.external_id = ${account.externalId}
            AND c.client_id = ${clientId}
          FOR UPDATE OF a`,
      );
      let connectionId = existing?.connectionId;
      if (connectionId) {
        await tx.query(
          sql`UPDATE social_connection SET credentials_encrypted = ${credentials}, scopes = ${account.credentials.scopes}, expires_at = ${account.credentials.expiresAt ?? null}::timestamptz, status = 'connected', updated_at = now() WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND id = ${connectionId}`,
        );
      } else {
        const connection = await tx.one<{ id: string }>(
          sql`INSERT INTO social_connection(organization_id,client_id,platform,credentials_encrypted,scopes,expires_at,created_by) VALUES (${ctx.organizationId},${clientId},${account.platform},${credentials},${account.credentials.scopes},${account.credentials.expiresAt ?? null}::timestamptz,${ctx.principal.id}) RETURNING id`,
        );
        connectionId = connection.id;
      }
      const capabilities = Object.entries(account.capabilities)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);
      const saved = await tx.one<{
        id: string;
      }>(sql`INSERT INTO social_account(organization_id,client_id,connection_id,platform,external_id,name,profile_image_url,capabilities,metadata)
        VALUES (${ctx.organizationId},${clientId},${connectionId},${account.platform},${account.externalId},${account.name},${account.profileImageUrl ?? null},${capabilities},${JSON.stringify(account.metadata ?? {})}::jsonb)
        ON CONFLICT(organization_id,client_id,platform,external_id) DO UPDATE SET connection_id = EXCLUDED.connection_id,location_id = NULL,name = EXCLUDED.name,profile_image_url = EXCLUDED.profile_image_url,capabilities = EXCLUDED.capabilities,metadata = EXCLUDED.metadata,status = 'connected',connected_at = now(),last_error = NULL RETURNING id`);
      await writeAudit(
        tx,
        ctx,
        clientId,
        existing ? 'account.reconnected' : 'account.connected',
        saved.id,
        { platform: account.platform },
      );
    }
  });
  return listAccounts(ctx, clientId);
}
/** Stops an account serving this client. A client connection's own token is removed with it;
 * a company connection keeps serving the company's other clients. */
export async function disconnectAccount(
  ctx: RequestContext,
  clientId: string,
  accountId: string,
): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    const row = (await findAccounts(tx, ctx.organizationId, clientId, [accountId]))[0];
    if (!row) throw new SocialNotFoundError('Connected account');
    const company = row.connectionClientId === null;
    // Connection before account: the lock order every writer of both uses.
    if (!company)
      await tx.query(
        sql`UPDATE social_connection SET status = 'disconnected', credentials_encrypted = NULL, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND id = ${row.connectionId}`,
      );
    await tx.query(
      sql`UPDATE social_account SET status = 'disconnected', last_error = NULL WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND id = ${accountId}`,
    );
    await cancelScheduledForAccount(
      tx,
      ctx.organizationId,
      clientId,
      accountId,
      company
        ? 'Location unassigned from this client before publishing.'
        : 'Account disconnected before publishing.',
    );
    await writeAudit(
      tx,
      ctx,
      clientId,
      company ? 'account.unassigned' : 'account.disconnected',
      accountId,
    );
  });
}
export async function getPost(
  ctx: RequestContext,
  clientId: string,
  postId: string,
): Promise<SocialPost> {
  return db.transaction(ctx, async (tx) =>
    postDto(tx, ctx, await findPost(tx, ctx.organizationId, clientId, postId)),
  );
}
export async function listPosts(
  ctx: RequestContext,
  clientId: string,
  query: SocialPostQuery = {},
): Promise<SocialPostList> {
  await db.transaction(ctx, (tx) => ensureClient(tx, ctx.organizationId, clientId));
  const range = await normalizeRange(ctx, clientId, query);
  const { rows, ...page } = await queryPosts(ctx, clientId, { ...query, ...range });
  const items = await db.transaction(ctx, async (tx) => {
    const items: SocialPost[] = [];
    for (const row of rows) items.push(await postDto(tx, ctx, row));
    return items;
  });
  return {
    items,
    ...page,
    totalPages: Math.max(1, Math.ceil(page.total / page.pageSize)),
  };
}

interface EffectiveDestination {
  account: AccountRow;
  caption: string;
  title: string | null;
  link: string | null;
  mediaIds: string[];
  postType: SocialPostType;
  /** YouTube only. */
  privacyStatus: SocialPrivacyStatus | null;
}
async function validateSelections(
  tx: Tx,
  ctx: RequestContext,
  clientId: string,
  input: SocialPostInput,
  strict: boolean,
): Promise<EffectiveDestination[]> {
  const accounts = await findAccounts(tx, ctx.organizationId, clientId, input.accountIds);
  if (accounts.length !== input.accountIds.length)
    throw new SocialValidationError(
      'One or more selected accounts do not belong to this client.',
    );
  if (strict && accounts.length === 0)
    throw new SocialValidationError('Select at least one connected account.');
  if (Object.keys(input.overrides ?? {}).some((id) => !input.accountIds.includes(id)))
    throw new SocialValidationError(
      'Platform overrides must refer to selected accounts.',
    );
  const allIds = [
    ...new Set([
      ...input.mediaIds,
      ...Object.values(input.overrides ?? {}).flatMap(
        (override) => override.mediaIds ?? [],
      ),
    ]),
  ];
  const media = await findMedia(tx, ctx.organizationId, clientId, allIds);
  if (media.length !== allIds.length)
    throw new SocialValidationError(
      'One or more media files do not belong to this client.',
    );
  const effective: EffectiveDestination[] = accounts.map((account) => {
    const override = input.overrides?.[account.id];
    const postType = override?.postType ?? 'feed';
    if (postType === 'story' && account.platform !== 'instagram')
      throw new SocialValidationError(
        'Stories are supported for Instagram destinations only.',
      );
    if (postType === 'reel' && !['facebook', 'instagram'].includes(account.platform))
      throw new SocialValidationError(
        'Reels are supported for Facebook and Instagram destinations only.',
      );
    return {
      account,
      caption: override?.caption ?? input.caption,
      title: override?.title ?? input.title ?? null,
      link: override?.link !== undefined ? override.link || null : input.link || null,
      mediaIds: override?.mediaIds ?? input.mediaIds,
      postType,
      privacyStatus:
        account.platform === 'youtube' ? (override?.privacyStatus ?? null) : null,
    };
  });
  if (strict)
    for (const item of effective) {
      if (item.account.status !== 'connected' || !item.account.credentialsEncrypted)
        throw new SocialValidationError(
          `Reconnect ${item.account.name} before publishing.`,
        );
      const content = validationContent(item, media);
      const errors = getProvider(item.account.platform).validatePost(
        content,
        providerAccount(item.account),
      );
      if (errors.length)
        throw new SocialValidationError(`${item.account.name}: ${errors.join(' ')}`, {
          accountId: item.account.id,
          errors,
        });
    }
  return effective;
}
function validationContent(
  item: Pick<
    EffectiveDestination,
    'caption' | 'title' | 'link' | 'mediaIds' | 'postType' | 'privacyStatus'
  >,
  media: MediaRow[],
): SocialContent {
  return {
    caption: item.caption,
    ...(item.title !== null ? { title: item.title } : {}),
    ...(item.link !== null ? { link: item.link } : {}),
    postType: item.postType,
    ...(item.privacyStatus !== null ? { privacyStatus: item.privacyStatus } : {}),
    media: item.mediaIds.map((id) => {
      const row = media.find((m) => m.id === id);
      if (!row) throw new SocialValidationError('Media is no longer available.');
      return {
        url: mediaDto(row).url,
        mimeType: row.mimeType,
        sizeBytes: Number(row.sizeBytes),
      };
    }),
  };
}
async function replaceContents(
  tx: Tx,
  ctx: RequestContext,
  clientId: string,
  postId: string,
  input: SocialPostInput,
  effective: EffectiveDestination[],
): Promise<void> {
  await tx.query(
    sql`DELETE FROM social_destination_media WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND destination_id IN (SELECT id FROM social_post_destination WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND post_id = ${postId})`,
  );
  await tx.query(
    sql`DELETE FROM social_post_destination WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND post_id = ${postId}`,
  );
  await tx.query(
    sql`DELETE FROM social_post_media WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND post_id = ${postId}`,
  );
  for (const [position, id] of input.mediaIds.entries())
    await tx.query(
      sql`INSERT INTO social_post_media(organization_id,client_id,post_id,media_id,position) VALUES (${ctx.organizationId},${clientId},${postId},${id},${position})`,
    );
  for (const item of effective) {
    const destination = await tx.one<{ id: string }>(
      sql`INSERT INTO social_post_destination(organization_id,client_id,post_id,account_id,caption,title,link,post_type,privacy_status) VALUES (${ctx.organizationId},${clientId},${postId},${item.account.id},${item.caption},${item.title},${item.link},${item.postType},${item.privacyStatus}) RETURNING id`,
    );
    for (const [position, id] of item.mediaIds.entries())
      await tx.query(
        sql`INSERT INTO social_destination_media(organization_id,client_id,destination_id,media_id,position) VALUES (${ctx.organizationId},${clientId},${destination.id},${id},${position})`,
      );
  }
}
export async function createPost(
  ctx: RequestContext,
  clientId: string,
  input: SocialPostInput,
): Promise<SocialPost> {
  const postId = await db.transaction(ctx, async (tx) => {
    const settings = await findSettings(tx, ctx.organizationId, clientId);
    const effective = await validateSelections(
      tx,
      ctx,
      clientId,
      input,
      input.intent !== 'draft',
    );
    if (settings.approvalRequired && ['publish', 'schedule'].includes(input.intent))
      throw new SocialValidationError(
        'This client requires approval. Submit the post for review first.',
      );
    if (input.intent === 'schedule') scheduledInstant(input.scheduledAt);
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO social_post(organization_id,client_id,caption,title,link,timezone,approval_required,created_by) VALUES (${ctx.organizationId},${clientId},${input.caption},${input.title ?? null},${input.link ?? null},${settings.timezone},${settings.approvalRequired},${ctx.principal.id}) RETURNING id`,
    );
    await replaceContents(tx, ctx, clientId, row.id, input, effective);
    await writeAudit(tx, ctx, clientId, 'post.created', row.id);
    return row.id;
  });
  if (input.intent !== 'draft')
    return transitionPost(ctx, clientId, postId, {
      action: input.intent,
      ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
    });
  return getPost(ctx, clientId, postId);
}
export async function updatePost(
  ctx: RequestContext,
  clientId: string,
  postId: string,
  input: SocialPostInput,
): Promise<SocialPost> {
  await db.transaction(ctx, async (tx) => {
    const post = await findPost(tx, ctx.organizationId, clientId, postId, true);
    if (!['draft', 'approved'].includes(post.status))
      throw new SocialConflictError(
        'Only drafts and approved, unpublished posts can be edited. Request changes or cancel the schedule first.',
      );
    const settings = await findSettings(tx, ctx.organizationId, clientId);
    if (settings.approvalRequired && ['publish', 'schedule'].includes(input.intent))
      throw new SocialValidationError(
        'Editing resets approval. Submit the changed post for review.',
      );
    const effective = await validateSelections(
      tx,
      ctx,
      clientId,
      input,
      input.intent !== 'draft',
    );
    if (input.intent === 'schedule') scheduledInstant(input.scheduledAt);
    await tx.query(
      sql`UPDATE social_post SET caption = ${input.caption}, title = ${input.title ?? null}, link = ${input.link ?? null}, status = 'draft', approved_at = NULL, scheduled_at = NULL, publishing_actor_id = NULL, approval_required = ${settings.approvalRequired}, timezone = ${settings.timezone}, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND id = ${postId}`,
    );
    await replaceContents(tx, ctx, clientId, postId, input, effective);
    await writeAudit(tx, ctx, clientId, 'post.updated', postId);
  });
  if (input.intent !== 'draft')
    return transitionPost(ctx, clientId, postId, {
      action: input.intent,
      ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
    });
  return getPost(ctx, clientId, postId);
}
function scheduledInstant(value?: string): Date {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime()) || date.getTime() <= Date.now())
    throw new SocialValidationError('Choose a future schedule time with a UTC offset.');
  return date;
}
function inputFromPost(post: SocialPost): SocialPostInput {
  return {
    caption: post.caption,
    ...(post.title ? { title: post.title } : {}),
    ...(post.link ? { link: post.link } : {}),
    accountIds: post.destinations.map((d) => d.accountId),
    mediaIds: post.sharedMediaIds,
    overrides: Object.fromEntries(
      post.destinations.map((d) => [
        d.accountId,
        {
          caption: d.caption,
          title: d.title ?? '',
          link: d.link ?? '',
          mediaIds: d.mediaIds,
          postType: d.postType,
          ...(d.privacyStatus ? { privacyStatus: d.privacyStatus } : {}),
        },
      ]),
    ),
    intent: 'draft',
  };
}
export async function duplicatePost(
  ctx: RequestContext,
  clientId: string,
  postId: string,
): Promise<SocialPost> {
  return createPost(ctx, clientId, inputFromPost(await getPost(ctx, clientId, postId)));
}

async function approvalAudience(
  ctx: RequestContext,
  clientId: string,
  postId: string,
): Promise<string[]> {
  const candidates = await db.query<{ id: string }>(
    ctx,
    sql`SELECT u.id FROM app_user u WHERE u.organization_id = ${ctx.organizationId} AND u.status = 'active' AND (u.account_type = 'super-admin' OR EXISTS(SELECT 1 FROM client c WHERE c.organization_id = u.organization_id AND c.id = ${clientId} AND c.created_by = u.id) OR EXISTS(SELECT 1 FROM project p JOIN project_assignee pa ON pa.organization_id = p.organization_id AND pa.project_id = p.id WHERE p.organization_id = u.organization_id AND p.client_id = ${clientId} AND pa.user_id = u.id) OR u.client_id = ${clientId})`,
  );
  const recipients: string[] = [];
  for (const candidate of candidates)
    if (
      candidate.id !== ctx.principal.id &&
      (await authorizeSocialActor(ctx, clientId, candidate.id, 'social:approve', postId))
    )
      recipients.push(candidate.id);
  return recipients;
}
export async function transitionPost(
  ctx: RequestContext,
  clientId: string,
  postId: string,
  input: SocialPostActionInput,
): Promise<SocialPost> {
  if (input.action === 'duplicate') return duplicatePost(ctx, clientId, postId);
  const recipients =
    input.action === 'submit' ? await approvalAudience(ctx, clientId, postId) : [];
  await db.transaction(ctx, async (tx) => {
    const post = await findPost(tx, ctx.organizationId, clientId, postId, true);
    const settings = await findSettings(tx, ctx.organizationId, clientId);
    const details = await postDto(tx, ctx, post);
    const destinations = details.destinations;
    if (input.action === 'cancel') {
      if (
        ![
          'scheduled',
          'approved',
          'draft',
          'pending_approval',
          'failed',
          'partially_published',
        ].includes(post.status)
      )
        throw new SocialConflictError('This post can no longer be cancelled.');
      if (destinations.some((d) => d.status === 'publishing'))
        throw new SocialConflictError(
          'A destination is already publishing. Wait for its result.',
        );
      await tx.query(
        sql`UPDATE social_post_destination SET status = 'cancelled', next_attempt_at = NULL WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND post_id = ${postId} AND status IN ('pending','scheduled','failed')`,
      );
      const status = destinations.some((d) => d.status === 'published')
        ? 'partially_published'
        : destinations.some((d) => d.status === 'outcome_unknown')
          ? 'failed'
          : 'cancelled';
      await tx.query(
        sql`UPDATE social_post SET status = ${status}, scheduled_at = NULL, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND id = ${postId}`,
      );
    } else if (input.action === 'submit') {
      if (!['draft', 'approved'].includes(post.status))
        throw new SocialConflictError('Only a draft can be submitted for approval.');
      await validateSelections(tx, ctx, clientId, inputFromPost(details), true);
      await tx.query(
        sql`UPDATE social_post SET status = 'pending_approval', approved_at = NULL, approval_required = true, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND id = ${postId}`,
      );
      await tx.query(
        sql`INSERT INTO social_approval(organization_id,client_id,post_id,actor_id,decision,comment) VALUES (${ctx.organizationId},${clientId},${postId},${ctx.principal.id},'submitted',${input.comment ?? null})`,
      );
      if (recipients.length)
        await notify(tx, ctx, {
          type: 'social.approval_requested',
          priority: 'operational',
          audience: { users: recipients },
          title: 'Social content is waiting for your approval',
          link: `/company/social?clientId=${clientId}&postId=${postId}`,
          metadata: { clientId, postId },
        });
    } else if (input.action === 'approve' || input.action === 'request_changes') {
      if (post.status !== 'pending_approval')
        throw new SocialConflictError('This post is not waiting for approval.');
      if (input.action === 'request_changes' && !input.comment?.trim())
        throw new SocialValidationError('Explain the changes needed.');
      await tx.query(
        sql`UPDATE social_post SET status = ${input.action === 'approve' ? 'approved' : 'draft'}, approved_at = ${input.action === 'approve' ? new Date() : null}, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND id = ${postId}`,
      );
      await tx.query(
        sql`INSERT INTO social_approval(organization_id,client_id,post_id,actor_id,decision,comment) VALUES (${ctx.organizationId},${clientId},${postId},${ctx.principal.id},${input.action === 'approve' ? 'approved' : 'changes_requested'},${input.comment ?? null})`,
      );
      if (post.createdBy !== ctx.principal.id)
        await notify(tx, ctx, {
          type: 'social.approval_decided',
          priority: 'operational',
          audience: { users: [post.createdBy] },
          title:
            input.action === 'approve'
              ? 'Your social post was approved'
              : 'Changes were requested on your social post',
          link: `/company/social?clientId=${clientId}&postId=${postId}`,
          metadata: { clientId, postId },
        });
    } else {
      if (!['draft', 'approved', 'scheduled'].includes(post.status))
        throw new SocialConflictError(
          'Only an unpublished draft or approved post can be scheduled or published.',
        );
      if ((settings.approvalRequired || post.approvalRequired) && !post.approvedAt)
        throw new SocialValidationError('This post requires approval before publishing.');
      if (
        destinations.some(
          (d) =>
            d.attempts !== 0 ||
            d.status === 'published' ||
            d.status === 'outcome_unknown',
        )
      )
        throw new SocialConflictError(
          'This post has publishing attempts. Duplicate it only after checking existing platform results.',
        );
      await validateSelections(tx, ctx, clientId, inputFromPost(details), true);
      const at =
        input.action === 'schedule' ? scheduledInstant(input.scheduledAt) : new Date();
      await tx.query(
        sql`UPDATE social_post SET status = 'scheduled', scheduled_at = ${at}, publishing_actor_id = ${ctx.principal.id}, approval_required = ${settings.approvalRequired || post.approvalRequired}, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND id = ${postId}`,
      );
      await tx.query(
        sql`UPDATE social_post_destination SET status = 'scheduled', next_attempt_at = ${at}, last_error = NULL WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND post_id = ${postId} AND status IN ('pending','scheduled')`,
      );
    }
    await writeAudit(tx, ctx, clientId, `post.${input.action}`, postId, {
      ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
    });
  });
  return getPost(ctx, clientId, postId);
}

interface SnapshotRow {
  id: string;
  accountId: string;
  accountName: string;
  platform: SocialPlatform;
  source: string;
  periodStart: Date;
  periodEnd: Date;
  syncedAt: Date;
  metrics: SocialAnalyticsMetric[];
  postId: string | null;
  caption: string | null;
  note: string | null;
  series: { date: string; metric: string; value: number }[];
}
export async function getAnalytics(
  ctx: RequestContext,
  clientId: string,
  range: { from?: string | undefined; to?: string | undefined } = {},
): Promise<SocialAnalytics> {
  range = await normalizeRange(ctx, clientId, range);
  const accounts = await listAccounts(ctx, clientId);
  const rows = await db.query<SnapshotRow>(
    ctx,
    sql`SELECT s.*,a.name AS account_name,a.platform,p.caption FROM social_analytics_snapshot s JOIN social_account a ON a.organization_id = s.organization_id AND a.client_id = s.client_id AND a.id = s.account_id LEFT JOIN social_post p ON p.organization_id = s.organization_id AND p.client_id = s.client_id AND p.id = s.post_id WHERE s.organization_id = ${ctx.organizationId} AND s.client_id = ${clientId} AND (${range.from ?? null}::timestamptz IS NULL OR s.period_start >= ${range.from ?? null}::timestamptz) AND (${range.to ?? null}::timestamptz IS NULL OR s.period_end <= ${range.to ?? null}::timestamptz) ORDER BY s.synced_at DESC LIMIT 500`,
  );
  const snapshots: SocialAnalyticsSnapshot[] = rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    accountName: r.accountName,
    platform: r.platform,
    source: r.source,
    periodStart: r.periodStart.toISOString(),
    periodEnd: r.periodEnd.toISOString(),
    syncedAt: r.syncedAt.toISOString(),
    metrics: r.metrics,
    postId: r.postId,
    caption: r.caption,
    note: r.note,
    series: r.series,
  }));
  return {
    snapshots,
    aggregates: platformAggregates(snapshots),
    unavailable: accounts
      .filter((a) => !snapshots.some((s) => s.accountId === a.id && s.postId === null))
      .map((a) => ({
        accountId: a.id,
        platform: a.platform,
        reason:
          a.status !== 'connected'
            ? 'Reconnect this account to synchronize insights.'
            : !a.capabilities.includes('accountInsights')
              ? 'Account analytics are unavailable for this API capability or require additional approval.'
              : (a.lastError ??
                'No platform data has been synchronized for this period yet.'),
      })),
  };
}

/** Platform-local aggregates. Each platform owns its metric definitions, so no
 * cross-platform totals are derived — the UI shows one block per platform. */
function platformAggregates(
  snapshots: readonly SocialAnalyticsSnapshot[],
): SocialAnalyticsPlatformAggregate[] {
  const byPlatform = new Map<SocialPlatform, SocialAnalyticsSnapshot[]>();
  for (const snapshot of snapshots) {
    const list = byPlatform.get(snapshot.platform) ?? [];
    list.push(snapshot);
    byPlatform.set(snapshot.platform, list);
  }
  const aggregates: SocialAnalyticsPlatformAggregate[] = [];
  for (const [platform, list] of byPlatform) {
    const accountIds = new Set(list.map((s) => s.accountId));
    // Latest account-level snapshot per account (snapshots are already pre-sorted
    // by synced_at DESC in getAnalytics), then sum its metrics across accounts.
    const latestPerAccount = new Map<string, SocialAnalyticsSnapshot>();
    for (const snapshot of list) {
      if (snapshot.postId !== null) continue;
      if (!latestPerAccount.has(snapshot.accountId))
        latestPerAccount.set(snapshot.accountId, snapshot);
    }
    const latestAccountMetrics = new Map<
      string,
      { key: string; label: string; value: number; asOf: string }
    >();
    for (const snapshot of latestPerAccount.values()) {
      for (const metric of snapshot.metrics) {
        const existing = latestAccountMetrics.get(metric.key);
        latestAccountMetrics.set(metric.key, {
          key: metric.key,
          label: metric.label,
          value: (existing?.value ?? 0) + metric.value,
          asOf:
            existing && existing.asOf > snapshot.syncedAt
              ? existing.asOf
              : snapshot.syncedAt,
        });
      }
    }
    // Post-level sums across every post snapshot in the range.
    const postMetrics = new Map<
      string,
      { key: string; label: string; value: number; postCount: number }
    >();
    const postIdsByMetric = new Map<string, Set<string>>();
    for (const snapshot of list) {
      if (snapshot.postId === null) continue;
      for (const metric of snapshot.metrics) {
        const existing = postMetrics.get(metric.key);
        const seen = postIdsByMetric.get(metric.key) ?? new Set<string>();
        seen.add(snapshot.postId);
        postIdsByMetric.set(metric.key, seen);
        postMetrics.set(metric.key, {
          key: metric.key,
          label: metric.label,
          value: (existing?.value ?? 0) + metric.value,
          postCount: seen.size,
        });
      }
    }
    aggregates.push({
      platform,
      accountCount: accountIds.size,
      latestAccountMetrics: [...latestAccountMetrics.values()].sort((a, b) =>
        a.key.localeCompare(b.key),
      ),
      postMetricTotals: [...postMetrics.values()].sort((a, b) =>
        a.key.localeCompare(b.key),
      ),
      note: 'Totals are summed within this platform only. Metric definitions differ across platforms, so cross-platform sums are not computed.',
    });
  }
  return aggregates.sort((a, b) => a.platform.localeCompare(b.platform));
}

/** Flat metric-row export. One row per metric observation, ready for spreadsheet work. */
export async function exportAnalyticsCsv(
  ctx: RequestContext,
  clientId: string,
  range: { from?: string | undefined; to?: string | undefined } = {},
): Promise<string> {
  const { snapshots } = await getAnalytics(ctx, clientId, range);
  const header = [
    'synced_at',
    'platform',
    'account_name',
    'source',
    'period_start',
    'period_end',
    'metric_key',
    'metric_label',
    'metric_value',
    'post_id',
    'caption',
  ];
  const rows: string[][] = [header];
  for (const snapshot of snapshots) {
    for (const metric of snapshot.metrics) {
      rows.push([
        snapshot.syncedAt,
        snapshot.platform,
        snapshot.accountName,
        snapshot.source,
        snapshot.periodStart,
        snapshot.periodEnd,
        metric.key,
        metric.label,
        String(metric.value),
        snapshot.postId ?? '',
        snapshot.caption ?? '',
      ]);
    }
  }
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n');
}

/** RFC 4180 field escaping. Prefix guards against formulas being evaluated by spreadsheet software. */
function csvField(value: string): string {
  const injectionPrefix = /^[=+\-@\t\r]/.test(value) ? "'" : '';
  const normalized = `${injectionPrefix}${value}`;
  if (/["\n\r,]/.test(normalized)) return `"${normalized.replace(/"/g, '""')}"`;
  return normalized;
}

/** Which owner a connection's token is encrypted for. */
export function connectionCredentialContext(
  organizationId: string,
  connection: Pick<ConnectionRow, 'id' | 'clientId' | 'platform'>,
): CredentialContext {
  return connection.clientId === null
    ? { organizationId, connectionId: connection.id, platform: connection.platform }
    : { organizationId, clientId: connection.clientId, platform: connection.platform };
}

/** A usable token for a connection, refreshed when it is about to expire.
 * The refresh call happens outside SQL; a per-connection lease prevents two
 * workers from rotating a refresh token concurrently. The stored row is read
 * fresh, because a company connection is shared: another location may have
 * refreshed it moments ago. */
export async function credentialsForConnection(
  ctx: RequestContext,
  connection: Pick<ConnectionRow, 'id' | 'clientId' | 'platform'>,
  displayName: string,
): Promise<OAuthCredential> {
  const current = await db.maybeOne<{ credentialsEncrypted: string | null }>(
    ctx,
    sql`SELECT credentials_encrypted FROM social_connection WHERE organization_id = ${ctx.organizationId} AND id = ${connection.id}`,
  );
  if (!current?.credentialsEncrypted)
    throw new ProviderError('RECONNECT_REQUIRED', `Reconnect ${displayName}.`, {
      reconnectRequired: true,
    });
  const context = connectionCredentialContext(ctx.organizationId, connection);
  const credentials = decryptCredentials<OAuthCredential>(
    current.credentialsEncrypted,
    context,
  );
  if (
    !credentials.expiresAt ||
    new Date(credentials.expiresAt).getTime() > Date.now() + 120_000
  )
    return credentials;
  const lease = await db.maybeOne<{ id: string }>(
    ctx,
    sql`UPDATE social_connection SET refresh_lease_until = now() + interval '2 minutes' WHERE organization_id = ${ctx.organizationId} AND id = ${connection.id} AND (refresh_lease_until IS NULL OR refresh_lease_until < now()) AND credentials_encrypted = ${current.credentialsEncrypted} RETURNING id`,
  );
  if (!lease)
    throw new ProviderError(
      'REFRESH_IN_PROGRESS',
      'Credential refresh is in progress; publishing will retry.',
      { transient: true, retryAfter: 120 },
    );
  try {
    const refreshed = await getProvider(connection.platform).refreshCredentials(
      credentials,
    );
    const encrypted = encryptCredentials(refreshed, context);
    await db.query(
      ctx,
      sql`UPDATE social_connection SET credentials_encrypted = ${encrypted}, scopes = ${refreshed.scopes}, expires_at = ${refreshed.expiresAt ?? null}::timestamptz, refresh_lease_until = NULL, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND id = ${connection.id} AND status = 'connected' AND credentials_encrypted = ${current.credentialsEncrypted}`,
    );
    return refreshed;
  } catch (error) {
    await db.query(
      ctx,
      sql`UPDATE social_connection SET refresh_lease_until = NULL WHERE organization_id = ${ctx.organizationId} AND id = ${connection.id} AND credentials_encrypted = ${current.credentialsEncrypted}`,
    );
    throw error;
  }
}
export async function credentialsForAccount(
  ctx: RequestContext,
  row: AccountRow,
): Promise<OAuthCredential> {
  if (!row.credentialsEncrypted || row.status !== 'connected')
    throw new ProviderError('RECONNECT_REQUIRED', `Reconnect ${row.name}.`, {
      reconnectRequired: true,
    });
  return credentialsForConnection(
    ctx,
    {
      id: row.connectionId,
      clientId: row.connectionClientId,
      platform: row.connectionPlatform,
    },
    row.name,
  );
}

/** What admins are told when a company sign-in stops working. */
const COMPANY_RECONNECT_NOTICE: Record<string, { title: string; body: string }> = {
  google_business: {
    title: 'Reconnect your company Google Business Profile',
    body: 'Google stopped accepting the company sign-in. Posts to its locations will fail until someone reconnects it.',
  },
  facebook: {
    title: 'Reconnect your company Facebook login',
    body: 'Facebook stopped accepting the company login. Posts to its Pages and Instagram accounts will fail until someone reconnects it.',
  },
  linkedin: {
    title: 'Reconnect your company LinkedIn login',
    body: 'LinkedIn stopped accepting the company login. Posts to its pages will fail until someone reconnects it.',
  },
  youtube: {
    title: 'Reconnect your company YouTube channel',
    body: 'Google stopped accepting the sign-in for this channel. Uploads to it will fail until someone reconnects it.',
  },
};

/** The platform stopped accepting a connection's token. Every account it serves
 * needs the reconnect, so they all say so. Company admins hear about it once:
 * on the change, not on every failed attempt after it. */
export async function markConnectionReconnectRequired(
  tx: Tx,
  ctx: RequestContext,
  connection: Pick<ConnectionRow, 'id' | 'clientId' | 'platform'>,
  message: string,
): Promise<void> {
  const reason = message.slice(0, 1000);
  const changed = await tx.maybeOne<{ id: string }>(
    sql`UPDATE social_connection SET status = 'reconnect_required', last_error = ${reason}, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND id = ${connection.id} AND status = 'connected' RETURNING id`,
  );
  await tx.query(
    sql`UPDATE social_account SET status = 'reconnect_required', last_error = ${reason} WHERE organization_id = ${ctx.organizationId} AND connection_id = ${connection.id} AND status = 'connected'`,
  );
  const notice = COMPANY_RECONNECT_NOTICE[connection.platform];
  if (changed && connection.clientId === null && notice)
    await notify(tx, ctx, {
      type: NOTIFICATION_TYPES.SOCIAL_CONNECTION_RECONNECT_REQUIRED,
      priority: 'operational',
      audience: { holders: { action: 'system:manage-integrations' } },
      title: notice.title,
      body: notice.body,
      link: '/company/social/connections',
      metadata: { connectionId: connection.id },
    });
}
export async function markAccountError(
  ctx: RequestContext,
  row: AccountRow,
  message: string,
  reconnect: boolean,
): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    // Connection before account: the lock order every writer of both uses.
    if (reconnect)
      await markConnectionReconnectRequired(
        tx,
        ctx,
        {
          id: row.connectionId,
          clientId: row.connectionClientId,
          platform: row.connectionPlatform,
        },
        message,
      );
    await tx.query(
      sql`UPDATE social_account SET last_error = ${message.slice(0, 1000)} WHERE organization_id = ${ctx.organizationId} AND client_id = ${row.clientId} AND id = ${row.id}`,
    );
  });
}
export async function syncAnalytics(
  ctx: RequestContext,
  clientId: string,
  range?: { from: string; to: string },
): Promise<number> {
  const normalized = range ? await normalizeRange(ctx, clientId, range) : undefined;
  const until =
    normalized?.to ??
    new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000).toISOString();
  const since =
    normalized?.from ??
    new Date(new Date(until).getTime() - 30 * 86_400_000).toISOString();
  const accounts = await db.transaction(ctx, (tx) =>
    findAccounts(tx, ctx.organizationId, clientId),
  );
  let synchronized = 0;
  for (const row of accounts.filter(
    (a) => a.status === 'connected' && a.capabilities.includes('accountInsights'),
  )) {
    try {
      const credentials = await credentialsForAccount(ctx, row);
      const data = await getProvider(row.platform).getAccountInsights({
        account: providerAccount(row),
        credentials,
        since,
        until,
      });
      const metrics: SocialAnalyticsMetric[] = Object.entries(data.metrics)
        .filter(([, value]) => Number.isFinite(value))
        .map(([key, value]) => ({ key, label: key.replaceAll('_', ' '), value }));
      await db.transaction(ctx, async (tx) => {
        await tx.query(
          sql`INSERT INTO social_analytics_snapshot(organization_id,client_id,account_id,source,period_start,period_end,metrics,note,series) VALUES (${ctx.organizationId},${clientId},${row.id},${data.source},${data.since}::timestamptz,${data.until}::timestamptz,${JSON.stringify(metrics)}::jsonb,${data.note ?? null},${JSON.stringify(data.series ?? [])}::jsonb) ON CONFLICT(account_id,source,period_start,period_end) DO UPDATE SET metrics = EXCLUDED.metrics, note = EXCLUDED.note, series = EXCLUDED.series, synced_at = now()`,
        );
        await tx.query(
          sql`UPDATE social_account SET last_synced_at = now(), last_error = NULL WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND id = ${row.id}`,
        );
      });
      synchronized += 1;
    } catch (error) {
      await markAccountError(
        ctx,
        row,
        error instanceof Error ? error.message : 'Insights synchronization failed.',
        error instanceof ProviderError && error.reconnectRequired,
      );
    }
  }
  const published = await db.query<{
    postId: string;
    accountId: string;
    platformPostId: string;
  }>(
    ctx,
    sql`
    SELECT d.post_id,d.account_id,d.platform_post_id FROM social_post_destination d
    WHERE d.organization_id = ${ctx.organizationId} AND d.client_id = ${clientId} AND d.status = 'published'
    ORDER BY d.published_at DESC LIMIT 100
  `,
  );
  for (const destination of published) {
    const row = accounts.find(
      (account) =>
        account.id === destination.accountId &&
        account.status === 'connected' &&
        account.capabilities.includes('postInsights'),
    );
    if (!row) continue;
    try {
      const credentials = await credentialsForAccount(ctx, row);
      const data = await getProvider(row.platform).getPostInsights({
        account: providerAccount(row),
        credentials,
        since,
        until,
        externalPostId: destination.platformPostId,
      });
      const metrics = Object.entries(data.metrics)
        .filter(([, value]) => Number.isFinite(value))
        .map(([key, value]) => ({ key, label: key.replaceAll('_', ' '), value }));
      await db.query(
        ctx,
        sql`INSERT INTO social_analytics_snapshot(organization_id,client_id,account_id,post_id,source,period_start,period_end,metrics,note,series)
        VALUES (${ctx.organizationId},${clientId},${row.id},${destination.postId},${`${data.source}:post:${destination.postId}`},${data.since}::timestamptz,${data.until}::timestamptz,${JSON.stringify(metrics)}::jsonb,${data.note ?? null},${JSON.stringify(data.series ?? [])}::jsonb)
        ON CONFLICT(account_id,source,period_start,period_end) DO UPDATE SET metrics = EXCLUDED.metrics,note = EXCLUDED.note,series = EXCLUDED.series,synced_at = now()`,
      );
      synchronized += 1;
    } catch (error) {
      if (error instanceof ProviderError && error.reconnectRequired)
        await markAccountError(ctx, row, error.message, true);
    }
  }
  return synchronized;
}

/** Date filters use the selected client's timezone, including DST day lengths. */
async function normalizeRange(
  ctx: RequestContext,
  clientId: string,
  range: { from?: string | undefined; to?: string | undefined },
) {
  const settings = await getSettings(ctx, clientId);
  function instant(value: string | undefined, end: boolean) {
    if (!value) return undefined;
    try {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const date = toDateOnly(value);
        const at = instantAt(
          end ? addDays(date, 1) : date,
          toLocalTime('00:00'),
          settings.timezone,
        );
        return new Date(at.getTime() - (end ? 1 : 0)).toISOString();
      }
      const at = new Date(value);
      if (!Number.isFinite(at.getTime())) throw new Error('invalid time');
      return at.toISOString();
    } catch {
      throw new SocialValidationError('Choose valid filter dates.');
    }
  }
  const from = instant(range.from, false);
  const to = instant(range.to, true);
  if (from && to && from > to)
    throw new SocialValidationError('The end date must be after the start date.');
  return { from, to };
}
