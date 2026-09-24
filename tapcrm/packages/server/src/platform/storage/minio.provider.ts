import { createHash, createHmac } from 'node:crypto';
import { loadConfig } from '../../config.js';
import type { StorageBucket, StorageService, StoredObject } from './storage.types.js';

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function encodedPath(key: string): string {
  return `/${key.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
}

function bucketName(bucket: StorageBucket): string {
  return bucket === 'worm' ? loadConfig().S3_BUCKET_WORM : loadConfig().S3_BUCKET;
}

function requestUrl(bucket: StorageBucket, key: string): URL {
  const endpoint = loadConfig().S3_ENDPOINT;
  if (!endpoint) throw new Error('S3_ENDPOINT is required for centralized storage.');
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(bucketName(bucket))}${encodedPath(key)}`;
  return url;
}

async function signedRequest(method: string, bucket: StorageBucket, key: string, body: Buffer | null, metadata: Readonly<Record<string, string>> = {}): Promise<Response> {
  const config = loadConfig();
  if (!config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) throw new Error('S3 credentials are required for centralized storage.');
  const url = requestUrl(bucket, key);
  const payloadHash = sha256(body ?? Buffer.alloc(0));
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const date = amzDate.slice(0, 8);
  const host = url.host;
  const headers = new Headers({
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  });
  for (const [name, value] of Object.entries(metadata)) headers.set(`x-amz-meta-${name.toLowerCase()}`, value);
  if (body !== null) headers.set('content-type', 'application/octet-stream');
  const signedHeaders = [...headers.keys()].map((name) => name.toLowerCase()).sort();
  const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers.get(name)!.trim()}\n`).join('');
  const canonicalRequest = [method, url.pathname, url.search.slice(1), canonicalHeaders, signedHeaders.join(';'), payloadHash].join('\n');
  const scope = `${date}/${config.S3_REGION}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.S3_SECRET_ACCESS_KEY}`, date), config.S3_REGION), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers.set('authorization', `AWS4-HMAC-SHA256 Credential=${config.S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`);
  const response = body === null
    ? await fetch(url, { method, headers })
    : await fetch(url, { method, headers, body });
  if (!response.ok) throw new Error(`Storage ${method} ${key} failed with HTTP ${response.status}.`);
  return response;
}

export class MinioStorageProvider implements StorageService {
  async putObject(input: { bucket: StorageBucket; key: string; body: Buffer; contentType: string; metadata?: Readonly<Record<string, string>> }): Promise<{ checksumSha256: string }> {
    const checksumSha256 = sha256(input.body);
    await signedRequest('PUT', input.bucket, input.key, input.body, { ...input.metadata, 'checksum-sha256': checksumSha256, 'content-type': input.contentType });
    return { checksumSha256 };
  }

  async getObject(input: { bucket: StorageBucket; key: string }): Promise<StoredObject> {
    const response = await signedRequest('GET', input.bucket, input.key, null);
    const body = Buffer.from(await response.arrayBuffer());
    return { key: input.key, body, contentType: response.headers.get('content-type') ?? 'application/octet-stream', checksumSha256: sha256(body) };
  }

  async headObject(input: { bucket: StorageBucket; key: string }): Promise<{ checksumSha256: string; contentLength: number }> {
    const response = await signedRequest('HEAD', input.bucket, input.key, null);
    return { checksumSha256: response.headers.get('x-amz-meta-checksum-sha256') ?? response.headers.get('etag')?.replaceAll('"', '') ?? '', contentLength: Number(response.headers.get('content-length') ?? 0) };
  }

  async deleteObject(input: { bucket: StorageBucket; key: string }): Promise<void> {
    await signedRequest('DELETE', input.bucket, input.key, null);
  }
}
