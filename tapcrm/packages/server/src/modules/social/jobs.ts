import { sql } from '../../platform/dal/sql.js';
import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { defineJob } from '../../platform/jobs/runner.js';
import { getStorageService } from '../../platform/storage/storage.service.js';
import { SocialValidationError } from './errors.js';
import { mediaDto } from './media.js';
import { activeCompanyConnectionIds, syncCompanyConnection } from './company.js';
import { authorizePublishingActor } from './policy.js';
import { getProvider } from './providers/index.js';
import { ProviderError, type SocialContent } from './providers/types.js';
import {
  analyticsClients,
  claimDestination,
  dueDestinations,
  expireLeases,
  findMedia,
  recordDestinationOutcome,
  rejectScheduledDestination,
  type PublishOutcome,
} from './repository.js';
import {
  credentialsForAccount,
  getAccountConnection,
  getPost,
  getSettings,
  markAccountError,
  syncAnalytics,
} from './service.js';
import { providerAccount, type AccountRow, type DestinationRow } from './types.js';

/** Only explicit retryable rejections are retried after a create request. A
 * timeout, a worker crash, or a remote 5xx could already have created a post. */
export function publishFailure(
  error: unknown,
  attempt: number,
  now: Date,
  requestStarted: boolean,
): PublishOutcome {
  const provider = error instanceof ProviderError ? error : null;
  const ambiguous = provider ? provider.ambiguous : requestStarted;
  const safeMessage =
    provider?.message ??
    (ambiguous
      ? 'The publishing result could not be confirmed. Check the account for an existing post before creating another.'
      : 'Publishing could not start. Check storage and connection settings, then try again.');
  if (ambiguous)
    return {
      status: 'outcome_unknown',
      errorCode: provider?.code ?? 'PUBLISH_OUTCOME_UNKNOWN',
      error: safeMessage,
    };
  const transient = provider?.transient ?? !requestStarted;
  if (transient && attempt < 5) {
    const backoff = Math.min(3600, 30 * 2 ** (attempt - 1));
    const seconds = Math.max(backoff, Math.min(86_400, provider?.retryAfter ?? 0));
    return {
      status: 'scheduled',
      errorCode: provider?.code ?? 'PREFLIGHT_UNAVAILABLE',
      error: safeMessage,
      nextAttemptAt: new Date(now.getTime() + seconds * 1000),
    };
  }
  return {
    status: 'failed',
    errorCode: provider?.code ?? 'PUBLISH_FAILED',
    error: safeMessage,
  };
}
async function contentForDestination(
  ctx: RequestContext,
  row: DestinationRow,
): Promise<SocialContent> {
  const media = await db.transaction(ctx, (tx) =>
    findMedia(tx, ctx.organizationId, row.clientId, row.mediaIds),
  );
  if (media.length !== row.mediaIds.length)
    throw new SocialValidationError('The selected media is no longer available.');
  const items = [];
  for (const id of row.mediaIds) {
    const item = media.find((m) => m.id === id);
    if (!item)
      throw new SocialValidationError('The selected media is no longer available.');
    const body = await getStorageService().getObject({
      bucket: 'files',
      key: item.objectKey,
    });
    if (body.checksumSha256 !== item.checksumSha256)
      throw new SocialValidationError(
        'Stored media integrity check failed. Upload the file again.',
      );
    items.push({
      url: mediaDto(item).url,
      mimeType: item.mimeType,
      sizeBytes: Number(item.sizeBytes),
      bytes: body.body,
    });
  }
  return {
    caption: row.caption,
    ...(row.title ? { title: row.title } : {}),
    ...(row.link ? { link: row.link } : {}),
    postType: row.postType,
    ...(row.privacyStatus ? { privacyStatus: row.privacyStatus } : {}),
    media: items,
  };
}
export async function runPublishingSweep(
  ctx: RequestContext,
  now = new Date(),
): Promise<{ processed: number; interrupted: number }> {
  const interrupted = await expireLeases(ctx, now);
  const due = await dueDestinations(ctx, now);
  let processed = 0;
  for (const item of due) {
    if (
      !item.publishingActorId ||
      !(await authorizePublishingActor(ctx, item.clientId, item.publishingActorId))
    ) {
      await rejectScheduledDestination(
        ctx,
        item,
        'The publishing user no longer has access to this client. Ask an authorized manager to review this post.',
      );
      continue;
    }
    const [settings, post] = await Promise.all([
      getSettings(ctx, item.clientId),
      getPost(ctx, item.clientId, item.postId),
    ]);
    if ((settings.approvalRequired || post.approvalRequired) && !post.approvedAt) {
      await rejectScheduledDestination(
        ctx,
        item,
        'This client now requires content approval. Submit a new draft for approval.',
      );
      continue;
    }
    const claimed = await claimDestination(ctx, item, randomUUID(), now);
    if (!claimed) continue;
    let account: AccountRow | undefined;
    let requestStarted = false;
    let outcome: PublishOutcome;
    try {
      account = await getAccountConnection(ctx, item.clientId, claimed.accountId);
      const credentials = await credentialsForAccount(ctx, account);
      const content = await contentForDestination(ctx, claimed);
      const provider = getProvider(account.platform);
      const errors = provider.validatePost(content, providerAccount(account));
      if (errors.length) throw new ProviderError('POST_INVALID', errors.join(' '));
      requestStarted = true;
      const result = await provider.publishPost({
        account: providerAccount(account),
        credentials,
        content,
        idempotencyKey: claimed.idempotencyKey,
      });
      if (!result.externalPostId)
        throw new ProviderError(
          'PUBLISH_OUTCOME_UNKNOWN',
          'No platform post ID was returned. Check the platform before creating another post.',
          { ambiguous: true },
        );
      outcome = {
        status: 'published',
        externalPostId: result.externalPostId,
        ...(result.url ? { url: result.url } : {}),
      };
    } catch (error) {
      outcome = publishFailure(error, claimed.attempts, new Date(), requestStarted);
      if (account && error instanceof ProviderError && error.reconnectRequired)
        await markAccountError(ctx, account, error.message, true);
    }
    // SQL errors after remote success propagate. The claim remains held, and
    // crash recovery marks uncertainty instead of repeating the remote create.
    await recordDestinationOutcome(ctx, claimed, outcome);
    processed += 1;
  }
  return { processed, interrupted };
}
export function registerSocialJobs(): void {
  defineJob({
    name: 'social.oauth-cleanup',
    perOrganization: true,
    schedule: { every: 15 * 60_000 },
    handler: async ({ ctx }) => {
      const expired = await db.query(
        ctx,
        sql`DELETE FROM social_oauth_state WHERE organization_id=${ctx.organizationId} AND expires_at < now() RETURNING state_hash`,
      );
      return { itemsProcessed: expired.length };
    },
  });

  defineJob({
    name: 'social.publish-sweep',
    perOrganization: true,
    module: 'social',
    schedule: { every: 15_000 },
    attempts: 3,
    backoffMs: 30_000,
    handler: async ({ ctx, clock }) => {
      const result = await runPublishingSweep(ctx, clock.now());
      return {
        itemsProcessed: result.processed,
        details: { interrupted: result.interrupted },
      };
    },
  });
  // New locations appear once a customer adds the company's Google account as a
  // manager of their Business Profile; lost ones are flagged before posts fail.
  defineJob({
    name: 'social.company-locations-sync',
    perOrganization: true,
    module: 'social',
    schedule: { every: 24 * 60 * 60_000 },
    attempts: 2,
    handler: async ({ ctx }) => {
      let count = 0;
      for (const connectionId of await activeCompanyConnectionIds(ctx)) {
        try {
          await syncCompanyConnection(ctx, connectionId, 'scheduled');
          count += 1;
        } catch {
          // Recorded on the connection (and announced when it needs a reconnect);
          // one company account failing must not stop the others.
        }
      }
      return { itemsProcessed: count };
    },
  });
  defineJob({
    name: 'social.analytics-sync',
    perOrganization: true,
    module: 'social',
    schedule: { every: 6 * 60 * 60_000 },
    attempts: 2,
    handler: async ({ ctx }) => {
      let count = 0;
      for (const clientId of await analyticsClients(ctx))
        count += await syncAnalytics(ctx, clientId);
      return { itemsProcessed: count };
    },
  });
}
