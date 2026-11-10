/**
 * Headless rendering via Playwright + Chromium.
 *
 * Gated behind SEO_RENDER_ENABLED=true. Playwright is loaded via dynamic
 * import so a server without Chromium never crashes at startup — the first
 * render attempt returns { state: 'not_configured' }. SEO_RENDER_CHROMIUM_PATH
 * points at a system Chromium when Playwright's own download is not used.
 *
 * Safety: the page's own HTML comes from the crawler's guarded fetch (the
 * navigation is answered from that body), and every other request the page
 * makes — scripts, XHR, iframes — passes the same SSRF guard first. Chromium
 * keeps its sandbox unless the server runs as root, where Chromium cannot
 * start sandboxed. One shared browser per process; a fresh context per page.
 */
import { createHash } from 'node:crypto';
import { guardUrl } from './ssrf-guard.js';

export interface RenderOptions {
  timeoutMs?: number;
  maxBytes?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  userAgent?: string;
  /** The raw HTML already fetched for `url`; served to the browser instead of fetching the page again. */
  html?: string;
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
const DEFAULT_UA = 'Mozilla/5.0 (compatible; TapcrmSeoBot/1.0; rendered)';

type RouteLike = {
  request: () => { url: () => string; isNavigationRequest: () => boolean };
  continue: () => Promise<void>;
  abort: (errorCode?: string) => Promise<void>;
  fulfill: (response: { status: number; contentType: string; body: string }) => Promise<void>;
};
type BrowserLike = {
  newContext: (opts?: unknown) => Promise<ContextLike>;
  close: () => Promise<void>;
};
type ContextLike = {
  newPage: () => Promise<PageLike>;
  route: (url: string, handler: (route: RouteLike) => Promise<void>) => Promise<void>;
  close: () => Promise<void>;
};
type PageLike = {
  goto: (url: string, opts: unknown) => Promise<unknown>;
  waitForLoadState: (state: string, opts?: unknown) => Promise<unknown>;
  content: () => Promise<string>;
  close: () => Promise<void>;
};

/** Rendering is switched on for this server (Chromium may still be missing). */
export function renderingAvailable(): boolean {
  return process.env['SEO_RENDER_ENABLED'] === 'true';
}

let browserPromise: Promise<BrowserLike | null> | null = null;

async function getBrowser(): Promise<BrowserLike | null> {
  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        const mod = await import('playwright' as string);
        const chromium = (mod as { chromium?: { launch: (opts?: unknown) => Promise<BrowserLike> } }).chromium;
        if (!chromium) return null;
        const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;
        const executablePath = process.env['SEO_RENDER_CHROMIUM_PATH'];
        return await chromium.launch({
          headless: true,
          ...(executablePath ? { executablePath } : {}),
          args: ['--disable-dev-shm-usage', ...(runningAsRoot ? ['--no-sandbox'] : [])],
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

/** Renders a URL via headless Chromium, returning the serialized DOM. */
export async function renderPage(rawUrl: string, opts: RenderOptions = {}): Promise<RenderResult> {
  if (!renderingAvailable()) {
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
  const allowedHosts = new Map<string, Promise<boolean>>();
  const allowed = (url: string): Promise<boolean> => {
    let host: string;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') return Promise.resolve(true);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return Promise.resolve(false);
      host = `${parsed.protocol}//${parsed.host}`;
    } catch {
      return Promise.resolve(false);
    }
    let verdict = allowedHosts.get(host);
    if (!verdict) {
      verdict = guardUrl(url).then(() => true, () => false);
      allowedHosts.set(host, verdict);
    }
    return verdict;
  };

  let context: ContextLike | null = null;
  let page: PageLike | null = null;
  try {
    context = await browser.newContext({
      userAgent: opts.userAgent ?? DEFAULT_UA,
      viewport: { width: opts.viewportWidth ?? 1366, height: opts.viewportHeight ?? 768 },
      serviceWorkers: 'block',
    });
    let served = false;
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (opts.html !== undefined && !served && request.isNavigationRequest() && sameDocument(request.url(), rawUrl)) {
        served = true;
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: opts.html });
        return;
      }
      if (await allowed(request.url())) await route.continue();
      else await route.abort('blockedbyclient');
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
      html = html.slice(0, maxBytes);
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

function sameDocument(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    x.hash = '';
    y.hash = '';
    return x.toString() === y.toString();
  } catch {
    return false;
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
