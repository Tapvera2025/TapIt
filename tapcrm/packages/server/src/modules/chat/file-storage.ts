import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { chatStorageDriver, loadConfig } from '../../config.js';
import { getStorageService } from '../../platform/storage/index.js';

/**
 * Where chat files live — attachments, their thumbnails and cached
 * link-preview images.
 *
 *   s3     platform/storage: AWS S3, Cloudflare R2 or MinIO, private bucket,
 *          downloads by short-lived signed link (TECH.md §12, SE-6).
 *   local  TAPCRM_UPLOAD_DIR/chat on this server's disk, streamed by the API's
 *          signed file route. For development without an object store.
 *
 * Each stored row records its driver, so switching CHAT_STORAGE_DRIVER later
 * never orphans files written under the other one.
 */
export type ChatStorageDriver = 's3' | 'local';

export function currentChatStorageDriver(): ChatStorageDriver {
  return chatStorageDriver();
}

const LOCAL_ROOT = 'chat';
/** Chat's namespace in the shared bucket (other modules use `social/`, `attendance/`, …). */
const S3_PREFIX = 'chat/';

/** Keys are stored relative; each driver places them under its own `chat` namespace. */
function s3Key(key: string): string {
  return `${S3_PREFIX}${key}`;
}

/** Resolves a key under the local chat directory, refusing anything that escapes it. */
export function localChatPath(key: string): string {
  const base = resolve(loadConfig().TAPCRM_UPLOAD_DIR, LOCAL_ROOT);
  const absolute = resolve(base, key);
  if (absolute !== base && !absolute.startsWith(base + sep)) {
    throw new Error('Refusing a chat storage key outside the chat directory');
  }
  return absolute;
}

export async function putChatObject(
  driver: ChatStorageDriver,
  input: { key: string; body: Buffer; contentType: string },
): Promise<void> {
  if (driver === 's3') {
    await getStorageService().putObject({ bucket: 'files', key: s3Key(input.key), body: input.body, contentType: input.contentType });
    return;
  }
  const path = localChatPath(input.key);
  await mkdir(dirname(path), { recursive: true });
  // Write-then-rename: a reader never sees a half-written file.
  const temporary = `${path}.${randomUUID()}.partial`;
  await writeFile(temporary, input.body, { flag: 'wx' });
  await rename(temporary, path);
}

export async function deleteChatObject(driver: ChatStorageDriver, key: string): Promise<void> {
  if (driver === 's3') {
    await getStorageService().deleteObject({ bucket: 'files', key: s3Key(key) });
    return;
  }
  await rm(localChatPath(key), { force: true });
}

/** Local driver only: the file's size and a stream of it, or null when missing. */
export async function openLocalChatObject(key: string): Promise<{ size: number; stream: () => Readable } | null> {
  const path = localChatPath(key);
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return { size: info.size, stream: () => createReadStream(path) };
  } catch {
    return null;
  }
}

/** S3 driver only: a short-lived direct link with the response headers fixed into its signature. */
export function presignChatObject(input: {
  key: string;
  expiresInSeconds: number;
  contentDisposition: string;
  contentType: string;
}): string {
  return getStorageService().presignedGetUrl({
    bucket: 'files',
    key: s3Key(input.key),
    expiresInSeconds: input.expiresInSeconds,
    responseContentDisposition: input.contentDisposition,
    responseContentType: input.contentType,
  });
}

/** RFC 6266 / 5987: an ASCII fallback plus the exact UTF-8 name. */
export function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
