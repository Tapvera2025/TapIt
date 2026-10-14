/**
 * Sales v1.1 — WhatsApp outbound gating (R1 plan step 1.9).
 *
 * WhatsApp's business rule: outside the 24-hour customer-service window
 * (last inbound message > 24h ago), outbound must use an approved
 * template. Consent must be in place; opted-out contacts never receive
 * outbound. Pure function so route handlers test it without a provider.
 */

import { WhatsAppOutboundNotAllowedError } from './driver.js';

export const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface OutboundRequest {
  readonly consentGranted: boolean;
  readonly optedOut: boolean;
  readonly lastInboundAt: Date | null;
  /** `undefined` for free-form sendText; a template id for sendTemplate. */
  readonly templateId: string | undefined;
  readonly templateApprovedIds: ReadonlySet<string>;
  readonly now: Date;
}

export function assertOutboundAllowed(req: OutboundRequest): void {
  if (req.optedOut) {
    throw new WhatsAppOutboundNotAllowedError(
      'CONTACT_OPTED_OUT',
      'Contact has opted out of WhatsApp communication',
    );
  }
  if (!req.consentGranted) {
    throw new WhatsAppOutboundNotAllowedError(
      'CONSENT_REQUIRED',
      'Contact consent for WhatsApp has not been recorded',
    );
  }
  const insideWindow =
    req.lastInboundAt !== null && req.now.getTime() - req.lastInboundAt.getTime() < WHATSAPP_SERVICE_WINDOW_MS;
  if (insideWindow && req.templateId === undefined) return;
  if (req.templateId === undefined) {
    throw new WhatsAppOutboundNotAllowedError(
      'TEMPLATE_REQUIRED',
      'Outside the 24-hour customer-service window; an approved template is required',
    );
  }
  if (!req.templateApprovedIds.has(req.templateId)) {
    throw new WhatsAppOutboundNotAllowedError(
      'TEMPLATE_NOT_APPROVED',
      `Template "${req.templateId}" is not in the approved list`,
    );
  }
}
