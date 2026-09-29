import { describe, expect, it } from 'vitest';
import { normalizeLeadEmail, normalizeLeadPhone } from './normalization.js';

describe('lead duplicate normalization', () => {
  it('normalizes email deterministically', () => expect(normalizeLeadEmail('  SALES@Example.COM ')).toBe('sales@example.com'));
  it('normalizes phone formatting deterministically', () => expect(normalizeLeadPhone('+1 (555) 123-4567')).toBe('15551234567'));
  it('treats empty values as absent', () => { expect(normalizeLeadEmail('  ')).toBeNull(); expect(normalizeLeadPhone('---')).toBeNull(); });
});
