import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { loadConfig } from '../../config.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { currentChatStorageDriver, putChatObject, type ChatStorageDriver } from './file-storage.js';
import { signChatFileUrl } from './file-urls.js';
import { MAX_PREVIEWS_PER_MESSAGE } from './links.js';
import { safeFetch } from './safe-fetch.js';
import type { LinkPreview } from './types.js';

/**
 * Link previews — Open Graph / Twitter-card unfurling with product-aware
 * fallbacks for the links a services team actually shares (Figma, GitHub,
 * Loom, Google Docs/Sheets/Slides/Drive, YouTube, Notion).
 *
 * A private Figma file or Google Doc answers an anonymous fetch with a
 * sign-in page; rather than a card titled "Sign in", those get a card
 * built from the URL itself ("Homepage redesign · Figma").
 */

const READY_TTL_MS = 7 * 24 * 3_600_000;
const FAILED_TTL_MS = 6 * 3_600_000;
const PAGE_TIMEOUT_MS = 6_000;
const PAGE_MAX_BYTES = 768 * 1024;
const IMAGE_TIMEOUT_MS = 6_000;
const IMAGE_MAX_BYTES = 6 * 1024 * 1024;
const IMAGE_EDGE = 640;

export interface UnfurledPage {
  readonly finalUrl: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly siteName: string | null;
  readonly provider: string | null;
  readonly imageUrl: string | null;
}

/* ------------------------------------------------------------------ *
 * HTML
 * ------------------------------------------------------------------ */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', rarr: '→',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function clean(value: string | undefined | null, max: number): string | null {
  if (!value) return null;
  const text = decodeEntities(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of tag.matchAll(/([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

/** The text of a page, decoded with its declared charset (HTTP header first, then <meta charset>). */
export function decodeHtml(body: Buffer, contentType: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const head = body.subarray(0, 4096).toString('latin1');
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  for (const label of [fromHeader, fromMeta, 'utf-8']) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(body);
    } catch {
      // Unknown label: try the next source.
    }
  }
  return body.toString('utf8');
}

export interface PageMeta {
  readonly title: string | null;
  readonly description: string | null;
  readonly siteName: string | null;
  readonly image: string | null;
}

/** Open Graph, then Twitter card, then plain HTML. `baseUrl` resolves a relative image. */
export function parsePageMeta(html: string, baseUrl: string): PageMeta {
  const headEnd = html.search(/<\/head\s*>/i);
  const head = headEnd === -1 ? html.slice(0, 512 * 1024) : html.slice(0, headEnd);
  const meta = new Map<string, string>();
  for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (attrs.get('property') ?? attrs.get('name') ?? attrs.get('itemprop') ?? '').toLowerCase();
    const content = attrs.get('content');
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  const linkImage = [...head.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => attributes(match[0]))
    .find((attrs) => (attrs.get('rel') ?? '').toLowerCase() === 'image_src')?.get('href');
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];

  const pick = (...keys: string[]): string | undefined => keys.map((key) => meta.get(key)).find((value) => value !== undefined && value.trim() !== '');
  const rawImage = pick('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src', 'image') ?? linkImage;
  let image: string | null = null;
  if (rawImage) {
    try {
      const resolved = new URL(decodeEntities(rawImage.trim()), baseUrl);
      if (resolved.protocol === 'https:' || resolved.protocol === 'http:') image = resolved.toString();
    } catch {
      image = null;
    }
  }
  return {
    title: clean(pick('og:title', 'twitter:title', 'title') ?? titleTag, 300),
    description: clean(pick('og:description', 'twitter:description', 'description'), 500),
    siteName: clean(pick('og:site_name', 'application-name', 'apple-mobile-web-app-title'), 100),
    image,
  };
}

/* ------------------------------------------------------------------ *
 * Products
 * ------------------------------------------------------------------ */

export interface ProviderInfo {
  readonly provider: string;
  readonly siteName: string;
  /** A title built from the URL alone, for when the page is behind a sign-in. */
  readonly fallbackTitle: string;
}

function titleFromSlug(slug: string | undefined): string | null {
  if (!slug) return null;
  try {
    const text = decodeURIComponent(slug).replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export function detectProvider(raw: string): ProviderInfo | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'figma.com' || host.endsWith('.figma.com')) {
    const kind = parts[0] ?? '';
    const label = { file: 'Design file', design: 'Design file', proto: 'Prototype', board: 'FigJam board', slides: 'Slide deck', deck: 'Slide deck' }[kind];
    return { provider: 'figma', siteName: 'Figma', fallbackTitle: titleFromSlug(parts[2]) ?? label ?? 'Figma file' };
  }
  if (host === 'github.com') {
    const [owner, repo, section, number] = parts;
    const base = owner && repo ? `${owner}/${repo}` : owner ?? 'GitHub';
    const suffix = (section === 'pull' || section === 'issues') && number ? `#${number}` : '';
    return { provider: 'github', siteName: 'GitHub', fallbackTitle: `${base}${suffix}` };
  }
  if (host === 'loom.com' || host.endsWith('.loom.com')) {
    return { provider: 'loom', siteName: 'Loom', fallbackTitle: 'Loom video' };
  }
  if (host === 'docs.google.com') {
    const type = parts[0];
    if (type === 'spreadsheets') return { provider: 'google-sheets', siteName: 'Google Sheets', fallbackTitle: 'Google Sheets spreadsheet' };
    if (type === 'presentation') return { provider: 'google-slides', siteName: 'Google Slides', fallbackTitle: 'Google Slides presentation' };
    if (type === 'forms') return { provider: 'google-forms', siteName: 'Google Forms', fallbackTitle: 'Google Form' };
    return { provider: 'google-docs', siteName: 'Google Docs', fallbackTitle: 'Google Docs document' };
  }
  if (host === 'drive.google.com') return { provider: 'google-drive', siteName: 'Google Drive', fallbackTitle: 'Google Drive file' };
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
    return { provider: 'youtube', siteName: 'YouTube', fallbackTitle: 'YouTube video' };
  }
  if (host === 'notion.so' || host.endsWith('.notion.site')) {
    const slug = parts.at(-1)?.replace(/-[0-9a-f]{32}$/i, '');
    return { provider: 'notion', siteName: 'Notion', fallbackTitle: titleFromSlug(slug) ?? 'Notion page' };
  }
  return null;
}

