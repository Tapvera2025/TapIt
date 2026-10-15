import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { metaCloudDriver } from './meta-cloud.js';
import type { WebhookRequest } from '../driver.js';

function req(body: Buffer, header: string | undefined): WebhookRequest {
  return { rawBody: body, headers: { 'x-hub-signature-256': header }, url: 'https://api/webhook' };
}

const SAMPLE_INBOUND = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '1234567890',
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { display_phone_number: '+15555550123', phone_number_id: 'PNID-ABC' },
            messages: [
              {
                id: 'wamid.abc123',
                from: '919876543210',
                timestamp: '1700000000',
                type: 'text',
                text: { body: 'Hello, I need a website' },
              },
            ],
          },
        },
      ],
    },
  ],
};

describe('metaCloudDriver.verifyWebhook', () => {
  const secret = 'meta-cloud-app-secret-abcdef1234567890';
  const bytes = Buffer.from(JSON.stringify(SAMPLE_INBOUND));
  const expected = 'sha256=' + createHmac('sha256', secret).update(bytes).digest('hex');

  it('accepts a correct sha256 signature', () => {
    expect(metaCloudDriver.verifyWebhook(req(bytes, expected), secret)).toBe(true);
  });
  it('rejects a tampered body', () => {
    expect(metaCloudDriver.verifyWebhook(req(Buffer.concat([bytes, Buffer.from(' ')]), expected), secret)).toBe(false);
  });
  it('rejects a header missing the sha256= prefix', () => {
    const hex = createHmac('sha256', secret).update(bytes).digest('hex');
    expect(metaCloudDriver.verifyWebhook(req(bytes, hex), secret)).toBe(false);
  });
});

describe('metaCloudDriver.parseInbound', () => {
  it('parses a text message into a normalized InboundMessage', () => {
    const events = metaCloudDriver.parseInbound(SAMPLE_INBOUND);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'message',
      messageId: 'wamid.abc123',
      providerAccountId: 'PNID-ABC',
      fromPhone: '919876543210',
      toPhone: '+15555550123',
      kind: 'text',
      text: 'Hello, I need a website',
    });
  });

  it('parses a status receipt into an InboundStatus', () => {
    const events = metaCloudDriver.parseInbound({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'x',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'PNID-ABC' },
                statuses: [{ id: 'wamid.1', status: 'delivered', recipient_id: '919876543210' }],
              },
            },
          ],
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'status', status: 'delivered' });
  });

  it('returns [] for unrelated change fields', () => {
    expect(
      metaCloudDriver.parseInbound({ entry: [{ id: 'x', changes: [{ field: 'feed', value: {} }] }] }),
    ).toEqual([]);
  });
});
