import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ConnectorLike,
  InboundEvent,
  SendResult,
  WebhookRequest,
  WhatsAppDriver,
} from '../driver.js';

/**
 * Twilio signs an HMAC-SHA1 of (fullUrl + sortedFormParams) with the
 * auth-token as the secret. Base64 digest in `X-Twilio-Signature`.
 */
function verifyTwilioSignature(authToken: string, req: WebhookRequest): boolean {
  const signature = req.headers['x-twilio-signature'];
  if (!authToken || !signature) return false;
  // The webhook route passes rawBody as the serialized params. For
  // form-encoded Twilio webhooks, body is `key=value&key2=value2`. We
  // reconstruct the input the Twilio docs describe: fullUrl + sorted(k+v).
  const params = Object.fromEntries(new URLSearchParams(req.rawBody.toString('utf8')));
  const sortedKeys = Object.keys(params).sort();
  const serialized = sortedKeys.map((k) => k + (params[k] ?? '')).join('');
  const input = req.url + serialized;
  const expected = createHmac('sha1', authToken).update(input).digest('base64');
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
}

export const twilioDriver: WhatsAppDriver = {
  provider: 'twilio',

  verifyWebhook(req: WebhookRequest, secret: string): boolean {
    return verifyTwilioSignature(secret, req);
  },

  parseInbound(body: unknown): InboundEvent[] {
    if (typeof body !== 'object' || body === null) return [];
    const typed = body as Record<string, string | undefined>;
    const messageSid = typed['MessageSid'];
    if (!messageSid) return [];
    const from = (typed['From'] ?? '').replace(/^whatsapp:/, '');
    const to = (typed['To'] ?? '').replace(/^whatsapp:/, '');
    const status = typed['MessageStatus']?.toLowerCase();
    if (status === 'delivered' || status === 'read' || status === 'sent' || status === 'failed') {
      return [
        {
          type: 'status',
          messageId: messageSid,
          providerAccountId: to,
          status,
          recipientPhone: to,
        },
      ];
    }
    return [
      {
        type: 'message',
        messageId: messageSid,
        providerAccountId: to,
        fromPhone: from,
        toPhone: to,
        kind: 'text',
        text: typed['Body'] ?? null,
        sentAt: null,
        raw: typed,
      },
    ];
  },

  async sendText(connector: ConnectorLike, to: string, text: string): Promise<SendResult> {
    void connector; void to; void text;
    return { provider: 'twilio', messageId: 'stub-pending-pilot-provider' };
  },

  async sendTemplate(connector, to, templateId, vars): Promise<SendResult> {
    void connector; void to; void templateId; void vars;
    return { provider: 'twilio', messageId: 'stub-pending-pilot-provider' };
  },
};
