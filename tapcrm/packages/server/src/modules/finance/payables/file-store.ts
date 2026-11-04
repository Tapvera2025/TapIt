import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../../config.js';
import { PayablesError } from './errors.js';

const MAX_BYTES = 10 * 1024 * 1024;
const PDF_SIGNATURE = Buffer.from('%PDF-');
const IMAGE_SIGNATURES = [
  Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  Buffer.from([0xff, 0xd8, 0xff]),
  Buffer.from('RIFF'),
];

function hasSignature(body: Buffer, extension: string): boolean {
  if (extension === 'pdf') return body.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE);
  return IMAGE_SIGNATURES.some((signature) => body.subarray(0, signature.length).equals(signature));
}
export async function storeBillArtifact(
  organizationId: string,
  billId: string,
  filename: string,
  mimeType: string,
  base64: string,
) {
  const body = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!body.length || body.length > MAX_BYTES)
    throw new PayablesError('Bill artifact must be between 1 byte and 10 MB.');
  const extension = filename.toLowerCase().split('.').pop() || 'bin';
  if (!['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(extension))
    throw new PayablesError('Bill artifact must be PDF or an image.');
  if (!hasSignature(body, extension))
    throw new PayablesError('Bill artifact content does not match its file type.');
  const base = resolve(loadConfig().TAPCRM_UPLOAD_DIR);
  const relativePath = join(
    'finance-payables',
    organizationId,
    billId,
    `${randomUUID()}.${extension}`,
  );
  const absolute = resolve(base, relativePath);
  if (!absolute.startsWith(`${base}/`))
    throw new PayablesError('Invalid bill artifact path.');
  await mkdir(resolve(base, 'finance-payables', organizationId, billId), {
    recursive: true,
  });
  await writeFile(absolute, body, { flag: 'wx' });
  return {
    relativePath,
    sizeBytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
    mimeType,
  };
}
export async function readBillArtifact(relativePath: string) {
  const base = resolve(loadConfig().TAPCRM_UPLOAD_DIR);
  const absolute = resolve(base, relativePath);
  if (!absolute.startsWith(`${base}/`))
    throw new PayablesError('Invalid bill artifact path.');
  return readFile(absolute);
}
export async function removeBillArtifact(relativePath: string) {
  const base = resolve(loadConfig().TAPCRM_UPLOAD_DIR);
  const absolute = resolve(base, relativePath);
  if (absolute.startsWith(`${base}/`)) await unlink(absolute).catch(() => undefined);
}
