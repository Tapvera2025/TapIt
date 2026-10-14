import { describe, expect, it } from 'vitest';
import { interaktDriver } from './interakt.js';
import { gupshupDriver } from './gupshup.js';
import { twilioDriver } from './twilio.js';

describe('interaktDriver.parseInbound', () => {
  it('normalizes a text message with E.164 derived from country_code', () => {
    const events = interaktDriver.parseInbound({
      type: 'message',
      data: {
        waba_number: '15555550123',
        phone_number_id: 'INTK-PNID',
        customer: { phone_number: '9876543210', country_code: '91' },
        message: { id: 'intk-1', message: 'Hi, need website', type: 'text', timestamp: '1700000000' },
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'message',
      messageId: 'intk-1',
      providerAccountId: 'INTK-PNID',
      fromPhone: '+919876543210',
      text: 'Hi, need website',
    });
  });

  it('maps a status event to a normalized delivery receipt', () => {
    const events = interaktDriver.parseInbound({
      type: 'status',
      data: {
        waba_number: '1555',
        phone_number_id: 'INTK-PNID',
        customer: { phone_number: '9876543210', country_code: '91' },
        status: 'delivered',
      },
    });
    expect(events[0]).toMatchObject({ type: 'status', status: 'delivered' });
  });
});

describe('gupshupDriver.parseInbound', () => {
  it('normalizes a Gupshup message payload', () => {
    const events = gupshupDriver.parseInbound({
      app: 'app-id',
      type: 'message',
      payload: {
        id: 'gs-1',
        type: 'text',
        source: '919876543210',
        destination: '15555550123',
        payload: { text: 'Need SEO services' },
        sender: { phone: '919876543210' },
        timestamp: 1700000000,
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      messageId: 'gs-1',
      fromPhone: '+919876543210',
      toPhone: '+15555550123',
      text: 'Need SEO services',
    });
  });
});

describe('twilioDriver.parseInbound', () => {
  it('extracts WhatsApp sender/recipient from the whatsapp: prefix', () => {
    const events = twilioDriver.parseInbound({
      MessageSid: 'SM123',
      From: 'whatsapp:+919876543210',
      To: 'whatsapp:+15555550123',
      Body: 'Hey there',
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'message',
      messageId: 'SM123',
      fromPhone: '+919876543210',
      toPhone: '+15555550123',
      text: 'Hey there',
    });
  });

  it('maps MessageStatus=delivered to a status receipt', () => {
    const events = twilioDriver.parseInbound({
      MessageSid: 'SM123',
      From: 'whatsapp:+15555550123',
      To: 'whatsapp:+919876543210',
      MessageStatus: 'delivered',
    });
    expect(events[0]).toMatchObject({ type: 'status', status: 'delivered' });
  });
});
