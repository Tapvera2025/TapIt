import { describe, expect, it } from 'vitest';
import { classifyInbound } from './classifier.js';
import type { InboundEvent } from './driver.js';

function textEvent(text: string | null): InboundEvent {
  return {
    type: 'message',
    messageId: 'm1',
    providerAccountId: 'wa',
    fromPhone: '+919876543210',
    toPhone: '+15555550123',
    kind: 'text',
    text,
    sentAt: null,
    raw: {},
  };
}

describe('classifyInbound', () => {
  it('flags delivery / read receipts as status_receipt', () => {
    const verdict = classifyInbound({
      type: 'status',
      messageId: 'm1',
      providerAccountId: 'wa',
      status: 'delivered',
      recipientPhone: '+919876543210',
    });
    expect(verdict.verdict).toBe('status_receipt');
  });

  it('flags null/empty text as empty_message', () => {
    expect(classifyInbound(textEvent(null)).verdict).toBe('empty_message');
    expect(classifyInbound(textEvent('   ')).verdict).toBe('empty_message');
  });

  it('flags one-word greetings as greeting_only', () => {
    expect(classifyInbound(textEvent('hi')).verdict).toBe('greeting_only');
    expect(classifyInbound(textEvent('Hello')).verdict).toBe('greeting_only');
    expect(classifyInbound(textEvent('hey!')).verdict).toBe('greeting_only');
  });

  it('flags substantive text as enquiry', () => {
    expect(classifyInbound(textEvent('I need a website for my clinic')).verdict).toBe('enquiry');
    expect(classifyInbound(textEvent('hi, I need SEO services')).verdict).toBe('enquiry');
  });
});
