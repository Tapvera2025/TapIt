import type {
  ConnectorLike,
  InboundEvent,
  SendResult,
  WebhookRequest,
  WhatsAppDriver,
} from '../driver.js';
import { verifyBearer } from './shared.js';

interface GupshupBody {
  readonly app?: string;
  readonly type?: 'message' | 'message-event' | 'user-event';
  readonly payload?: {
    readonly id?: string;
    readonly type?: 'text' | 'image' | 'document' | 'audio' | 'video' | 'location';
    readonly source?: string;        // sender phone (E.164 without '+' per Gupshup)
    readonly destination?: string;   // business phone
    readonly payload?: { readonly text?: string; readonly caption?: string };
    readonly sender?: { readonly phone?: string; readonly name?: string };
    readonly timestamp?: number | string;
  };
}

function toE164(phoneDigits: string | undefined): string {
  if (!phoneDigits) return '';
  return phoneDigits.startsWith('+') ? phoneDigits : `+${phoneDigits}`;
}

export const gupshupDriver: WhatsAppDriver = {
  provider: 'gupshup',

  verifyWebhook(req: WebhookRequest, secret: string): boolean {
    return verifyBearer(req, secret);
  },

  parseInbound(body: unknown): InboundEvent[] {
    if (typeof body !== 'object' || body === null) return [];
    const typed = body as GupshupBody;
    const payload = typed.payload;
    const providerAccountId = typed.app ?? '';
    if (typed.type === 'message' && payload) {
      return [
        {
          type: 'message',
          messageId: payload.id ?? `gupshup-${Date.now()}`,
          providerAccountId,
          fromPhone: toE164(payload.sender?.phone ?? payload.source),
          toPhone: toE164(payload.destination),
          kind: (payload.type ?? 'text'),
          text: payload.payload?.text ?? payload.payload?.caption ?? null,
          sentAt: payload.timestamp ? new Date(Number(payload.timestamp) * 1000) : null,
          raw: payload,
        },
      ];
    }
    if (typed.type === 'message-event' && payload) {
      return [
        {
          type: 'status',
          messageId: payload.id ?? 'unknown',
          providerAccountId,
          status: 'delivered',
          recipientPhone: toE164(payload.destination),
        },
      ];
    }
    return [];
  },

  async sendText(connector: ConnectorLike, to: string, text: string): Promise<SendResult> {
    void connector; void to; void text;
    return { provider: 'gupshup', messageId: 'stub-pending-pilot-provider' };
  },

  async sendTemplate(connector, to, templateId, vars): Promise<SendResult> {
    void connector; void to; void templateId; void vars;
    return { provider: 'gupshup', messageId: 'stub-pending-pilot-provider' };
  },
};
