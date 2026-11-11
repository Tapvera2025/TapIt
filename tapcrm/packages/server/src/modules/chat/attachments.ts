import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { loadConfig } from '../../config.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { ChatNotFoundError, ChatNotSenderError, ChatValidationError } from './errors.js';
import { currentChatStorageDriver, deleteChatObject, putChatObject, type ChatStorageDriver } from './file-storage.js';
import { detectFileType, sanitizeFileName, UnsupportedFileError, type AttachmentKind } from './file-types.js';
import { signChatFileUrl } from './file-urls.js';
import type { MessageAttachment } from './types.js';

/** At most this many files on one message (WhatsApp/Slack allow about this many per send). */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
/** Pending uploads nobody sent are removed after this long. */
export const PENDING_ATTACHMENT_TTL_HOURS = 24;

const MAX_IMAGE_PIXELS = 40_000_000;
const THUMBNAIL_EDGE = 640;

export function maxAttachmentBytes(): number {
  return loadConfig().CHAT_ATTACHMENT_MAX_MB * 1024 * 1024;
}

export interface AttachmentRow {
  id: string;
  organizationId: string;
  conversationId: string;
  messageId: string | null;
  scheduledMessageId: string | null;
  uploadedBy: string;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: string | number;
  checksumSha256: string;
  storageDriver: ChatStorageDriver;
  objectKey: string;
  thumbnailKey: string | null;
  width: number | null;
  height: number | null;
  pageCount: number | null;
  position: number;
  createdAt: Date;
}

export const ATTACHMENT_COLUMNS = sql.raw(`
  ma.id, ma.organization_id, ma.conversation_id, ma.message_id, ma.scheduled_message_id, ma.uploaded_by,
  ma.kind, ma.file_name, ma.mime_type, ma.size_bytes, ma.checksum_sha256, ma.storage_driver,
  ma.object_key, ma.thumbnail_key, ma.width, ma.height, ma.page_count, ma.position, ma.created_at
`);

/** The DTO the thread renders. Links are signed per organization and expire within two hours. */
export function attachmentDto(row: AttachmentRow): MessageAttachment {
  const sign = (variant: 'view' | 'thumb' | 'download') =>
    signChatFileUrl(row.organizationId, { type: 'a', attachmentId: row.id, variant });
  return {
    id: row.id,
    kind: row.kind,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: Number(row.sizeBytes),
    width: row.width,
    height: row.height,
    pageCount: row.pageCount,
    url: sign('view'),
    downloadUrl: sign('download'),
    thumbnailUrl: row.thumbnailKey ? sign('thumb') : null,
  };
}

/* ------------------------------------------------------------------ *
 * Upload
 * ------------------------------------------------------------------ */

interface PreparedFile {
  body: Buffer;
  thumbnail: Buffer | null;
  width: number | null;
  height: number | null;
  pageCount: number | null;
}

/**
 * Images are decoded by sharp before anything is stored: a file that only
 * LOOKS like an image is refused here. JPEG photos are re-encoded upright
 * with their EXIF dropped — that is where a phone records the GPS position
 * a photo was taken at. Every image gets a WebP thumbnail for the thread.
 */
