import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { SocialMedia } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { getStorageService } from '../../platform/storage/storage.service.js';
import type { MediaRow } from './types.js';
import { SocialNotFoundError, SocialValidationError } from './errors.js';
import { ensureClient, findMedia, writeAudit } from './repository.js';

export const SOCIAL_IMAGE_LIMIT = 8 * 1024 * 1024;
export const SOCIAL_VIDEO_LIMIT = 50 * 1024 * 1024;
const extensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
};

/** Check the actual uploaded bytes, not the caller's filename or MIME label. */
export function validateMediaBytes(body: Buffer, mimeType: string): void {
  const maximum = mimeType === 'video/mp4' ? SOCIAL_VIDEO_LIMIT : SOCIAL_IMAGE_LIMIT;
  if (body.length === 0 || body.length > maximum)
    throw new SocialValidationError(
      `The file must be between 1 byte and ${maximum / 1024 / 1024} MiB.`,
    );
  const valid =
    mimeType === 'image/jpeg'
      ? body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff
      : mimeType === 'image/png'
        ? body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mimeType === 'image/webp'
          ? body.subarray(0, 4).toString('ascii') === 'RIFF' &&
            body.subarray(8, 12).toString('ascii') === 'WEBP'
          : mimeType === 'video/mp4'
            ? body.length >= 16 &&
              body.subarray(4, 8).toString('ascii') === 'ftyp' &&
              ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'MSNV'].includes(
                body.subarray(8, 12).toString('ascii'),
              )
            : false;
  if (!valid)
    throw new SocialValidationError(
      'File content does not match a supported JPEG, PNG, WebP or MP4 upload.',
    );
}
export function mediaDto(row: MediaRow): SocialMedia {
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: Number(row.sizeBytes),
    width: row.width,
    height: row.height,
    durationSeconds: row.durationSeconds === null ? null : Number(row.durationSeconds),
    url: getStorageService().presignedGetUrl({
      bucket: 'files',
      key: row.objectKey,
      expiresInSeconds: 3600,
    }),
    createdAt: row.createdAt.toISOString(),
  };
}
export async function uploadMedia(
  ctx: RequestContext,
  clientId: string,
  input: { name: string; mimeType: string; base64: string },
): Promise<SocialMedia> {
  await db.transaction(ctx, (tx) => ensureClient(tx, ctx.organizationId, clientId));
  const maxEncoded =
    Math.ceil(
      (input.mimeType === 'video/mp4' ? SOCIAL_VIDEO_LIMIT : SOCIAL_IMAGE_LIMIT) / 3,
    ) * 4;
  if (
    input.base64.length > maxEncoded ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)
  )
    throw new SocialValidationError(
      'Upload must be a valid base64-encoded file within the size limit.',
    );
  let body = Buffer.from(input.base64, 'base64');
  validateMediaBytes(body, input.mimeType);
  let width: number | null = null;
  let height: number | null = null;
  if (input.mimeType.startsWith('image/')) {
    try {
      const image = sharp(body, { limitInputPixels: 40_000_000, animated: false });
      const metadata = await image.metadata();
      if (metadata.pages && metadata.pages > 1)
        throw new Error('Animated images are not supported');
      const output = await image.rotate().toBuffer({ resolveWithObject: true });
      body = output.data;
      width = output.info.width;
      height = output.info.height;
    } catch {
      throw new SocialValidationError(
        'The image cannot be decoded safely. Use a static image below 40 megapixels.',
      );
    }
    validateMediaBytes(body, input.mimeType);
  }
  const objectKey = `social/${ctx.organizationId}/${clientId}/${randomUUID()}.${extensions[input.mimeType]}`;
  const storage = getStorageService();
  const { checksumSha256 } = await storage.putObject({
    bucket: 'files',
    key: objectKey,
    body,
    contentType: input.mimeType,
  });
  // Storage runs before SQL (TX-2). A SQL failure leaves an inert private
  // object; deleting it here could delete a committed object on ambiguous COMMIT.
  const row = await db.transaction(ctx, async (tx) => {
    await ensureClient(tx, ctx.organizationId, clientId);
    const saved =
      await tx.one<MediaRow>(sql`INSERT INTO social_media(organization_id,client_id,object_key,name,mime_type,size_bytes,checksum_sha256,width,height,created_by)
      VALUES (${ctx.organizationId},${clientId},${objectKey},${Array.from(input.name, (character) => (character.charCodeAt(0) < 32 || '/\\'.includes(character) ? '_' : character)).join('')},${input.mimeType},${body.length},${checksumSha256},${width},${height},${ctx.principal.id}) RETURNING *`);
    await writeAudit(tx, ctx, clientId, 'media.uploaded', saved.id, {
      mimeType: input.mimeType,
      sizeBytes: body.length,
    });
    return saved;
  });
  return mediaDto(row);
}
export async function listMedia(
  ctx: RequestContext,
  clientId: string,
): Promise<SocialMedia[]> {
  return (
    await db.transaction(ctx, async (tx) => {
      await ensureClient(tx, ctx.organizationId, clientId);
      return findMedia(tx, ctx.organizationId, clientId);
    })
  ).map(mediaDto);
}
export async function getMedia(
  ctx: RequestContext,
  clientId: string,
  mediaId: string,
): Promise<SocialMedia> {
  const row = await db.transaction(
    ctx,
    async (tx) => (await findMedia(tx, ctx.organizationId, clientId, [mediaId]))[0],
  );
  if (!row) throw new SocialNotFoundError('Media');
  return mediaDto(row);
}
export async function readMedia(
  ctx: RequestContext,
  clientId: string,
  mediaId: string,
): Promise<{ body: Buffer; mimeType: string; name: string }> {
  const row = await db.transaction(
    ctx,
    async (tx) => (await findMedia(tx, ctx.organizationId, clientId, [mediaId]))[0],
  );
  if (!row) throw new SocialNotFoundError('Media');
  const object = await getStorageService().getObject({
    bucket: 'files',
    key: row.objectKey,
  });
  if (object.checksumSha256 !== row.checksumSha256)
    throw new SocialValidationError(
      'Stored media integrity check failed. Upload the file again.',
    );
  return { body: object.body, mimeType: row.mimeType, name: row.name };
}
