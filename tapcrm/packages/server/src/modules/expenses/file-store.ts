import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../config.js';
import { ExpenseError } from './errors.js';

const MAX_BYTES = 5 * 1024 * 1024;
const allowed = new Map([
  ['pdf', 'application/pdf'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'],
  ['png', 'image/png'], ['webp', 'image/webp'],
]);

function extension(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (!allowed.has(ext)) throw new ExpenseError('Unsupported receipt format. Please upload PDF, JPG, PNG, or WEBP.');
  return ext;
}
function signature(buffer: Buffer, ext: string): boolean {
  if (ext === 'pdf') return buffer.subarray(0, 5).toString() === '%PDF-';
  if (ext === 'jpg' || ext === 'jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (ext === 'png') return buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
}

export async function storeReceipt(
  organizationId: string,
  claimId: string,
  originalFilename: string,
  mimeType: string,
  base64: string,
): Promise<{ storedFilename: string; relativePath: string; sizeBytes: number; mimeType: string }> {
  const ext = extension(originalFilename);
  const expectedMime = allowed.get(ext)!;
  if (mimeType.toLowerCase() !== expectedMime) throw new ExpenseError('Receipt MIME type does not match its file format.');
  const data = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (data.length === 0) throw new ExpenseError('Receipt file is empty.');
  if (data.length > MAX_BYTES) throw new ExpenseError('Receipt must be 5 MB or smaller.');
  if (!signature(data, ext)) throw new ExpenseError('Receipt content does not match the selected file format.');
  const storedFilename = `${randomUUID()}.${ext}`;
  const relativePath = join('expenses', organizationId, claimId, storedFilename);
  const absolute = resolve(loadConfig().TAPCRM_UPLOAD_DIR, relativePath);
  const base = resolve(loadConfig().TAPCRM_UPLOAD_DIR);
  if (!absolute.startsWith(`${base}/`)) throw new ExpenseError('Invalid receipt path.');
  await mkdir(join(base, 'expenses', organizationId, claimId), { recursive: true });
  await writeFile(absolute, data, { flag: 'wx' });
  return { storedFilename, relativePath, sizeBytes: data.length, mimeType: expectedMime };
}

export async function readReceipt(relativePath: string): Promise<Buffer> {
  const base = resolve(loadConfig().TAPCRM_UPLOAD_DIR);
  const absolute = resolve(base, relativePath);
  if (!absolute.startsWith(`${base}/`)) throw new ExpenseError('Invalid receipt path.');
  try { return await readFile(absolute); } catch { throw new ExpenseError('Receipt file is no longer available.'); }
}

export async function removeReceipt(relativePath: string): Promise<void> {
  const base = resolve(loadConfig().TAPCRM_UPLOAD_DIR);
  const absolute = resolve(base, relativePath);
  if (!absolute.startsWith(`${base}/`)) return;
  await unlink(absolute).catch(() => undefined);
}
