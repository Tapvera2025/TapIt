import { describe, expect, it } from 'vitest';
import { validateIntake } from './validator.js';

describe('validateIntake — contact gating', () => {
  it('quarantines when neither phone nor email is present', () => {
    const result = validateIntake({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_contact');
  });

  it('accepts a payload with only email', () => {
    const result = validateIntake({ emailRaw: 'rahul@example.com' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contact.email).toBe('rahul@example.com');
      expect(result.contact.phoneE164).toBeNull();
    }
  });

  it('accepts an E.164 phone as-is', () => {
    const result = validateIntake({ phoneRaw: '+919876543210' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contact.phoneE164).toBe('+919876543210');
  });

  it('strips spaces and dashes from E.164 input', () => {
    const result = validateIntake({ phoneRaw: '+91 98765-43210' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contact.phoneE164).toBe('+919876543210');
  });
});

describe('validateIntake — phone normalisation with defaultCountryCode', () => {
  it('promotes a bare 10-digit number using the connector default', () => {
    const result = validateIntake({ phoneRaw: '9876543210' }, { defaultCountryCode: '91' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contact.phoneE164).toBe('+919876543210');
  });

  it('quarantines a bare number when no default is configured', () => {
    const result = validateIntake({ phoneRaw: '9876543210' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ambiguous_phone');
  });

  it('rejects garbage phone input', () => {
    const result = validateIntake({ phoneRaw: 'not a number' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_phone_format');
  });

  it('rejects malformed email', () => {
    const result = validateIntake({ emailRaw: 'not-an-email' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_email_format');
  });
});

describe('validateIntake — service gate', () => {
  it('passes when service is present and required', () => {
    const result = validateIntake(
      { emailRaw: 'r@x.com', serviceRequested: 'website' },
      { requireService: true },
    );
    expect(result.ok).toBe(true);
  });

  it('quarantines when service is absent and required', () => {
    const result = validateIntake({ emailRaw: 'r@x.com' }, { requireService: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_service');
  });

  it('ignores service when not required', () => {
    const result = validateIntake({ emailRaw: 'r@x.com' });
    expect(result.ok).toBe(true);
  });
});

describe('validateIntake — contact normalisation', () => {
  it('trims the contact name', () => {
    const result = validateIntake({ emailRaw: 'r@x.com', contactName: '  Rahul Shah  ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contact.fullName).toBe('Rahul Shah');
  });

  it('lowercases email', () => {
    const result = validateIntake({ emailRaw: 'Rahul@Example.COM' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contact.email).toBe('rahul@example.com');
  });
});
