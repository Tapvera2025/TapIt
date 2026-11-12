import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { defineJob, type JobHandle } from '../../platform/jobs/runner.js';
import { onOutboxEvent } from '../../platform/outbox/registry.js';
import { LIVE_STATUS_EVENTS } from '../live-status/facade.js';
import { cleanupPendingAttachments } from './attachments.js';
import { refreshLinkPreviews } from './link-preview.js';
import { deliverPresenceChanged } from './presence.js';
import { sendDueScheduledMessages } from './scheduled.js';
import { announcePreviewReady } from './service.js';

const MINUTE_MS = 60_000;

export interface ChatJobs {
  readonly scheduledSend: JobHandle<undefined>;
  readonly attachmentCleanup: JobHandle<undefined>;
  readonly linkPreviewSweep: JobHandle<undefined>;
}

/**
 * Chat's background work. Each is per organization (JB-3) and reaches only
 * organizations with the chat module enabled.
 *
 *   chat.scheduled-send       at the top of every minute — "Send later"
 *                             messages that fell due (one set for 9:25 goes
 *                             at 9:25:00, not up to a minute later)
 *   chat.attachment-cleanup   hourly — uploads nobody sent within a day
 *   chat.link-preview-sweep   every 5 minutes — previews missed by the
 *                             in-process unfurl (e.g. a restart mid-fetch)
 *
 * Plus the live-status → chat presence relay (an outbox handler, after commit).
 */
export function registerChatJobs(): ChatJobs {
  const scheduledSend = defineJob({
    name: 'chat.scheduled-send',
    perOrganization: true,
    module: 'chat',
    schedule: { pattern: '* * * * *' },
    attempts: 1, // the next tick retries anything still due
    handler: async ({ ctx, clock }) => ({ itemsProcessed: await sendDueScheduledMessages(ctx, clock.now()) }),
  });

  const attachmentCleanup = defineJob({
    name: 'chat.attachment-cleanup',
    perOrganization: true,
    module: 'chat',
    schedule: { every: 60 * MINUTE_MS },
    attempts: 1,
    handler: async ({ ctx, clock }) => ({ itemsProcessed: await cleanupPendingAttachments(ctx, clock.now()) }),
  });

  const linkPreviewSweep = defineJob({
    name: 'chat.link-preview-sweep',
    perOrganization: true,
    module: 'chat',
    schedule: { every: 5 * MINUTE_MS },
    attempts: 1,
    handler: async ({ ctx }) => {
      const missing = await db.query<{ url: string }>(ctx, sql`
        SELECT DISTINCT ml.url
          FROM message_link ml
          JOIN message m ON m.organization_id = ml.organization_id AND m.id = ml.message_id AND m.deleted_at IS NULL
         WHERE ml.organization_id = ${ctx.organizationId}
           AND ml.position < 3
           AND m.created_at > now() - interval '1 day'
           AND NOT EXISTS (
             SELECT 1 FROM chat_link_preview p WHERE p.organization_id = ml.organization_id AND p.url = ml.url
           )
         LIMIT 20
      `);
      const urls = missing.map((row) => row.url);
      if (urls.length > 0 && (await refreshLinkPreviews(ctx, urls))) await announcePreviewReady(ctx.organizationId, urls);
      return { itemsProcessed: urls.length };
    },
  });

  // live-status.status-changed → refresh the presence dots of everyone who
  // shares a conversation with that person. A second handler on the same
  // event; live-status's own board handler is unaffected.
  onOutboxEvent(LIVE_STATUS_EVENTS.STATUS_CHANGED, deliverPresenceChanged);

  return { scheduledSend, attachmentCleanup, linkPreviewSweep };
}
