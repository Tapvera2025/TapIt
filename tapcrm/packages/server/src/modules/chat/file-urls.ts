import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadConfig } from '../../config.js';

/**
 * Signed links to chat files.
 *
 * A browser loads an image with `<img src>`, which cannot carry the bearer
 * token the API expects. So a message's attachments carry links that are
 * their own credential — the same idea as an S3 presigned URL (SE-6), signed
 * by this server: HMAC-SHA256 over (organization, file, variant, expiry).
 *
 * Expiry is rounded UP to the next hour plus one, so a link is valid for one
 * to two hours and is IDENTICAL for every fetch within the same hour — the
 * browser cache keeps working across the thread's frequent refetches. The
 * file route still checks the database on every request, so an unsent
 * message stops serving its files at once, however fresh the link.
 */

const HOUR_SECONDS = 3600;

export type ChatFileVariant = 'view' | 'thumb' | 'download';
export const CHAT_FILE_VARIANTS: readonly ChatFileVariant[] = ['view', 'thumb', 'download'];

/** `a` = an attachment (by id), `p` = a cached link-preview image (by URL hash, per driver). */
export type ChatFileTarget =
  | { readonly type: 'a'; readonly attachmentId: string; readonly variant: ChatFileVariant }
  | { readonly type: 'p'; readonly driver: 's3' | 'local'; readonly hash: string };

let derivedKey: { secret: string; key: Buffer } | null = null;

function signingKey(): Buffer {
  const secret = loadConfig().JWT_ACCESS_SECRET;
  if (derivedKey?.secret !== secret) {
    // A purpose-bound subkey: the JWT secret itself never signs a file link.
    derivedKey = { secret, key: createHmac('sha256', secret).update('tapcrm.chat-file-url.v1').digest() };
  }
  return derivedKey.key;
}

function targetPath(organizationId: string, target: ChatFileTarget): string {
  return target.type === 'a'
    ? `${organizationId}/a/${target.attachmentId}/${target.variant}`
    : `${organizationId}/p/${target.driver}/${target.hash}`;
}

function signature(path: string, expires: number): string {
  return createHmac('sha256', signingKey()).update(`${path}|${expires}`).digest('base64url');
}

export function linkExpiry(nowMs = Date.now()): number {
  return (Math.ceil(nowMs / 1000 / HOUR_SECONDS) + 1) * HOUR_SECONDS;
}

/** A same-origin path (under API_BASE_PATH) that serves the file without a bearer token. */
export function signChatFileUrl(organizationId: string, target: ChatFileTarget, nowMs = Date.now()): string {
  const path = targetPath(organizationId, target);
  const expires = linkExpiry(nowMs);
  const base = loadConfig().API_BASE_PATH.replace(/\/+$/, '');
  return `${base}/chat-files/${path}?exp=${expires}&sig=${signature(path, expires)}`;
}

export function verifyChatFileSignature(
  organizationId: string,
  target: ChatFileTarget,
  expires: string | undefined,
  provided: string | undefined,
  nowMs = Date.now(),
): boolean {
  if (!expires || !provided || !/^\d{1,12}$/.test(expires)) return false;
  const expiresAt = Number(expires);
  if (expiresAt * 1000 <= nowMs) return false;
  const expected = Buffer.from(signature(targetPath(organizationId, target), expiresAt));
  const given = Buffer.from(provided);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
