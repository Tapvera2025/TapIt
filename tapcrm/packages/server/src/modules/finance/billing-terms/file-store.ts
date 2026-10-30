import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../../../config.js';
import { BillingTermsValidationError } from './errors.js';

const MAX_BYTES = 10 * 1024 * 1024;
const allowed = new Map([['pdf', 'application/pdf'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']]);
function extension(name: string): string { const ext = name.toLowerCase().split('.').pop() ?? ''; if (!allowed.has(ext)) throw new BillingTermsValidationError('Contract documents must be PDF, JPG, PNG, or WEBP.'); return ext; }
function signature(data: Buffer, ext: string): boolean { if (ext === 'pdf') return data.subarray(0, 5).toString() === '%PDF-'; if (ext === 'jpg' || ext === 'jpeg') return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff; if (ext === 'png') return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); return data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP'; }
export async function storeContractDocument(organizationId: string, contractId: string, filename: string, mimeType: string, base64: string) {
  const ext = extension(filename); const expected = allowed.get(ext)!;
  if (mimeType.toLowerCase() !== expected) throw new BillingTermsValidationError('Contract document MIME type does not match its extension.');
  const data = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!data.length || data.length > MAX_BYTES || !signature(data, ext)) throw new BillingTermsValidationError('Contract document is empty, too large, or has invalid file content.');
  const storedFilename = `${randomUUID()}.${ext}`; const relativePath = join('finance-contracts', organizationId, contractId, storedFilename); const base = resolve(loadConfig().TAPCRM_UPLOAD_DIR); const absolute = resolve(base, relativePath);
  if (!absolute.startsWith(`${base}/`)) throw new BillingTermsValidationError('Invalid contract document path.');
  await mkdir(join(base, 'finance-contracts', organizationId, contractId), { recursive: true }); await writeFile(absolute, data, { flag: 'wx' });
  return { storedFilename, relativePath, sizeBytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), mimeType: expected };
}
export async function readContractDocument(relativePath: string): Promise<Buffer> { const base = resolve(loadConfig().TAPCRM_UPLOAD_DIR); const absolute = resolve(base, relativePath); if (!absolute.startsWith(`${base}/`)) throw new BillingTermsValidationError('Invalid contract document path.'); try { return await readFile(absolute); } catch { throw new BillingTermsValidationError('Contract document is no longer available.'); } }
export async function removeContractDocument(relativePath: string): Promise<void> { const base = resolve(loadConfig().TAPCRM_UPLOAD_DIR); const absolute = resolve(base, relativePath); if (absolute.startsWith(`${base}/`)) await unlink(absolute).catch(() => undefined); }
