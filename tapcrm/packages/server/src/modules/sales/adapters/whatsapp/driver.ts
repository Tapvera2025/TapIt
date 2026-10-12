/**
 * Sales v1.1 — WhatsApp provider-agnostic adapter contract (R1 plan step 1.9).
 *
 * One driver interface per provider. The webhook route picks a driver
 * by the `:provider` path segment, hands it the raw body + headers, and
 * dispatches the normalized `InboundMessage[]` to the classifier and
 * canonical intake service.
 *
 * `verifyWebhook` and `parseInbound` are pure functions. `sendText` and
 * `sendTemplate` are stubs in R1: the outbound gating logic lives in
 * `outbound.ts`; the actual HTTP send to each provider lands when the
 * pilot's provider decision (plan open question O1) is made.
 */

import type { ApplicationError } from '../../../../errors.js';

export const WHATSAPP_PROVIDERS = ['meta_cloud', 'interakt', 'gupshup', 'twilio'] as const;
export type WhatsAppProvider = (typeof WHATSAPP_PROVIDERS)[number];

export function isWhatsAppProvider(value: string): value is WhatsAppProvider {
  return (WHATSAPP_PROVIDERS as readonly string[]).includes(value);
}

/** The subset of HTTP a driver needs for signature verification. */
export interface WebhookRequest {
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly url: string;
}

/**
 * Normalized inbound message. The classifier works on this shape; it
 * never looks at provider-specific JSON.
 */
export interface InboundMessage {
  /** Provider-reported message id. Used as the intake external key for idempotency. */
  readonly messageId: string;
  /** WABA phone-number-id, Interakt channel, Gupshup app, etc. Routes to a connector. */
  readonly providerAccountId: string;
  /** Sender in E.164 ("+919876543210") where possible; raw digits otherwise. */
  readonly fromPhone: string;
  /** Receiving business number (may be used for connector lookup). */
  readonly toPhone: string;
  readonly kind: 'text' | 'image' | 'document' | 'audio' | 'video' | 'contact' | 'location' | 'interactive' | 'other';
  readonly text: string | null;
  /** Provider timestamp if supplied. */
  readonly sentAt: Date | null;
  /** Original provider payload for durable storage; opaque to the classifier. */
  readonly raw: unknown;
}

/**
 * Status callback messages: delivered, read, failed. These are never
 * leads but must flow through the webhook pipeline so the driver gets a
 * chance to log them (and so Meta considers them acknowledged).
 */
export interface InboundStatus {
  readonly messageId: string;
  readonly providerAccountId: string;
  readonly status: 'sent' | 'delivered' | 'read' | 'failed';
  readonly recipientPhone: string;
}

export type InboundEvent =
  | ({ readonly type: 'message' } & InboundMessage)
  | ({ readonly type: 'status' } & InboundStatus);

export interface ConnectorLike {
  readonly id: string;
  readonly organizationId: string;
  readonly config: Record<string, unknown>;
}

export interface SendResult {
  readonly provider: WhatsAppProvider;
  readonly messageId: string;
}

export interface WhatsAppDriver {
  readonly provider: WhatsAppProvider;
  verifyWebhook(req: WebhookRequest, secret: string): boolean;
  parseInbound(body: unknown): InboundEvent[];
  sendText(connector: ConnectorLike, to: string, text: string): Promise<SendResult>;
  sendTemplate(
    connector: ConnectorLike,
    to: string,
    templateId: string,
    vars: Readonly<Record<string, string>>,
  ): Promise<SendResult>;
}

export class WhatsAppOutboundNotAllowedError extends Error implements Pick<ApplicationError, 'code' | 'status'> {
  readonly status = 422;
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'WhatsAppOutboundNotAllowedError';
  }
}
