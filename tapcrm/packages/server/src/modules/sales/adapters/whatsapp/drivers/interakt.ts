import type {
  ConnectorLike,
  InboundEvent,
  SendResult,
  WebhookRequest,
  WhatsAppDriver,
} from '../driver.js';
import { verifyBearer } from './shared.js';

interface InteraktBody {
  readonly type?: string;
  readonly data?: {
    readonly customer?: { readonly phone_number?: string; readonly country_code?: string };
    readonly message?: {
      readonly id?: string;
      readonly message?: string;
      readonly type?: string;
      readonly timestamp?: string | number;
    };
    readonly status?: string;
    readonly waba_number?: string;
    readonly phone_number_id?: string;
  };
}

export const interaktDriver: WhatsAppDriver = {
  provider: 'interakt',

  verifyWebhook(req: WebhookRequest, secret: string): boolean {
    return verifyBearer(req, secret);
  },

  parseInbound(body: unknown): InboundEvent[] {
    if (typeof body !== 'object' || body === null) return [];
    const typed = body as InteraktBody;
    const data = typed.data;
    if (!data) return [];
    const providerAccountId = data.phone_number_id ?? data.waba_number ?? '';
    const customer = data.customer;
    const phone = customer?.phone_number ?? '';
    const countryCode = customer?.country_code ?? '';
    const fromPhone = phone.startsWith('+') ? phone : `+${countryCode}${phone}`.replace(/\+{2,}/, '+');
    if (typed.type === 'message' && data.message) {
      const m = data.message;
      return [
        {
          type: 'message',
          messageId: m.id ?? `interakt-${Date.now()}`,
          providerAccountId,
          fromPhone,
          toPhone: data.waba_number ?? '',
          kind: (m.type as 'text' | 'image' | 'document') ?? 'text',
          text: m.message ?? null,
          sentAt: m.timestamp ? new Date(Number(m.timestamp) * 1000) : null,
          raw: m,
        },
      ];
    }
    if (typed.type === 'status' && data.status) {
      const status = data.status.toLowerCase();
      const normalized = (status === 'sent' || status === 'delivered' || status === 'read' || status === 'failed') ? status : 'sent';
      return [
        {
          type: 'status',
          messageId: data.message?.id ?? 'unknown',
          providerAccountId,
          status: normalized as 'sent' | 'delivered' | 'read' | 'failed',
          recipientPhone: fromPhone,
        },
      ];
    }
    return [];
  },

  async sendText(connector: ConnectorLike, to: string, text: string): Promise<SendResult> {
    void connector; void to; void text;
    return { provider: 'interakt', messageId: 'stub-pending-pilot-provider' };
  },

  async sendTemplate(connector, to, templateId, vars): Promise<SendResult> {
    void connector; void to; void templateId; void vars;
    return { provider: 'interakt', messageId: 'stub-pending-pilot-provider' };
  },
};
