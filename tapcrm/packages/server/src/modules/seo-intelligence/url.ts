import { createHash } from 'node:crypto';

/**
 * One URL identity for the whole audit. Seeds, sitemap entries, discovered
 * links, redirect targets, link edges, observations and Search Console pages
 * all go through `normalizeUrl` before they are stored or compared, so the
 * same page is never crawled, counted or reported twice under two spellings.
 */

/** http(s) only; fragment dropped; default port dropped; bare `?` dropped. Host casing is normalized by URL. */
export function normalizeUrl(raw: string, base?: string): string | null {
  try {
    const u = base === undefined ? new URL(raw.trim()) : new URL(raw.trim(), base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    u.hash = '';
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) {
      u.port = '';
    }
    if (u.search === '') u.search = ''; // drops a bare trailing '?'
    return u.toString();
  } catch {
    return null;
  }
}

/** The host a site is known by: lower case, without a leading `www.`. */
export function hostKey(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

/** hostKey of a URL, or null when it does not parse. */
export function urlHostKey(url: string): string | null {
  try {
    return hostKey(new URL(url).hostname);
  } catch {
    return null;
  }
}

/** True when the URL's host is one of the crawl's site hosts (www-insensitive, any scheme). */
export function isSiteUrl(url: string, siteHosts: ReadonlySet<string>): boolean {
  const key = urlHostKey(url);
  return key !== null && siteHosts.has(key);
}

/**
 * A redirect from a site's start address to `targetHost` keeps the audit on the
 * same website when the hosts are the same apart from `www.`, or one is a
 * subdomain of the other (acme.com → shop.acme.com). Anything else is another
 * website, which the audit reports rather than crawls.
 */
export function isRelatedHost(siteHost: string, targetHost: string): boolean {
  const a = hostKey(siteHost);
  const b = hostKey(targetHost);
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/** sha256 of the normalized URL string — the key every scan table uses. */
export function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

/** True when the path of `url` lies under the site's scope path ('' or '/' is the whole site). */
export function inScope(url: string, scopePath: string | null | undefined): boolean {
  const scope = (scopePath ?? '').trim();
  if (scope === '' || scope === '/') return true;
  try {
    const path = new URL(url).pathname;
    const prefix = scope.endsWith('/') ? scope : `${scope}/`;
    return path === scope || path.startsWith(prefix);
  } catch {
    return false;
  }
}

/** Content types the audit reads as web pages. A missing header is treated as HTML. */
export function isHtmlContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return true;
  return /\b(text\/html|application\/xhtml\+xml)\b/i.test(contentType);
}
