import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { loadConfig } from '../../../config.js';
import { ProjectValidationError } from '../errors.js';
import type { ScreenshotMimeType } from './screenshots.js';

const MAX_SCREENSHOT_SIZE_BYTES = 3 * 1024 * 1024;

function absolutePath(relativePath: string): string {
  const base = resolve(loadConfig().TAPCRM_UPLOAD_DIR);
  const absolute = resolve(base, relativePath);
  // Containment check that works with either path separator: the target must sit strictly inside the upload dir.
  const inside = relative(base, absolute);
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new ProjectValidationError('Invalid screenshot path.');
  return absolute;
}

export async function storeScreenshot(organizationId: string, projectId: string, mimeType: ScreenshotMimeType, body: Buffer): Promise<{ relativePath: string; sizeBytes: number }> {
  if (body.length === 0 || body.length > MAX_SCREENSHOT_SIZE_BYTES) throw new ProjectValidationError('Screenshot must be larger than 0 and no bigger than 3 MB.');
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice(6);
  // Stored in the database, so always forward slashes regardless of the host OS.
  const relativePath = posix.join('screenshots', organizationId, projectId, `${randomUUID()}.${extension}`);
  const absolute = absolutePath(relativePath);
  await mkdir(resolve(loadConfig().TAPCRM_UPLOAD_DIR, 'screenshots', organizationId, projectId), { recursive: true });
  await writeFile(absolute, body, { flag: 'wx' });
  return { relativePath, sizeBytes: body.length };
}

export async function readScreenshot(relativePath: string): Promise<Buffer> { const absolute = absolutePath(relativePath); try { return await readFile(absolute); } catch { throw new ProjectValidationError('Screenshot file is no longer available.'); } }
export async function removeScreenshot(relativePath: string): Promise<void> { await unlink(absolutePath(relativePath)).catch(() => undefined); }
