import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetConfig, loadConfig } from '../../config.js';
import { MinioStorageProvider } from './minio.provider.js';

/**
 * Signed download links (SE-6). The expected URL was produced independently
 * by botocore 1.35 (`generate_presigned_url`, path-style addressing, the same
 * credentials, key, instant and expiry), so this checks the signature, not
 * just the shape.
 */
const ENV = {
  DATABASE_URL: 'postgres://app:pw@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  S3_ENDPOINT: 'https://files.example.com',
  S3_REGION: 'ap-south-1',
  S3_BUCKET: 'tapcrm-files',
  S3_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  S3_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};

describe('presigned download links', () => {
  afterEach(() => __resetConfig());

  it('matches an independent SigV4 implementation', () => {
    __resetConfig();
    loadConfig(ENV);
    const url = new MinioStorageProvider().presignedGetUrl({
      bucket: 'files',
      key: 'attendance-exports/org 1/job.csv',
      expiresInSeconds: 900,
      now: new Date('2026-09-25T10:00:00Z'),
    });
    expect(url).toBe(
      'https://files.example.com/tapcrm-files/attendance-exports/org%201/job.csv' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIDEXAMPLE%2F20260925%2Fap-south-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20260925T100000Z&X-Amz-Expires=900&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=05fd352ef0b1c6c542f2b3fe786e968928c8052c72198564ac6b29ab1de8b7b0',
    );
  });

  it('signs for the public address when one is set', () => {
    __resetConfig();
    loadConfig({ ...ENV, S3_PUBLIC_ENDPOINT: 'https://downloads.example.com' });
    const url = new MinioStorageProvider().presignedGetUrl({
      bucket: 'files',
      key: 'a.csv',
      expiresInSeconds: 900,
      now: new Date('2026-09-25T10:00:00Z'),
    });
    expect(url.startsWith('https://downloads.example.com/tapcrm-files/a.csv?')).toBe(
      true,
    );
  });
});

describe('MinioStorageProvider putObject', () => {
  afterEach(() => {
    __resetConfig();
    vi.restoreAllMocks();
  });

  it('correctly sets and signs the provided content-type header for document uploads', async () => {
    __resetConfig();
    loadConfig(ENV);

    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;
    let capturedHeaders: Headers | undefined;
    let capturedBody: unknown;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      capturedUrl = input.toString();
      capturedMethod = init?.method;
      capturedHeaders = new Headers(init?.headers as any);
      capturedBody = init?.body;
      return new Response('', { status: 200 });
    });

    const body = Buffer.from('%PDF-1.4 test document content');
    const provider = new MinioStorageProvider();
    const result = await provider.putObject({
      bucket: 'files',
      key: 'verification/org-1/emp-1/PAN/doc.pdf',
      body,
      contentType: 'application/pdf',
    });

    expect(result.checksumSha256).toBeDefined();
    expect(capturedMethod).toBe('PUT');
    expect(capturedUrl).toBe('https://files.example.com/tapcrm-files/verification/org-1/emp-1/PAN/doc.pdf');
    expect(capturedHeaders?.get('content-type')).toBe('application/pdf');
    expect(capturedHeaders?.get('x-amz-meta-checksum-sha256')).toBe(result.checksumSha256);
    expect(capturedHeaders?.get('authorization')).toContain('SignedHeaders=');
    expect(capturedHeaders?.get('authorization')).toContain('content-type');
    expect(capturedBody).toEqual(body);
  });

  it('includes storage error details when S3 request fails', async () => {
    __resetConfig();
    loadConfig(ENV);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }),
    );

    const provider = new MinioStorageProvider();
    await expect(
      provider.putObject({
        bucket: 'files',
        key: 'test.pdf',
        body: Buffer.from('content'),
        contentType: 'application/pdf',
      }),
    ).rejects.toThrow(/HTTP 403.*AccessDenied/);
  });
});
