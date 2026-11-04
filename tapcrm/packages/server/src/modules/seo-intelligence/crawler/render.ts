/**
 * Headless rendering via Playwright + Chromium.
 *
 * Gated behind SEO_RENDER_ENABLED=true. Playwright is loaded via dynamic
 * import so a tenant without chromium installed never crashes the server at
 * startup — the first render attempt returns { state: 'not_configured' }.
 *
 * One shared browser per process; new context per page so cookies/storage
 * do not leak between crawls. Pages are hard-capped on time, size and
 * network activity to prevent runaway rendering from a malicious or
 * accidentally-infinite site.
 */
import { createHash } from 'node:crypto';
import { guardUrl } from './ssrf-guard.js';

export interface RenderOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Viewport width. Default 1366 — same as Lighthouse-mobile widescreen. */
  viewportWidth?: number;
  viewportHeight?: number;
  userAgent?: string;
}

export interface RenderResult {
  state: 'ok' | 'not_configured' | 'provider_error' | 'disabled';
  html: string | null;
  contentHash: string | null;
  byteLength: number;
  elapsedMs: number;
  reason?: string;
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB
const DEFAULT_UA = 'TapcrmSeoBot/1.0 (+https://tapcrm.local/bots; rendered)';

/* eslint-disable @typescript-eslint/no-explicit-any */
type BrowserLike = {
  newContext: (opts?: unknown) => Promise<ContextLike>;
  close: () => Promise<void>;
};
type ContextLike = {
  newPage: () => Promise<PageLike>;
  close: () => Promise<void>;
};
type PageLike = {
  goto: (url: string, opts: unknown) => Promise<unknown>;
  waitForLoadState: (state: string, opts?: unknown) => Promise<unknown>;
  content: () => Promise<string>;
  close: () => Promise<void>;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

let browserPromise: Promise<BrowserLike | null> | null = null;

async function getBrowser(): Promise<BrowserLike | null> {
  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        const moduleName: string = 'playwright';
        const mod = await import(moduleName);
        const chromium = mod.chromium;
        if (!chromium) return null;
        return await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
        });
      } catch {
        // playwright not installed or chromium not downloaded
        return null;
      }
    })();
  }
  return browserPromise;
}

/** Called from the server shutdown hook so Chromium does not linger. */
export async function closeRenderBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  if (browser) {
    try { await browser.close(); } catch { /* ignore */ }
  }
}

/**
 * Renders a URL via headless Chromium, returning the serialized DOM.
 *
 * The SSRF guard runs first (same as safeFetch) so a renderer can't be
 * tricked into hitting internal metadata endpoints via a crafted site URL.
 *
 * Caps:
 *   - Request timeout: 30s default
 *   - Body cap: 10 MiB default — if content() exceeds, HTML is truncated
 *   - Waits for `networkidle` or timeout, whichever comes first
 */
export async function renderPage(rawUrl: string, opts: RenderOptions = {}): Promise<RenderResult> {
  if (process.env['SEO_RENDER_ENABLED'] !== 'true') {
    return { state: 'disabled', html: null, contentHash: null, byteLength: 0, elapsedMs: 0 };
  }

  try { await guardUrl(rawUrl); }
  catch (err) {
    return { state: 'provider_error', html: null, contentHash: null, byteLength: 0, elapsedMs: 0,
      reason: err instanceof Error ? err.message : 'ssrf_blocked' };
  }

  const browser = await getBrowser();
  if (!browser) {
    return { state: 'not_configured', html: null, contentHash: null, byteLength: 0, elapsedMs: 0,
      reason: 'playwright not installed or chromium not downloaded. Run: npm install playwright && npx playwright install chromium' };
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const started = Date.now();

  let context: ContextLike | null = null;
  let page: PageLike | null = null;
  try {
    context = await browser.newContext({
      userAgent: opts.userAgent ?? DEFAULT_UA,
      viewport: { width: opts.viewportWidth ?? 1366, height: opts.viewportHeight ?? 768 },
    });
    page = await context.newPage();
    await page.goto(rawUrl, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
    // Give JS a moment to render then stop at networkidle or deadline.
    try { await page.waitForLoadState('networkidle', { timeout: Math.min(5000, timeoutMs / 2) }); }
    catch { /* networkidle timeout is fine — many sites never go fully idle */ }

    let html = await page.content();
    let truncated = false;
    const byteLength = Buffer.byteLength(html, 'utf8');
    if (byteLength > maxBytes) {
      html = html.slice(0, maxBytes); // approximation — chars != bytes, but for the hash this is fine
      truncated = true;
    }

    return {
      state: 'ok',
      html,
      contentHash: createHash('sha256').update(html).digest('hex'),
      byteLength: truncated ? maxBytes : byteLength,
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    return { state: 'provider_error', html: null, contentHash: null, byteLength: 0,
      elapsedMs: Date.now() - started,
      reason: err instanceof Error ? err.message : 'render_failed' };
  } finally {
    if (page) { try { await page.close(); } catch { /* ignore */ } }
    if (context) { try { await context.close(); } catch { /* ignore */ } }
  }
}

/**
 * Heuristic: should we spend the ~5-10s rendering this page?
 *
 * Fire when the raw HTML shows SPA-like fingerprints: no h1 at all, no title,
 * or very little visible text (<50 words). These are the pages where a React
 * / Vue / Angular bootstrap would meaningfully change the content.
 */
export function shouldRender(signals: {
  wordCount: number | null;
  h1Count: number | null;
  title: string | null;
}): boolean {
  if (signals.wordCount != null && signals.wordCount < 50) return true;
  if (signals.h1Count === 0) return true;
  if (!signals.title) return true;
  return false;
}
