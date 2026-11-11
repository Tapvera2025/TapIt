import { describe, expect, it } from 'vitest';
import { normalizeLeadEmail, normalizeLeadPhone } from './normalization.js';

describe('lead duplicate normalization', () => {
  it('normalizes email deterministically', () => expect(normalizeLeadEmail('  SALES@Example.COM ')).toBe('sales@example.com'));
  it('normalizes phone formatting deterministically', () => expect(normalizeLeadPhone('+1 (555) 123-4567')).toBe('15551234567'));
  it('treats empty values as absent', () => { expect(normalizeLeadEmail('  ')).toBeNull(); expect(normalizeLeadPhone('---')).toBeNull(); });
  it('gives one Indian number the same key however it is typed, matching the E.164 digits intake stores', () => {
    for (const typed of ['+91 98765 43210', '98765 43210', '098765-43210', '919876543210', '0091 98765 43210']) {
      expect(normalizeLeadPhone(typed)).toBe('919876543210');
    }
  });
  it('keeps the bare digits of a number that has no E.164 form', () => expect(normalizeLeadPhone('000')).toBe('000'));
});
