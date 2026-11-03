import { describe, expect, it } from 'vitest';
import { normalizeUrl, isExcluded, normalizeKeywordDevice } from './jobs.js';

describe('normalizeUrl', () => {
  it('drops the fragment', () => {
    expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });

  it('strips default ports', () => {
    expect(normalizeUrl('https://example.com:443/page')).toBe('https://example.com/page');
    expect(normalizeUrl('http://example.com:80/page')).toBe('http://example.com/page');
  });

  it('preserves non-default ports', () => {
    expect(normalizeUrl('https://example.com:8443/page')).toBe('https://example.com:8443/page');
  });

  it('preserves query string', () => {
    expect(normalizeUrl('https://example.com/?a=1&b=2#frag')).toBe('https://example.com/?a=1&b=2');
  });

  it('lowercases host but preserves path case', () => {
    expect(normalizeUrl('HTTPS://EXAMPLE.COM/Mixed-Case-Path')).toBe('https://example.com/Mixed-Case-Path');
  });

  it('returns null for malformed URLs', () => {
    expect(normalizeUrl('not a url')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });
});

describe('isExcluded', () => {
  it('matches a simple substring pattern', () => {
    expect(isExcluded('https://example.com/admin/users', ['/admin/'])).toBe(true);
    expect(isExcluded('https://example.com/public/users', ['/admin/'])).toBe(false);
  });

  it('matches a glob with *', () => {
    expect(isExcluded('https://example.com/cart/123', ['*/cart/*'])).toBe(true);
    expect(isExcluded('https://example.com/pricing', ['*/cart/*'])).toBe(false);
  });

  it('escapes regex special chars in pattern', () => {
    expect(isExcluded('https://example.com/foo.html', ['*.html'])).toBe(true);
    // The dot in the pattern should match literally, so a URL without .html but with "ahtml" should not match
    expect(isExcluded('https://example.com/foo-html', ['*.html'])).toBe(false);
  });

  it('returns false when patterns array is empty', () => {
    expect(isExcluded('https://example.com/anything', [])).toBe(false);
  });

  it('ignores empty-string patterns', () => {
    expect(isExcluded('https://example.com/x', ['', '/admin/'])).toBe(false);
  });

  it('returns true as soon as any pattern matches', () => {
    expect(isExcluded('https://example.com/admin/x', ['/public/', '/admin/'])).toBe(true);
  });
});

describe('normalizeKeywordDevice', () => {
  it('maps GSC uppercase values to lowercase enum', () => {
    expect(normalizeKeywordDevice('MOBILE')).toBe('mobile');
    expect(normalizeKeywordDevice('DESKTOP')).toBe('desktop');
  });

  it('passes already-lowercase values through', () => {
    expect(normalizeKeywordDevice('mobile')).toBe('mobile');
    expect(normalizeKeywordDevice('desktop')).toBe('desktop');
  });

  it('returns null for tablet (not trackable under current CHECK constraint)', () => {
    expect(normalizeKeywordDevice('TABLET')).toBeNull();
    expect(normalizeKeywordDevice('tablet')).toBeNull();
  });

  it('defaults null to desktop (GSC "all devices" aggregation)', () => {
    expect(normalizeKeywordDevice(null)).toBe('desktop');
  });

  it('returns null for unknown values rather than failing the CHECK downstream', () => {
    expect(normalizeKeywordDevice('smart-fridge')).toBeNull();
    expect(normalizeKeywordDevice('')).toBe('desktop'); // empty string treated as null
  });
});