const SIGN_IN = /\b(sign[\s-]?in|log[\s-]?in|login|sign[\s-]?up)\b/i;

function looksLikeSignInWall(finalUrl: string, title: string | null): boolean {
  try {
    const host = new URL(finalUrl).hostname.toLowerCase();
    if (host === 'accounts.google.com' || host.startsWith('login.') || host.startsWith('auth.')) return true;
  } catch {
    return false;
  }
  return title !== null && SIGN_IN.test(title) && title.length < 60;
}

/* ------------------------------------------------------------------ *
 * Fetching
 * ------------------------------------------------------------------ */

function allowPrivateNetworks(): boolean {
  const config = loadConfig();
  return config.CHAT_LINK_PREVIEW_ALLOW_PRIVATE_NETWORKS && config.NODE_ENV !== 'production';
}

/** Fetches and reads one page. Null when there is nothing worth a card. */
export async function unfurl(url: string): Promise<UnfurledPage | null> {
  const provider = detectProvider(url);
  const fallback = (finalUrl: string): UnfurledPage | null => provider
    ? { finalUrl, title: provider.fallbackTitle, description: null, siteName: provider.siteName, provider: provider.provider, imageUrl: null }
    : null;

  let page;
  try {
    page = await safeFetch(url, {
      timeoutMs: PAGE_TIMEOUT_MS,
      maxBytes: PAGE_MAX_BYTES,
      allowPrivateNetworks: allowPrivateNetworks(),
      enough: (soFar) => soFar.includes('</head>') || soFar.includes('</HEAD>'),
    });
  } catch {
    return fallback(url);
  }
  if (page.status < 200 || page.status >= 300) return fallback(page.finalUrl);

  if (page.contentType.startsWith('image/')) {
    // A direct image link: the card is the picture itself.
    return { finalUrl: page.finalUrl, title: null, description: null, siteName: new URL(page.finalUrl).hostname, provider: provider?.provider ?? null, imageUrl: page.finalUrl };
  }
  if (!page.contentType.includes('html') && page.contentType !== '') return fallback(page.finalUrl);

  const meta = parsePageMeta(decodeHtml(page.body, page.contentType), page.finalUrl);
  if (looksLikeSignInWall(page.finalUrl, meta.title)) return fallback(page.finalUrl);
  const title = meta.title ?? provider?.fallbackTitle ?? null;
  if (!title && !meta.description && !meta.image) return fallback(page.finalUrl);
  let host = '';
  try {
    host = new URL(page.finalUrl).hostname.replace(/^www\./, '');
  } catch {
    host = '';
  }
  return {
    finalUrl: page.finalUrl,
    title,
    description: meta.description,
    siteName: meta.siteName ?? provider?.siteName ?? (host || null),
    provider: provider?.provider ?? null,
    imageUrl: meta.image,
  };
}

/** Our own small WebP copy of the page's image (never hot-linked to viewers). */
async function cacheImage(organizationId: string, url: string, imageUrl: string): Promise<{ driver: ChatStorageDriver; key: string; width: number; height: number } | null> {
  try {
    const image = await safeFetch(imageUrl, {
      timeoutMs: IMAGE_TIMEOUT_MS,
      maxBytes: IMAGE_MAX_BYTES,
      allowPrivateNetworks: allowPrivateNetworks(),
      accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1',
    });
    if (image.status < 200 || image.status >= 300 || image.body.length === 0 || image.body.length >= IMAGE_MAX_BYTES) return null;
    const output = await sharp(image.body, { limitInputPixels: 30_000_000, animated: false, failOn: 'error' })
      .rotate()
      .resize(IMAGE_EDGE, IMAGE_EDGE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 76 })
      .toBuffer({ resolveWithObject: true });
    if (output.info.width < 32 || output.info.height < 32) return null; // a tracking pixel or favicon, not a picture
    const driver = currentChatStorageDriver();
    const key = previewImageKey(organizationId, url);
    await putChatObject(driver, { key, body: output.data, contentType: 'image/webp' });
    return { driver, key, width: output.info.width, height: output.info.height };
  } catch {
    return null;
  }
}

