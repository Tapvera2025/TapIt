import { describe, expect, it } from 'vitest';
import {
  buildDuplicateQuery,
  generateIdempotencyKey,
  hasEnoughInputForLookup,
  normalizeEmailForLookup,
  normalizePhoneForLookup,
  offerDuplicateChoices,
} from './addLead-helpers.js';

describe('normalizePhoneForLookup', () => {
  it('accepts a valid E.164 phone', () => {
    expect(normalizePhoneForLookup('+919876543210')).toBe('+919876543210');
    expect(normalizePhoneForLookup('  +91 98765 43210 ')).toBe('+919876543210');
  });
  it('rejects a number without +', () => {
    expect(normalizePhoneForLookup('9876543210')).toBeNull();
  });
  it('rejects a too-short number', () => {
    expect(normalizePhoneForLookup('+123')).toBeNull();
  });
});

describe('normalizeEmailForLookup', () => {
  it('normalizes and validates an email', () => {
    expect(normalizeEmailForLookup('  Rahul@Example.COM ')).toBe('rahul@example.com');
    expect(normalizeEmailForLookup('not-an-email')).toBeNull();
  });
});

describe('buildDuplicateQuery / hasEnoughInputForLookup', () => {
  it('considers phone-only enough', () => {
    const q = buildDuplicateQuery('+919876543210', '');
    expect(hasEnoughInputForLookup(q)).toBe(true);
  });
  it('considers email-only enough', () => {
    const q = buildDuplicateQuery('', 'r@example.com');
    expect(hasEnoughInputForLookup(q)).toBe(true);
  });
  it('considers nothing / invalid input not enough', () => {
    expect(hasEnoughInputForLookup(buildDuplicateQuery('', ''))).toBe(false);
    expect(hasEnoughInputForLookup(buildDuplicateQuery('9876', 'bad'))).toBe(false);
  });
});

describe('generateIdempotencyKey', () => {
  it('returns a UUID-shaped key', () => {
    const key = generateIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
  it('returns a different key on every call', () => {
    expect(generateIdempotencyKey()).not.toBe(generateIdempotencyKey());
  });
});

describe('offerDuplicateChoices', () => {
  it('offers nothing when there are no duplicates', () => {
    expect(offerDuplicateChoices(0).hasDuplicates).toBe(false);
  });
  it('offers all three choices when there are duplicates', () => {
    const offer = offerDuplicateChoices(2);
    expect(offer.hasDuplicates).toBe(true);
    expect(offer.options).toEqual(['open_existing', 'add_enquiry', 'create_separate']);
  });
});