async function prepareImage(body: Buffer, mimeType: string): Promise<PreparedFile> {
  try {
    const source = sharp(body, { limitInputPixels: MAX_IMAGE_PIXELS, animated: false, failOn: 'error' });
    const metadata = await source.metadata();
    if (!metadata.width || !metadata.height) throw new Error('no dimensions');
    let stored = body;
    let { width, height } = metadata;
    if (mimeType === 'image/jpeg') {
      const output = await sharp(body, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' })
        .rotate()
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      stored = output.data;
      width = output.info.width;
      height = output.info.height;
    } else if ((metadata.orientation ?? 1) >= 5) {
      // EXIF orientations 5–8 swap the axes when the browser applies them.
      [width, height] = [height, width];
    }
    const thumbnail = await sharp(stored, { limitInputPixels: MAX_IMAGE_PIXELS, animated: false })
      .rotate()
      .resize(THUMBNAIL_EDGE, THUMBNAIL_EDGE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    return { body: stored, thumbnail, width, height, pageCount: null };
  } catch {
    throw new ChatValidationError('This image could not be read. Try exporting it again as JPG or PNG (under 40 megapixels).');
  }
}

/** Page count for the file card ("PDF · 12 pages"). Best effort: a PDF it cannot count is still accepted. */
async function pdfPageCount(body: Buffer): Promise<number | null> {
  try {
    const loaded = (await import('pdfjs-dist/legacy/build/pdf.js')) as unknown as { default?: PdfJsLike } & PdfJsLike;
    const pdfjs = loaded.default ?? loaded;
    const task = pdfjs.getDocument({
      data: new Uint8Array(body),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    });
    const timeout = new Promise<null>((resolveTimeout) => {
      setTimeout(() => resolveTimeout(null), 5_000).unref();
    });
    const pdf = await Promise.race([task.promise, timeout]);
    if (!pdf) {
      void task.destroy();
      return null;
    }
    const pages = pdf.numPages;
    void pdf.destroy();
    return Number.isInteger(pages) && pages > 0 ? pages : null;
  } catch {
    return null;
  }
}

interface PdfJsLike {
  getDocument(input: Record<string, unknown>): { promise: Promise<{ numPages: number; destroy(): Promise<void> }>; destroy(): Promise<void> };
}

async function prepareFile(body: Buffer, kind: AttachmentKind, mimeType: string): Promise<PreparedFile> {
  if (kind === 'image') return prepareImage(body, mimeType);
  if (kind === 'pdf') return { body, thumbnail: null, width: null, height: null, pageCount: await pdfPageCount(body) };
  return { body, thumbnail: null, width: null, height: null, pageCount: null };
}

/**
 * Validates and stores one uploaded file as a PENDING attachment of
 * `conversationId` — not visible to anyone until the uploader sends a
 * message carrying it. The route has already authorized membership.
 */
export async function uploadAttachment(
  ctx: RequestContext,
  conversationId: string,
  input: { fileName: string; body: Buffer },
): Promise<MessageAttachment> {
  const limit = maxAttachmentBytes();
  if (input.body.length === 0) throw new ChatValidationError('The file is empty.');
  if (input.body.length > limit) {
    throw new ChatValidationError(`Files can be at most ${loadConfig().CHAT_ATTACHMENT_MAX_MB} MB.`, { maxBytes: limit });
  }
  const fileName = sanitizeFileName(input.fileName);
  if (!fileName) throw new ChatValidationError('The file needs a name.');

  let detected;
  try {
    detected = detectFileType(fileName, input.body);
  } catch (error) {
    if (error instanceof UnsupportedFileError) throw new ChatValidationError(error.message);
    throw error;
  }

  const conversation = await db.maybeOne<{ archivedAt: Date | null }>(ctx, sql`
    SELECT archived_at FROM conversation WHERE organization_id = ${ctx.organizationId} AND id = ${conversationId}
  `);
  if (!conversation) throw new ChatNotFoundError('conversation');
  if (conversation.archivedAt) throw new ChatValidationError('This conversation is archived.');

  const prepared = await prepareFile(input.body, detected.kind, detected.mimeType);
  const driver = currentChatStorageDriver();
  const base = `${ctx.organizationId}/${conversationId}/${randomUUID()}`;
  const objectKey = `${base}.${detected.extension}`;
  const thumbnailKey = prepared.thumbnail ? `${base}.thumb.webp` : null;
  const checksum = createHash('sha256').update(prepared.body).digest('hex');

  // Storage before SQL (TX-2): a failed insert leaves an inert private
  // object, never a row pointing at nothing.
  await putChatObject(driver, { key: objectKey, body: prepared.body, contentType: detected.mimeType });
  if (prepared.thumbnail && thumbnailKey) {
    await putChatObject(driver, { key: thumbnailKey, body: prepared.thumbnail, contentType: 'image/webp' });
  }

  const row = await db.one<AttachmentRow>(ctx, sql`
    INSERT INTO message_attachment AS ma (
      organization_id, conversation_id, uploaded_by, kind, file_name, mime_type, size_bytes,
      checksum_sha256, storage_driver, object_key, thumbnail_key, width, height, page_count
    ) VALUES (
      ${ctx.organizationId}, ${conversationId}, ${ctx.principal.id}, ${detected.kind}, ${fileName}, ${detected.mimeType},
      ${prepared.body.length}, ${checksum}, ${driver}, ${objectKey}, ${thumbnailKey},
      ${prepared.width}, ${prepared.height}, ${prepared.pageCount}
    )
    RETURNING ${ATTACHMENT_COLUMNS}
  `);
  return attachmentDto(row);
}

/* ------------------------------------------------------------------ *
 * Attaching to a message
 * ------------------------------------------------------------------ */

/**
 * Moves the uploader's pending uploads onto a message (or a scheduled
 * message), in the order given. Inside the send transaction: if any id is
 * not a pending upload of THIS sender in THIS conversation, the whole send
 * rolls back.
 */
export async function claimPendingAttachments(
  tx: Tx,
  input: {
    organizationId: string;
    conversationId: string;
    uploaderId: string;
    attachmentIds: readonly string[];
    target: { messageId: string } | { scheduledMessageId: string };
  },
): Promise<void> {
  const ids = [...new Set(input.attachmentIds)];
  if (ids.length === 0) return;
  if (ids.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new ChatValidationError(`A message can carry at most ${MAX_ATTACHMENTS_PER_MESSAGE} files.`);
  }
  const messageId = 'messageId' in input.target ? input.target.messageId : null;
  const scheduledMessageId = 'scheduledMessageId' in input.target ? input.target.scheduledMessageId : null;
  const claimed = await tx.query<{ id: string }>(sql`
    UPDATE message_attachment AS ma
       SET message_id = ${messageId}, scheduled_message_id = ${scheduledMessageId}, position = (t.ord - 1)::smallint
      FROM unnest(${ids}::uuid[]) WITH ORDINALITY AS t(id, ord)
     WHERE ma.organization_id = ${input.organizationId}
       AND ma.id = t.id
       AND ma.conversation_id = ${input.conversationId}
       AND ma.uploaded_by = ${input.uploaderId}
       AND ma.message_id IS NULL
       AND ma.scheduled_message_id IS NULL
    RETURNING ma.id
  `);
  if (claimed.length !== ids.length) {
    throw new ChatValidationError('One or more files are no longer available. Remove them and upload again.', {
      missingAttachmentIds: ids.filter((id) => !claimed.some((row) => row.id === id)),
    });
  }
}

/** A scheduled message's held files become the sent message's files. */
export async function moveScheduledAttachments(tx: Tx, organizationId: string, scheduledMessageId: string, messageId: string): Promise<void> {
  await tx.query(sql`
    UPDATE message_attachment
       SET message_id = ${messageId}, scheduled_message_id = NULL
     WHERE organization_id = ${organizationId} AND scheduled_message_id = ${scheduledMessageId}
  `);
}

/** Cancelling a scheduled message releases its files back to pending (the cleanup job then removes them). */
export async function releaseScheduledAttachments(tx: Tx, organizationId: string, scheduledMessageId: string): Promise<void> {
  await tx.query(sql`
    UPDATE message_attachment SET scheduled_message_id = NULL
     WHERE organization_id = ${organizationId} AND scheduled_message_id = ${scheduledMessageId}
  `);
}

/** Forwarding copies the rows (same objects) onto the new message. */
export async function copyAttachments(tx: Tx, organizationId: string, sourceMessageId: string, target: { messageId: string; conversationId: string }): Promise<void> {
  await tx.query(sql`
    INSERT INTO message_attachment (
      organization_id, conversation_id, message_id, uploaded_by, kind, file_name, mime_type, size_bytes,
      checksum_sha256, storage_driver, object_key, thumbnail_key, width, height, page_count, position
    )
    SELECT organization_id, ${target.conversationId}, ${target.messageId}, uploaded_by, kind, file_name, mime_type, size_bytes,
           checksum_sha256, storage_driver, object_key, thumbnail_key, width, height, page_count, position
      FROM message_attachment
     WHERE organization_id = ${organizationId} AND message_id = ${sourceMessageId}
  `);
}

export async function attachmentsForMessages(ctx: RequestContext, messageIds: readonly string[]): Promise<Map<string, MessageAttachment[]>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db.query<AttachmentRow>(ctx, sql`
    SELECT ${ATTACHMENT_COLUMNS}
      FROM message_attachment ma
     WHERE ma.organization_id = ${ctx.organizationId} AND ma.message_id = ANY(${[...messageIds]}::uuid[])
     ORDER BY ma.message_id, ma.position, ma.created_at
  `);
  const byMessage = new Map<string, MessageAttachment[]>();
  for (const row of rows) {
    if (!row.messageId) continue;
    const list = byMessage.get(row.messageId) ?? [];
    list.push(attachmentDto(row));
    byMessage.set(row.messageId, list);
  }
  return byMessage;
}

export async function attachmentsForScheduled(ctx: RequestContext, scheduledIds: readonly string[]): Promise<Map<string, MessageAttachment[]>> {
  if (scheduledIds.length === 0) return new Map();
  const rows = await db.query<AttachmentRow>(ctx, sql`
    SELECT ${ATTACHMENT_COLUMNS}
      FROM message_attachment ma
     WHERE ma.organization_id = ${ctx.organizationId} AND ma.scheduled_message_id = ANY(${[...scheduledIds]}::uuid[])
     ORDER BY ma.scheduled_message_id, ma.position
  `);
  const byScheduled = new Map<string, MessageAttachment[]>();
  for (const row of rows) {
    if (!row.scheduledMessageId) continue;
    const list = byScheduled.get(row.scheduledMessageId) ?? [];
    list.push(attachmentDto(row));
    byScheduled.set(row.scheduledMessageId, list);
  }
  return byScheduled;
}

/* ------------------------------------------------------------------ *
 * Removal
 * ------------------------------------------------------------------ */

export async function findAttachmentConversation(ctx: RequestContext, attachmentId: string): Promise<string | null> {
  const row = await db.maybeOne<{ conversationId: string }>(ctx, sql`
    SELECT conversation_id FROM message_attachment WHERE organization_id = ${ctx.organizationId} AND id = ${attachmentId}
  `);
  return row?.conversationId ?? null;
}

/** The uploader removes a file from the composer before sending it. Sent files are part of the record and stay. */
export async function deletePendingAttachment(ctx: RequestContext, attachmentId: string): Promise<{ deleted: true }> {
  const removed = await db.transaction(ctx, async (tx) => {
    const row = await tx.maybeOne<AttachmentRow>(sql`
      SELECT ${ATTACHMENT_COLUMNS} FROM message_attachment ma
       WHERE ma.organization_id = ${ctx.organizationId} AND ma.id = ${attachmentId}
       FOR UPDATE
    `);
    if (!row) throw new ChatNotFoundError('attachment');
    if (row.uploadedBy !== ctx.principal.id) throw new ChatNotSenderError();
    if (row.messageId || row.scheduledMessageId) {
      throw new ChatValidationError('This file has already been sent and can no longer be removed this way.');
    }
    await tx.query(sql`DELETE FROM message_attachment WHERE organization_id = ${ctx.organizationId} AND id = ${attachmentId}`);
    return row;
  });
  await removeObjects([removed]);
  return { deleted: true };
}

async function removeObjects(rows: readonly Pick<AttachmentRow, 'storageDriver' | 'objectKey' | 'thumbnailKey'>[]): Promise<void> {
  for (const row of rows) {
    for (const key of [row.objectKey, row.thumbnailKey]) {
      if (!key) continue;
      await deleteChatObject(row.storageDriver, key).catch((error: unknown) => {
        console.error(JSON.stringify({ level: 'warn', msg: 'chat attachment object not removed', key, error: String(error) }));
      });
    }
  }
}

/**
 * Removes uploads that were never sent. Rows go first, in one transaction;
 * the objects are deleted after commit (TX-2). Never shared: a forwarded
 * copy always has a message, so it is never selected here.
 */
export async function cleanupPendingAttachments(ctx: RequestContext, now: Date, limit = 500): Promise<number> {
  const cutoff = new Date(now.getTime() - PENDING_ATTACHMENT_TTL_HOURS * 3_600_000);
  const removed = await db.transaction(ctx, (tx) => tx.query<AttachmentRow>(sql`
    DELETE FROM message_attachment AS ma
     WHERE ma.organization_id = ${ctx.organizationId}
       AND ma.id IN (
         SELECT id FROM message_attachment
          WHERE organization_id = ${ctx.organizationId}
            AND message_id IS NULL AND scheduled_message_id IS NULL
            AND created_at < ${cutoff}
          ORDER BY created_at
          LIMIT ${limit}
       )
    RETURNING ${ATTACHMENT_COLUMNS}
  `));
  await removeObjects(removed);
  return removed.length;
}
