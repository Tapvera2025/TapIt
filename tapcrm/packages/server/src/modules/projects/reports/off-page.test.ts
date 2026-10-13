import { describe, expect, it } from 'vitest';
import { normalizeBacklinkUrl } from './off-page.js';

describe('normalizeBacklinkUrl', () => {
  it('adds HTTPS and normalizes host and default port while retaining the path', () => {
    expect(normalizeBacklinkUrl('Example.COM:443/resources/?utm_source=test#section')).toBe('https://example.com/resources?utm_source=test#section');
  });

  it('rejects unsafe protocols and credentials', () => {
    expect(() => normalizeBacklinkUrl('javascript:alert(1)')).toThrow('Only HTTP and HTTPS');
    expect(() => normalizeBacklinkUrl('https://user:secret@example.com')).toThrow('cannot contain credentials');
  });
});
