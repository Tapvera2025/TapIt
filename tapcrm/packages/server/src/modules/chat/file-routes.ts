import { Router, type Request, type Response } from 'express';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { ChatStorageDriver } from './file-storage.js';
import { contentDisposition, openLocalChatObject, presignChatObject } from './file-storage.js';
import { CHAT_FILE_VARIANTS, verifyChatFileSignature, type ChatFileTarget, type ChatFileVariant } from './file-urls.js';
import { previewImageKey } from './link-preview.js';
import { backgroundContext } from './service.js';

/**
 * GET {API_BASE_PATH}/chat-files/… — serves chat attachments, their
 * thumbnails and cached link-preview images to `<img>`, `<a download>` and
 * new tabs, none of which can send the bearer token.
 *
 * Mounted BEFORE the authenticated pipeline: the signed link is the
 * credential (see file-urls.ts). After the signature checks out, the
 * database is still asked on every request — a file on an unsent message is
 * gone at once, whatever the link's expiry says.
 *
 *   s3     302 to a 15-minute presigned link on the object store, with the
 *          download name and type fixed into that link's signature.
 *   local  the API streams the file itself.
 *
 * Only raster images and PDFs are ever served inline. Everything else is a
 * download, so an HTML or script file renamed to .txt can never render on
 * the application's origin.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']);
const PRESIGN_SECONDS = 15 * 60;

function notFound(res: Response): void {
  res.status(404).type('text/plain').send('Not found');
}

function query(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === 'string' ? value : undefined;
}

async function send(
  res: Response,
  input: { driver: ChatStorageDriver; key: string; contentType: string; disposition: string; inline: boolean; immutable: boolean },
): Promise<void> {
  res.setHeader('Cache-Control', input.immutable ? 'private, max-age=3600' : 'private, max-age=600');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (input.driver === 's3') {
    res.redirect(302, presignChatObject({
      key: input.key,
      expiresInSeconds: PRESIGN_SECONDS,
      contentDisposition: input.disposition,
      contentType: input.contentType,
    }));
    return;
  }
  const file = await openLocalChatObject(input.key);
  if (!file) {
    notFound(res);
    return;
  }
  // The browser's own PDF viewer needs plugin content; everything else gets
  // a document that can run nothing at all.
  if (input.contentType === 'application/pdf' && input.inline) res.removeHeader('Content-Security-Policy');
  else res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', input.contentType);
  res.setHeader('Content-Length', String(file.size));
  res.setHeader('Content-Disposition', input.disposition);
  await new Promise<void>((resolve, reject) => {
    const stream = file.stream();
    stream.on('error', reject);
    res.on('close', () => {
      stream.destroy();
      resolve();
    });
    stream.pipe(res);
  });
}

interface AttachmentFileRow {
  fileName: string;
  mimeType: string;
  storageDriver: ChatStorageDriver;
  objectKey: string;
  thumbnailKey: string | null;
  messageDeletedAt: Date | null;
  messageId: string | null;
}

export function buildChatFileRouter(): Router {
  const router = Router();

  router.get('/:organizationId/a/:attachmentId/:variant', async (req, res) => {
    const organizationId = req.params['organizationId'] ?? '';
    const attachmentId = req.params['attachmentId'] ?? '';
    const variant = req.params['variant'] as ChatFileVariant;
    if (!UUID.test(organizationId) || !UUID.test(attachmentId) || !CHAT_FILE_VARIANTS.includes(variant)) return notFound(res);
    const target: ChatFileTarget = { type: 'a', attachmentId, variant };
    if (!verifyChatFileSignature(organizationId, target, query(req, 'exp'), query(req, 'sig'))) {
      res.status(403).type('text/plain').send('This link has expired. Reopen the conversation to get a fresh one.');
      return;
    }
    const ctx = backgroundContext(organizationId, 'chat.file', attachmentId);
    const row = await db.maybeOne<AttachmentFileRow>(ctx, sql`
      SELECT ma.file_name, ma.mime_type, ma.storage_driver, ma.object_key, ma.thumbnail_key, ma.message_id,
             m.deleted_at AS "messageDeletedAt"
        FROM message_attachment ma
        LEFT JOIN message m ON m.organization_id = ma.organization_id AND m.id = ma.message_id
       WHERE ma.organization_id = ${organizationId} AND ma.id = ${attachmentId}
    `);
    if (!row || row.messageDeletedAt) return notFound(res);
    if (variant === 'thumb') {
      if (!row.thumbnailKey) return notFound(res);
      return send(res, {
        driver: row.storageDriver,
        key: row.thumbnailKey,
        contentType: 'image/webp',
        disposition: contentDisposition('inline', row.fileName.replace(/\.[^.]+$/, '') + '.webp'),
        inline: true,
        immutable: true,
      });
    }
    const inline = variant === 'view' && INLINE_TYPES.has(row.mimeType);
    return send(res, {
      driver: row.storageDriver,
      key: row.objectKey,
      contentType: row.mimeType,
      disposition: contentDisposition(inline ? 'inline' : 'attachment', row.fileName),
      inline,
      immutable: true,
    });
  });

  router.get('/:organizationId/p/:driver/:hash', async (req, res) => {
    const organizationId = req.params['organizationId'] ?? '';
    const driver = req.params['driver'];
    const hash = req.params['hash'] ?? '';
    if (!UUID.test(organizationId) || (driver !== 's3' && driver !== 'local') || !/^[0-9a-f]{64}$/.test(hash)) return notFound(res);
    if (!verifyChatFileSignature(organizationId, { type: 'p', driver, hash }, query(req, 'exp'), query(req, 'sig'))) {
      res.status(403).type('text/plain').send('This link has expired.');
      return;
    }
    return send(res, {
      driver,
      key: previewImageKey(organizationId, hash),
      contentType: 'image/webp',
      disposition: contentDisposition('inline', 'preview.webp'),
      inline: true,
      immutable: false,
    });
  });

  return router;
}
