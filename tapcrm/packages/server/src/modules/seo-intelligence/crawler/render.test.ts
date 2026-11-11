/**
 * Pure tests for the render module. The actual Playwright launch is not covered
 * here — that requires a real Chromium install. These assert the pure
 * decision/gating logic.
 */
import { describe, expect, it } from 'vitest';
import { renderPage, shouldRender } from './render.js';

describe('shouldRender heuristic', () => {
  it('triggers on empty title', () => {
    expect(shouldRender({ wordCount: 500, h1Count: 1, title: null })).toBe(true);
    expect(shouldRender({ wordCount: 500, h1Count: 1, title: '' })).toBe(true);
  });

  it('triggers on zero h1', () => {
    expect(shouldRender({ wordCount: 500, h1Count: 0, title: 'ok' })).toBe(true);
  });

  it('triggers on very low word count (SPA skeleton)', () => {
    expect(shouldRender({ wordCount: 10, h1Count: 1, title: 'ok' })).toBe(true);
    expect(shouldRender({ wordCount: 49, h1Count: 1, title: 'ok' })).toBe(true);
  });

  it('does not trigger on a well-formed server-rendered page', () => {
    expect(shouldRender({ wordCount: 500, h1Count: 1, title: 'Home' })).toBe(false);
  });

  it('treats null wordCount as unknown (does not trigger alone)', () => {
    expect(shouldRender({ wordCount: null, h1Count: 1, title: 'ok' })).toBe(false);
  });
});

describe('renderPage gating', () => {
  it('returns disabled when SEO_RENDER_ENABLED is unset', async () => {
    const original = process.env['SEO_RENDER_ENABLED'];
    delete process.env['SEO_RENDER_ENABLED'];
    try {
      const result = await renderPage('https://example.com/');
      expect(result.state).toBe('disabled');
      expect(result.html).toBeNull();
    } finally {
      if (original !== undefined) process.env['SEO_RENDER_ENABLED'] = original;
    }
  });

  it('returns disabled when SEO_RENDER_ENABLED is set to something other than "true"', async () => {
    const original = process.env['SEO_RENDER_ENABLED'];
    process.env['SEO_RENDER_ENABLED'] = 'false';
    try {
      const result = await renderPage('https://example.com/');
      expect(result.state).toBe('disabled');
    } finally {
      if (original === undefined) delete process.env['SEO_RENDER_ENABLED'];
      else process.env['SEO_RENDER_ENABLED'] = original;
    }
  });

  it('returns provider_error when the SSRF guard blocks the target', async () => {
    const original = process.env['SEO_RENDER_ENABLED'];
    process.env['SEO_RENDER_ENABLED'] = 'true';
    try {
      // The SSRF guard rejects loopback addresses before any browser launch,
      // so this test doesn't require playwright to be installed.
      const result = await renderPage('http://127.0.0.1:5173/admin');
      expect(result.state).toBe('provider_error');
      expect(result.reason).toContain('SSRF');
    } finally {
      if (original === undefined) delete process.env['SEO_RENDER_ENABLED'];
      else process.env['SEO_RENDER_ENABLED'] = original;
    }
  });
});
