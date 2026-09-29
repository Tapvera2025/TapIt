import { afterEach, describe, expect, it } from 'vitest';
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
