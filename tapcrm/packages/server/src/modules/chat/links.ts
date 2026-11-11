/**
 * Finding the links in a message (for previews and the "links" search filter).
 *
 * Only http(s) URLs written as text count — not ones inside `code` or a
 * ```code block``` (a pasted curl command is not a link someone shared).
 * Trailing punctuation that ends a sentence is not part of the URL, but a
 * closing parenthesis that balances one inside it is (Wikipedia links).
 */

/** Links that get a stored row (and so are searchable). */
export const MAX_LINKS_PER_MESSAGE = 5;
/** Of those, how many are unfurled into preview cards. */
export const MAX_PREVIEWS_PER_MESSAGE = 3;
const MAX_URL_LENGTH = 2048;

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/giu;

function stripCode(body: string): string {
  return body.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

function trimTrailing(url: string): string {
  let result = url;
  for (;;) {
    const last = result.at(-1);
    if (last === undefined) return result;
    if ('.,;:!?*_~\''.includes(last)) {
      result = result.slice(0, -1);
      continue;
    }
    if (last === ')' || last === ']') {
      const open = last === ')' ? '(' : '[';
      const opens = [...result].filter((c) => c === open).length;
      const closes = [...result].filter((c) => c === last).length;
      if (closes > opens) {
        result = result.slice(0, -1);
        continue;
      }
    }
    return result;
  }
}

/** A canonical form for de-duplication and caching: lower-case scheme and host, no fragment. */
export function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    url.hash = '';
    const text = url.toString();
    return text.length <= MAX_URL_LENGTH ? text : null;
  } catch {
    return null;
  }
}

export function extractLinks(body: string | null | undefined): string[] {
  if (!body) return [];
  const found: string[] = [];
  for (const match of stripCode(body).matchAll(URL_PATTERN)) {
    const normalized = normalizeUrl(trimTrailing(match[0]));
    if (normalized && !found.includes(normalized)) found.push(normalized);
    if (found.length >= MAX_LINKS_PER_MESSAGE) break;
  }
  return found;
}
