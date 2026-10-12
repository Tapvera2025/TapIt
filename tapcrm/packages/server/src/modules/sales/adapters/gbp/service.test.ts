import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyExotelSignature } from './service.js';

function sign(secret: string, url: string, params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort();
  const serialized = sortedKeys.map((k) => k + (params[k] ?? '')).join('');
  return createHmac('sha1', secret).update(url + serialized).digest('base64');
}

describe('verifyExotelSignature', () => {
  const secret = 'exotel-shared-secret-abcdef123456';
  const url = 'https://api.tapcrm.io/api/webhooks/gbp-call';
  const params = {
    CallSid: 'CA123',
    From: '+919876543210',
    To: '+911122334455',
    Status: 'answered',
    StartTime: '2024-01-01T00:00:00Z',
  };

  it('accepts the Twilio-style HMAC-SHA1 base64 signature', () => {
    expect(verifyExotelSignature(secret, url, params, sign(secret, url, params))).toBe(true);
  });

  it('rejects when any parameter changes', () => {
    const tampered = { ...params, Status: 'missed' };
    expect(verifyExotelSignature(secret, url, tampered, sign(secret, url, params))).toBe(false);
  });

  it('rejects when the URL changes', () => {
    expect(verifyExotelSignature(secret, 'https://other/url', params, sign(secret, url, params))).toBe(false);
  });

  it('rejects when the signature length does not match', () => {
    const sig = sign(secret, url, params);
    expect(verifyExotelSignature(secret, url, params, sig.slice(0, -2))).toBe(false);
  });

  it('rejects empty or missing signatures', () => {
    expect(verifyExotelSignature(secret, url, params, '')).toBe(false);
    expect(verifyExotelSignature(secret, url, params, undefined)).toBe(false);
  });
});
