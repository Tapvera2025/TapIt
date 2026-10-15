import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ConnectorLike,
  InboundEvent,
  SendResult,
  WebhookRequest,
  WhatsAppDriver,
} from '../driver.js';

/**
 * WhatsApp Business API via Meta Cloud (graph.facebook.com/v18.0/...).
 * Signature header: `X-Hub-Signature-256: sha256=<hex>`. The driver's
 * `secret` is the Meta app secret (same shape as the Lead Ads adapter).
 */

function verifyMetaCloudSignature(secret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!secret || !header) return false;
  const [algo, hex] = header.trim().split('=', 2);
  if (algo !== 'sha256' || !hex || !/^[0-9a-f]+$/i.test(hex)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const lowered = hex.toLowerCase();
  if (expected.length !== lowered.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(lowered, 'utf8'));
}

interface MetaCloudEntry {
  readonly id?: string;
  readonly changes?: Array<{
    readonly field?: string;
    readonly value?: {
      readonly metadata?: {
        readonly display_phone_number?: string;
        readonly phone_number_id?: string;
      };
      readonly messages?: Array<{
        readonly id: string;
        readonly from: string;
        readonly timestamp?: string;
        readonly type?: string;
        readonly text?: { readonly body?: string };
        readonly image?: { readonly caption?: string };
        readonly document?: { readonly caption?: string };
        readonly interactive?: {
          readonly type?: string;
          readonly button_reply?: { readonly title?: string };
          readonly list_reply?: { readonly title?: string };
        };
      }>;
      readonly statuses?: Array<{
        readonly id: string;
        readonly status: string;
        readonly recipient_id: string;
      }>;
    };
  }>;
}

interface MetaCloudBody {
  readonly object?: string;
  readonly entry?: readonly MetaCloudEntry[];
}

type InboundMessageKind = 'text' | 'image' | 'document' | 'audio' | 'video' | 'contact' | 'location' | 'interactive' | 'other';

type MetaCloudMessage = NonNullable<NonNullable<NonNullable<MetaCloudEntry['changes']>[number]['value']>['messages']>[number];

function extractText(message: MetaCloudMessage): string | null {
  if (message.text?.body) return message.text.body;
  if (message.image?.caption) return message.image.caption;
  if (message.document?.caption) return message.document.caption;
  const interactive = message.interactive;
  if (interactive) {
    return interactive.button_reply?.title ?? interactive.list_reply?.title ?? null;
  }
  return null;
}

const KNOWN_KINDS: readonly InboundMessageKind[] = [
  'text', 'image', 'document', 'audio', 'video', 'contact', 'location', 'interactive',
];
function mapKind(type: string | undefined): InboundMessageKind {
  const t = (type ?? 'text') as InboundMessageKind;
  return KNOWN_KINDS.includes(t) ? t : 'other';
}

export const metaCloudDriver: WhatsAppDriver = {
  provider: 'meta_cloud',

  verifyWebhook(req: WebhookRequest, secret: string): boolean {
    return verifyMetaCloudSignature(secret, req.rawBody, req.headers['x-hub-signature-256']);
  },

  parseInbound(body: unknown): InboundEvent[] {
    if (typeof body !== 'object' || body === null) return [];
    const typed = body as MetaCloudBody;
    const events: InboundEvent[] = [];
    for (const entry of typed.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id ?? entry.id ?? '';
        const businessPhone = value?.metadata?.display_phone_number ?? '';
        for (const message of value?.messages ?? []) {
          events.push({
            type: 'message',
            messageId: message.id,
            providerAccountId: phoneNumberId,
            fromPhone: message.from,
            toPhone: businessPhone,
            kind: mapKind(message.type),
            text: extractText(message),
            sentAt: message.timestamp ? new Date(Number(message.timestamp) * 1000) : null,
            raw: message,
          });
        }
        for (const status of value?.statuses ?? []) {
          events.push({
            type: 'status',
            messageId: status.id,
            providerAccountId: phoneNumberId,
            status: (status.status === 'sent' || status.status === 'delivered' || status.status === 'read' || status.status === 'failed')
              ? status.status
              : 'sent',
            recipientPhone: status.recipient_id,
          });
        }
      }
    }
    return events;
  },

  async sendText(connector: ConnectorLike, to: string, text: string): Promise<SendResult> {
    void connector; void to; void text;
    return { provider: 'meta_cloud', messageId: 'stub-pending-pilot-provider' };
  },

  async sendTemplate(connector, to, templateId, vars): Promise<SendResult> {
    void connector; void to; void templateId; void vars;
    return { provider: 'meta_cloud', messageId: 'stub-pending-pilot-provider' };
  },
};
