import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { extractLeadgenEvents, verifyMetaSignature, MetaMalformedNotificationError } from './service.js';

function metaHeader(secret: string, body: Buffer): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyMetaSignature', () => {
  const secret = 'app-secret-with-plenty-of-entropy';
  const body = Buffer.from(JSON.stringify({ object: 'page', entry: [] }));

  it('accepts the sha256=<hex> header produced by the app secret', () => {
    expect(verifyMetaSignature(secret, body, metaHeader(secret, body))).toBe(true);
  });

  it('rejects when the body changes by a single byte', () => {
    const tampered = Buffer.concat([body, Buffer.from(' ')]);
    expect(verifyMetaSignature(secret, tampered, metaHeader(secret, body))).toBe(false);
  });

  it('rejects a header without the sha256= prefix', () => {
    const hex = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyMetaSignature(secret, body, hex)).toBe(false);
  });

  it('rejects a header with a different algorithm name', () => {
    const hex = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyMetaSignature(secret, body, `sha1=${hex}`)).toBe(false);
  });

  it('rejects an empty, null or non-hex header', () => {
    expect(verifyMetaSignature(secret, body, '')).toBe(false);
    expect(verifyMetaSignature(secret, body, null)).toBe(false);
    expect(verifyMetaSignature(secret, body, undefined)).toBe(false);
    expect(verifyMetaSignature(secret, body, 'sha256=not-hex')).toBe(false);
  });
});

describe('extractLeadgenEvents', () => {
  it('returns a leadgen event per change with field="leadgen"', () => {
    const events = extractLeadgenEvents({
      object: 'page',
      entry: [
        {
          id: 'page-123',
          time: 1700000000,
          changes: [
            {
              field: 'leadgen',
              value: {
                leadgen_id: 'lg-1',
                form_id: 'f-1',
                page_id: 'page-123',
                created_time: 1700000000,
              },
            },
            {
              field: 'leadgen',
              value: {
                leadgen_id: 'lg-2',
                form_id: 'f-1',
                page_id: 'page-123',
                created_time: '2024-01-01T00:00:00Z',
              },
            },
          ],
        },
      ],
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ leadgenId: 'lg-1', pageId: 'page-123', formId: 'f-1' });
    expect(events[1]).toMatchObject({ leadgenId: 'lg-2', createdTime: '2024-01-01T00:00:00Z' });
  });

  it('skips changes that are not leadgen events', () => {
    const events = extractLeadgenEvents({
      object: 'page',
      entry: [{ id: 'page-123', changes: [{ field: 'feed', value: {} }] }],
    });
    expect(events).toEqual([]);
  });

  it('throws MetaMalformedNotificationError when the top-level shape is wrong', () => {
    expect(() => extractLeadgenEvents({ nope: true })).toThrow(MetaMalformedNotificationError);
  });
});
