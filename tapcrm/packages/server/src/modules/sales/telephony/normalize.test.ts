import { describe, expect, it } from 'vitest';
import {
  cleanEmail,
  formatProviderDateTime,
  nameList,
  normalizePhone,
  outcomeFromLabel,
  parseTimestamp,
  parseUtcDateTime,
  phoneList,
  toSeconds,
} from './normalize.js';

describe('telephony normalize helpers', () => {
  it('reads seconds from numbers, numeric strings and clock strings', () => {
    expect(toSeconds(83)).toBe(83);
    expect(toSeconds(12.6)).toBe(13);
    expect(toSeconds('45')).toBe(45);
    expect(toSeconds('00:01:23')).toBe(83);
    expect(toSeconds('02:05')).toBe(125);
    expect(toSeconds('1:00:00')).toBe(3600);
    expect(toSeconds(-4)).toBeNull();
    expect(toSeconds('soon')).toBeNull();
    expect(toSeconds(null)).toBeNull();
  });

  it('normalizes phone numbers so the same number written two ways compares equal', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
    expect(normalizePhone('+33 6 12 34 56 78')).toBe('+33612345678');
    expect(normalizePhone('919876543210')).toBe('+919876543210');
    expect(normalizePhone('0044 20 7946 0958')).toBe('+442079460958');
    expect(normalizePhone('9876543210')).toBe('9876543210');
    expect(normalizePhone(14155550123)).toBe('+14155550123');
    expect(normalizePhone('anonymous')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });

  it('accepts only plausible emails, lowercased', () => {
    expect(cleanEmail('  Asha.Rao@Example.COM ')).toBe('asha.rao@example.com');
    expect(cleanEmail('not an email')).toBeNull();
    expect(cleanEmail(42)).toBeNull();
  });

  it('parses JustCall UTC date and time pairs', () => {
    expect(parseUtcDateTime('2026-10-30', '14:05:09')?.toISOString()).toBe('2026-10-30T14:05:09.000Z');
    expect(parseUtcDateTime('2026-10-30', '14:05')?.toISOString()).toBe('2026-10-30T14:05:00.000Z');
    expect(parseUtcDateTime('30/10/2026', '14:05:09')).toBeNull();
    expect(parseUtcDateTime(undefined, '14:05:09')).toBeNull();
  });

  it('parses Aircall UNIX seconds, millisecond slips and ISO strings', () => {
    expect(parseTimestamp(1793365200)?.toISOString()).toBe('2026-10-30T13:00:00.000Z');
    expect(parseTimestamp('1793365200')?.toISOString()).toBe('2026-10-30T13:00:00.000Z');
    expect(parseTimestamp(1793365200000)?.toISOString()).toBe('2026-10-30T13:00:00.000Z');
    expect(parseTimestamp('2026-10-30T13:00:00Z')?.toISOString()).toBe('2026-10-30T13:00:00.000Z');
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp(0)).toBeNull();
  });

  it('formats the date-time JustCall filters take', () => {
    expect(formatProviderDateTime(new Date('2026-01-05T03:04:05Z'))).toBe('2026-01-05 03:04:05');
  });

  it('maps provider result labels onto CRM outcomes', () => {
    expect(outcomeFromLabel('Answered', 'inbound')).toBe('answered');
    expect(outcomeFromLabel('Unanswered', 'outbound')).toBe('unanswered');
    expect(outcomeFromLabel('Missed', 'inbound')).toBe('missed');
    expect(outcomeFromLabel('Voicemail', 'inbound')).toBe('voicemail');
    expect(outcomeFromLabel('Abandoned before ringing', 'inbound')).toBe('abandoned');
    expect(outcomeFromLabel('INCOMING_ANSWERED', 'inbound')).toBe('answered');
    expect(outcomeFromLabel('INCOMING_MISSED', 'inbound')).toBe('missed');
    expect(outcomeFromLabel('INCOMING_VOICEMAIL', 'inbound')).toBe('voicemail');
    expect(outcomeFromLabel('OUTGOING_UNANSWERED', 'outbound')).toBe('unanswered');
    expect(outcomeFromLabel('OUTGOING_BUSY', 'outbound')).toBe('busy');
    expect(outcomeFromLabel('OUTGOING_FAILED', 'outbound')).toBe('failed');
    expect(outcomeFromLabel('OUTGOING_BLOCKED', 'outbound')).toBe('failed');
    expect(outcomeFromLabel('OUTGOING_CANCELLED', 'outbound')).toBe('unanswered');
    expect(outcomeFromLabel(null, 'outbound')).toBe('other');
    expect(outcomeFromLabel('Something new', 'outbound')).toBe('other');
  });

  it('collects names from strings, objects and id → name maps', () => {
    expect(nameList(['Sales', { name: 'Support' }, { label: 'VIP' }, 'Sales'])).toEqual(['Sales', 'Support', 'VIP']);
    expect(nameList({ 12: 'Inbound team', 13: { name: 'Outbound team' } })).toEqual(['Inbound team', 'Outbound team']);
    expect(nameList(null)).toEqual([]);
  });

  it('collects phone numbers from strings and number objects', () => {
    expect(phoneList(['+1 415 555 0123', { digits: '+44 20 7946 0958' }, '+1 (415) 555-0123'])).toEqual([
      '+14155550123',
      '+442079460958',
    ]);
  });
});
