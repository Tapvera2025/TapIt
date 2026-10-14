import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyHmacSignature, websiteBodySchema } from './service.js';

function signHex(secret: string, body: Buffer): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyHmacSignature', () => {
  const secret = 'test-secret-with-enough-entropy';
  const body = Buffer.from(JSON.stringify({ submissionUUID: 'abc', phoneRaw: '+919876543210' }));

  it('accepts a signature produced by the same secret and body', () => {
    expect(verifyHmacSignature(secret, body, signHex(secret, body))).toBe(true);
  });

  it('rejects when the secret differs', () => {
    expect(verifyHmacSignature(secret, body, signHex('different-secret', body))).toBe(false);
  });

  it('rejects when the body differs by a single byte', () => {
    const tampered = Buffer.concat([body, Buffer.from(' ')]);
    expect(verifyHmacSignature(secret, tampered, signHex(secret, body))).toBe(false);
  });

  it('is case-insensitive on the hex header but rejects non-hex content', () => {
    const sig = signHex(secret, body);
    expect(verifyHmacSignature(secret, body, sig.toUpperCase())).toBe(true);
    expect(verifyHmacSignature(secret, body, 'not-hex')).toBe(false);
  });

  it('rejects an empty or missing signature header', () => {
    expect(verifyHmacSignature(secret, body, '')).toBe(false);
    expect(verifyHmacSignature(secret, body, null)).toBe(false);
    expect(verifyHmacSignature(secret, body, undefined)).toBe(false);
  });

  it('rejects when the signature length differs even if the hex prefix matches', () => {
    const sig = signHex(secret, body);
    expect(verifyHmacSignature(secret, body, sig.slice(0, -2))).toBe(false);
  });
});

describe('websiteBodySchema', () => {
  it('requires submissionUUID', () => {
    const parsed = websiteBodySchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it('trims fields and preserves unknown keys', () => {
    const parsed = websiteBodySchema.parse({
      submissionUUID: '  abc-123  ',
      contactName: ' Rahul ',
      extra: 'preserved',
    });
    expect(parsed.submissionUUID).toBe('abc-123');
    expect(parsed.contactName).toBe('Rahul');
    expect((parsed as Record<string, unknown>)['extra']).toBe('preserved');
  });
});
