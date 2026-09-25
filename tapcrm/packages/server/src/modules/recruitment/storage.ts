import crypto from 'node:crypto';
import { loadConfig } from '../../config.js';

export interface StorageService {
  putObject(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void>;
  getObject(
    key: string,
  ): Promise<{ buffer: Buffer; mimeType: string }>;
  getSignedUrl(
    key: string,
    expiresInSeconds?: number,
  ): Promise<string>;
  deleteObject(key: string): Promise<void>;
}

export const MAX_RESUME_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

/**
 * Validates uploaded resume file buffer, mime type, and filename.
 */
export function validateResumeUpload(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): { valid: boolean; error?: string } {
  if (buffer.length === 0) {
    return { valid: false, error: 'Resume file cannot be empty' };
  }
  if (buffer.length > MAX_RESUME_SIZE_BYTES) {
    return {
      valid: false,
      error: `Resume file exceeds maximum allowed size of 10MB (${(buffer.length / (1024 * 1024)).toFixed(1)}MB)`,
    };
  }

  const normalizedMime = mimeType.toLowerCase().trim();
  const lowerExt = filename.toLowerCase().split('.').pop() ?? '';
  const isAllowedExt = ['pdf', 'doc', 'docx', 'txt'].includes(lowerExt);

  if (!ALLOWED_MIME_TYPES.has(normalizedMime) && !isAllowedExt) {
    return {
      valid: false,
      error: 'Invalid file type. Allowed formats: PDF, DOC, DOCX, TXT',
    };
  }

  return { valid: true };
}

/**
 * Generates an FS-1 sharded, randomized relative object key for a resume.
 */
export function generateResumeObjectKey(
  organizationId: string,
  submissionId: string,
  originalFilename: string,
): string {
  const ext = (originalFilename.split('.').pop() ?? 'pdf').replace(/[^a-zA-Z0-9]/g, '');
  const randomPart = crypto.randomBytes(16).toString('hex');
  return `recruitment/resumes/${organizationId}/${submissionId}/${randomPart}.${ext}`;
}

// ---------------------------------------------------------------------
// In-Memory Storage (Test and Dev fallback)
// ---------------------------------------------------------------------

export class MemoryStorageService implements StorageService {
  private readonly store = new Map<string, { buffer: Buffer; mimeType: string }>();

  async putObject(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    this.store.set(key, { buffer, mimeType });
  }

  async getObject(key: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const item = this.store.get(key);
    if (!item) {
      throw new Error(`Object not found in storage: ${key}`);
    }
    return item;
  }

  async getSignedUrl(key: string, _expiresInSeconds = 900): Promise<string> {
    return `/api/recruitment/resume-submissions/file-preview?key=${encodeURIComponent(key)}`;
  }

  async deleteObject(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// ---------------------------------------------------------------------
// S3 / MinIO Storage with SigV4
// ---------------------------------------------------------------------

class S3StorageService implements StorageService {
  private readonly endpoint: string;
  private readonly region: string;
  private readonly bucket: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly forcePathStyle: boolean;

  constructor() {
    const config = loadConfig();
    this.endpoint = config.S3_ENDPOINT || 'http://127.0.0.1:9000';
    this.region = config.S3_REGION || 'us-east-1';
    this.bucket = config.S3_BUCKET || 'tapcrm-files';
    this.accessKeyId = config.S3_ACCESS_KEY_ID || 'tapcrm';
    this.secretAccessKey = config.S3_SECRET_ACCESS_KEY || 'tapcrm-dev-password';
    this.forcePathStyle = config.S3_FORCE_PATH_STYLE;
  }

  private getUrl(key: string): string {
    const baseUrl = this.endpoint.replace(/\/+$/, '');
    if (this.forcePathStyle) {
      return `${baseUrl}/${this.bucket}/${key.replace(/^\/+/, '')}`;
    }
    const url = new URL(baseUrl);
    return `${url.protocol}//${this.bucket}.${url.host}/${key.replace(/^\/+/, '')}`;
  }

  private hmac(key: Buffer | string, data: string): Buffer {
    return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
  }

  private getSignatureKey(dateStamp: string): Buffer {
    const kDate = this.hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = this.hmac(kDate, this.region);
    const kService = this.hmac(kRegion, 's3');
    return this.hmac(kService, 'aws4_request');
  }

  async putObject(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    const targetUrl = this.getUrl(key);
    const url = new URL(targetUrl);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = crypto.createHash('sha256').update(buffer).digest('hex');

    const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = [
      'PUT',
      url.pathname,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
    ].join('\n');

    const signingKey = this.getSignatureKey(dateStamp);
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
    const authHeader = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(targetUrl, {
      method: 'PUT',
      headers: {
        'Host': url.host,
        'Content-Type': mimeType,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        'Authorization': authHeader,
      },
      body: buffer,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`S3 PutObject failed [${res.status}]: ${errText}`);
    }
  }

  async getObject(key: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const targetUrl = this.getUrl(key);
    const url = new URL(targetUrl);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = crypto.createHash('sha256').update('').digest('hex');

    const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = [
      'GET',
      url.pathname,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
    ].join('\n');

    const signingKey = this.getSignatureKey(dateStamp);
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
    const authHeader = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Host': url.host,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        'Authorization': authHeader,
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`S3 GetObject failed [${res.status}]: ${errText}`);
    }

    const mimeType = res.headers.get('content-type') || 'application/pdf';
    const arrayBuffer = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), mimeType };
  }

  async getSignedUrl(key: string, expiresInSeconds = 900): Promise<string> {
    const targetUrl = this.getUrl(key);
    const url = new URL(targetUrl);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;

    const queryParams: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.accessKeyId}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresInSeconds),
      'X-Amz-SignedHeaders': 'host',
    };

    const sortedQuery = Object.keys(queryParams)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k]!)}`)
      .join('&');

    const canonicalHeaders = `host:${url.host}\n`;
    const canonicalRequest = [
      'GET',
      url.pathname,
      sortedQuery,
      canonicalHeaders,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
    ].join('\n');

    const signingKey = this.getSignatureKey(dateStamp);
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

    return `${targetUrl}?${sortedQuery}&X-Amz-Signature=${signature}`;
  }

  async deleteObject(key: string): Promise<void> {
    const targetUrl = this.getUrl(key);
    const url = new URL(targetUrl);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = crypto.createHash('sha256').update('').digest('hex');

    const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = [
      'DELETE',
      url.pathname,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
    ].join('\n');

    const signingKey = this.getSignatureKey(dateStamp);
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
    const authHeader = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    await fetch(targetUrl, {
      method: 'DELETE',
      headers: {
        'Host': url.host,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        'Authorization': authHeader,
      },
    }).catch(() => undefined);
  }
}

let customStorage: StorageService | null = null;
let s3Storage: S3StorageService | null = null;
let memoryStorage: MemoryStorageService | null = null;

export function setStorageService(service: StorageService): void {
  customStorage = service;
}

export function resetStorageService(): void {
  customStorage = null;
}

export function getStorageService(): StorageService {
  if (customStorage) return customStorage;

  if (process.env['NODE_ENV'] === 'test') {
    memoryStorage ??= new MemoryStorageService();
    return memoryStorage;
  }

  let config;
  try {
    config = loadConfig();
  } catch {
    memoryStorage ??= new MemoryStorageService();
    return memoryStorage;
  }

  if (!config.S3_ACCESS_KEY_ID) {
    memoryStorage ??= new MemoryStorageService();
    return memoryStorage;
  }

  s3Storage ??= new S3StorageService();
  return s3Storage;
}
