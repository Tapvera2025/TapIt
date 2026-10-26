import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { loadConfig } from '../../../config.js';

function absolutePath(relativePath: string): string {
  const base = resolve(loadConfig().TAPCRM_UPLOAD_DIR);
  const absolute = resolve(base, relativePath);
  const inside = relative(base, absolute);
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error('Invalid accounting tax artifact path.');
  }
  return absolute;
}

export interface StoredTaxFile {
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export async function storeTaxFile(
  organizationId: string,
  artifactId: string,
  extension: 'csv' | 'json',
  body: Buffer,
): Promise<StoredTaxFile> {
  if (body.length === 0) throw new Error('Tax artifact cannot be empty.');
  const relativePath = posix.join('tax-artifacts', organizationId, `${artifactId}.${extension}`);
  const absolute = absolutePath(relativePath);
  await mkdir(resolve(loadConfig().TAPCRM_UPLOAD_DIR, 'tax-artifacts', organizationId), { recursive: true });
  await writeFile(absolute, body, { flag: 'wx' });
  return {
    relativePath,
    sizeBytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
  };
}

export async function readTaxFile(relativePath: string): Promise<Buffer> {
  try {
    return await readFile(absolutePath(relativePath));
  } catch {
    throw new Error('Tax artifact file is no longer available.');
  }
}

export async function removeTaxFile(relativePath: string): Promise<void> {
  await unlink(absolutePath(relativePath)).catch(() => undefined);
}