export function urlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

export function previewImageKey(organizationId: string, urlOrHash: string): string {
  const hash = /^[0-9a-f]{64}$/.test(urlOrHash) ? urlOrHash : urlHash(urlOrHash);
  return `${organizationId}/link-previews/${hash}.webp`;
}

/* ------------------------------------------------------------------ *
 * Cache
 * ------------------------------------------------------------------ */

const inFlight = new Map<string, Promise<boolean>>();

async function refreshOne(ctx: RequestContext, url: string): Promise<boolean> {
  const page = await unfurl(url);
  const image = page?.imageUrl ? await cacheImage(ctx.organizationId, url, page.imageUrl) : null;
  await db.query(ctx, sql`
    INSERT INTO chat_link_preview (
      organization_id, url, status, final_url, title, description, site_name, provider,
      image_driver, image_key, image_width, image_height, fetched_at
    ) VALUES (
      ${ctx.organizationId}, ${url}, ${page ? 'ready' : 'failed'}, ${page?.finalUrl ?? null}, ${page?.title ?? null},
      ${page?.description ?? null}, ${page?.siteName ?? null}, ${page?.provider ?? null},
      ${image?.driver ?? null}, ${image?.key ?? null}, ${image?.width ?? null}, ${image?.height ?? null}, now()
    )
    ON CONFLICT (organization_id, url) DO UPDATE SET
      status = EXCLUDED.status, final_url = EXCLUDED.final_url, title = EXCLUDED.title,
      description = EXCLUDED.description, site_name = EXCLUDED.site_name, provider = EXCLUDED.provider,
      image_driver = EXCLUDED.image_driver, image_key = EXCLUDED.image_key,
      image_width = EXCLUDED.image_width, image_height = EXCLUDED.image_height, fetched_at = now()
  `);
  return page !== null;
}

/**
 * Brings the cache entries for `urls` up to date, fetching only missing or
 * stale ones (and never the same URL twice at once in this process).
 * Returns whether any URL now has a ready preview it did not have before.
 */
export async function refreshLinkPreviews(ctx: RequestContext, urls: readonly string[]): Promise<boolean> {
  if (urls.length === 0 || !loadConfig().CHAT_LINK_PREVIEWS) return false;
  const existing = await db.query<{ url: string; status: 'ready' | 'failed'; fetchedAt: Date }>(ctx, sql`
    SELECT url, status, fetched_at FROM chat_link_preview
     WHERE organization_id = ${ctx.organizationId} AND url = ANY(${[...urls]}::text[])
  `);
  const now = Date.now();
  const stale = urls.filter((url) => {
    const entry = existing.find((row) => row.url === url);
    if (!entry) return true;
    return now - entry.fetchedAt.getTime() > (entry.status === 'ready' ? READY_TTL_MS : FAILED_TTL_MS);
  });
  const results = await Promise.all(stale.map((url) => {
    const key = `${ctx.organizationId}|${url}`;
    let pending = inFlight.get(key);
    if (!pending) {
      pending = refreshOne(ctx, url).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    return pending.catch(() => false);
  }));
  return results.some((ready, index) => ready && existing.find((row) => row.url === stale[index])?.status !== 'ready');
}

interface PreviewRow {
  messageId: string;
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  provider: string | null;
  imageDriver: ChatStorageDriver | null;
  imageKey: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

/** The ready previews of these messages' first links, in the order the links appear. */
export async function previewsForMessages(ctx: RequestContext, messageIds: readonly string[]): Promise<Map<string, LinkPreview[]>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db.query<PreviewRow>(ctx, sql`
    SELECT ml.message_id, ml.url, p.title, p.description, p.site_name, p.provider,
           p.image_driver, p.image_key, p.image_width, p.image_height
      FROM message_link ml
      JOIN chat_link_preview p ON p.organization_id = ml.organization_id AND p.url = ml.url AND p.status = 'ready'
     WHERE ml.organization_id = ${ctx.organizationId}
       AND ml.message_id = ANY(${[...messageIds]}::uuid[])
       AND ml.position < ${MAX_PREVIEWS_PER_MESSAGE}
     ORDER BY ml.message_id, ml.position
  `);
  const byMessage = new Map<string, LinkPreview[]>();
  for (const row of rows) {
    const list = byMessage.get(row.messageId) ?? [];
    list.push({
      url: row.url,
      title: row.title,
      description: row.description,
      siteName: row.siteName,
      provider: row.provider,
      imageUrl: row.imageKey && row.imageDriver
        ? signChatFileUrl(ctx.organizationId, { type: 'p', driver: row.imageDriver, hash: urlHash(row.url) })
        : null,
      imageWidth: row.imageWidth,
      imageHeight: row.imageHeight,
    });
    byMessage.set(row.messageId, list);
  }
  return byMessage;
}
