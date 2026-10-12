import { describe, expect, it } from 'vitest';
import { assertOutboundAllowed, WHATSAPP_SERVICE_WINDOW_MS } from './outbound.js';
import { WhatsAppOutboundNotAllowedError } from './driver.js';

function expectCode(fn: () => void, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(WhatsAppOutboundNotAllowedError);
    expect((err as WhatsAppOutboundNotAllowedError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code} but no error was thrown`);
}

const now = new Date('2024-06-10T12:00:00Z');

describe('assertOutboundAllowed', () => {
  it('passes when consent is granted and we are inside the 24-hour window', () => {
    expect(() =>
      assertOutboundAllowed({
        consentGranted: true,
        optedOut: false,
        lastInboundAt: new Date(now.getTime() - 60 * 60_000),
        templateId: undefined,
        templateApprovedIds: new Set(),
        now,
      }),
    ).not.toThrow();
  });

  it('rejects an opted-out contact regardless of other state', () => {
    expectCode(
      () =>
        assertOutboundAllowed({
          consentGranted: true,
          optedOut: true,
          lastInboundAt: now,
          templateId: 'welcome',
          templateApprovedIds: new Set(['welcome']),
          now,
        }),
      'CONTACT_OPTED_OUT',
    );
  });

  it('rejects when consent is missing', () => {
    expectCode(
      () =>
        assertOutboundAllowed({
          consentGranted: false,
          optedOut: false,
          lastInboundAt: now,
          templateId: undefined,
          templateApprovedIds: new Set(),
          now,
        }),
      'CONSENT_REQUIRED',
    );
  });

  it('rejects a plain text send outside the 24h window with TEMPLATE_REQUIRED', () => {
    expectCode(
      () =>
        assertOutboundAllowed({
          consentGranted: true,
          optedOut: false,
          lastInboundAt: new Date(now.getTime() - WHATSAPP_SERVICE_WINDOW_MS - 1),
          templateId: undefined,
          templateApprovedIds: new Set(['welcome']),
          now,
        }),
      'TEMPLATE_REQUIRED',
    );
  });

  it('passes an approved template send outside the 24h window', () => {
    expect(() =>
      assertOutboundAllowed({
        consentGranted: true,
        optedOut: false,
        lastInboundAt: new Date(now.getTime() - 48 * 60 * 60_000),
        templateId: 'welcome',
        templateApprovedIds: new Set(['welcome']),
        now,
      }),
    ).not.toThrow();
  });

  it('rejects a template that is not in the approved set', () => {
    expectCode(
      () =>
        assertOutboundAllowed({
          consentGranted: true,
          optedOut: false,
          lastInboundAt: null,
          templateId: 'draft_template',
          templateApprovedIds: new Set(['welcome']),
          now,
        }),
      'TEMPLATE_NOT_APPROVED',
    );
  });

  it('rejects a plain text send when no inbound has ever been received', () => {
    expectCode(
      () =>
        assertOutboundAllowed({
          consentGranted: true,
          optedOut: false,
          lastInboundAt: null,
          templateId: undefined,
          templateApprovedIds: new Set(),
          now,
        }),
      'TEMPLATE_REQUIRED',
    );
  });
});
