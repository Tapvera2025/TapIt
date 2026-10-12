import { describe, expect, it } from 'vitest';
import { maskEmail, maskName, maskPhone, truncateMessage } from './mask.js';

describe('maskName', () => {
  it('keeps first letter of each name token and dots the rest', () => {
    expect(maskName('Rahul Shah')).toBe('R•••• S•••');
  });

  it('handles single-token names', () => {
    expect(maskName('Priya')).toBe('P••••');
  });

  it('falls back to (unknown) on empty', () => {
    expect(maskName('')).toBe('(unknown)');
    expect(maskName(null)).toBe('(unknown)');
    expect(maskName('   ')).toBe('(unknown)');
  });

  it('caps the mask length per token so long names stay readable', () => {
    expect(maskName('Bartholomew')).toBe('B•••••');
  });
});

describe('maskPhone', () => {
  it('keeps the country code and last two digits of an E.164 phone', () => {
    expect(maskPhone('+919876543210')).toBe('+91 ••••••••10');
  });

  it('handles US-style E.164 with 1-digit country code', () => {
    expect(maskPhone('+14155551234')).toBe('+1 ••••••••34');
  });

  it('masks a digits-only phone without country prefix', () => {
    expect(maskPhone('9876543210')).toBe('••••••••10');
  });

  it('returns empty for empty input', () => {
    expect(maskPhone(null)).toBe('');
    expect(maskPhone('')).toBe('');
  });
});

describe('maskEmail', () => {
  it('keeps the first local-part char and preserves the domain', () => {
    expect(maskEmail('rahul@example.com')).toBe('r•••••@example.com');
  });

  it('handles a one-character local part', () => {
    expect(maskEmail('r@example.com')).toBe('r@example.com');
  });

  it('fully dots an email without an @', () => {
    expect(maskEmail('not-an-email')).toBe('•'.repeat('not-an-email'.length));
  });
});

describe('truncateMessage', () => {
  it('passes short messages through', () => {
    expect(truncateMessage('Need a website')).toBe('Need a website');
  });

  it('collapses whitespace', () => {
    expect(truncateMessage('Need   a\nwebsite')).toBe('Need a website');
  });

  it('appends an ellipsis when over the limit', () => {
    const long = 'a'.repeat(100);
    const out = truncateMessage(long, 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith('…')).toBe(true);
  });

  it('returns empty for empty input', () => {
    expect(truncateMessage(null)).toBe('');
    expect(truncateMessage('')).toBe('');
  });
});
