/**
 * Google Sheets links. A sheet shared as "Anyone with the link can view" (or
 * published to the web) exports any tab as CSV without credentials, so a lead
 * list can be imported from its link with no Google setup.
 *
 * Only Google's own hosts are ever contacted: the export URL is rebuilt from
 * the spreadsheet id (the pasted URL is never fetched as given) and redirects
 * are followed only to Google content hosts.
 */

export class GoogleSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleSheetError';
  }
}

export interface GoogleSheetLink {
  readonly spreadsheetId: string;
  /** The tab, from `gid=` in the link. Null exports the first tab. */
  readonly gid: string | null;
  /** A "Publish to the web" link (`/d/e/<id>/pub…`). */
  readonly published: boolean;
}

export interface GoogleSheetCsv {
  readonly text: string;
  /** "Spreadsheet - Tab" from the download name, when Google sends one. */
  readonly title: string | null;
  readonly digestSource: Uint8Array;
}

const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 25_000;
const MAX_REDIRECTS = 5;
const ALLOWED_HOST = /^(docs\.google\.com|[a-z0-9-]+\.googleusercontent\.com)$/i;

export function parseGoogleSheetUrl(input: string): GoogleSheetLink | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname.toLowerCase() !== 'docs.google.com') return null;
  const published = /\/spreadsheets\/d\/e\/([A-Za-z0-9_-]{20,})/.exec(url.pathname);
  const regular = /\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/.exec(url.pathname);
  const spreadsheetId = published?.[1] ?? regular?.[1];
  if (!spreadsheetId) return null;
  const gid = url.searchParams.get('gid') ?? /(?:^|[#&])gid=(\d+)/.exec(url.hash)?.[1] ?? null;
  return { spreadsheetId, gid: gid && /^\d+$/.test(gid) ? gid : null, published: Boolean(published) };
}

/** Outside production, tests and local runs can point at a mock server. */
function googleBase(): string {
  const override = process.env['LEAD_IMPORT_SHEETS_BASE'];
  if (override && process.env['NODE_ENV'] !== 'production') return override.replace(/\/+$/, '');
  return 'https://docs.google.com';
}

export function exportUrl(link: GoogleSheetLink): string {
  const base = googleBase();
  if (link.published) {
    const params = new URLSearchParams({ output: 'csv' });
    if (link.gid) {
      params.set('gid', link.gid);
      params.set('single', 'true');
    }
    return `${base}/spreadsheets/d/e/${link.spreadsheetId}/pub?${params.toString()}`;
  }
  const params = new URLSearchParams({ format: 'csv' });
  if (link.gid) params.set('gid', link.gid);
  return `${base}/spreadsheets/d/${link.spreadsheetId}/export?${params.toString()}`;
}

const NOT_SHARED =
  'Google did not share this sheet. In Google Sheets choose Share → General access → "Anyone with the link" (Viewer), then paste the link again. Or download it as CSV or Excel and upload the file.';

export async function fetchGoogleSheetCsv(link: GoogleSheetLink, fetcher: typeof fetch = fetch): Promise<GoogleSheetCsv> {
  let url = exportUrl(link);
  const local = url.startsWith('http://');
  for (let redirects = 0; ; redirects++) {
    let response: Response;
    try {
      response = await fetcher(url, {
        redirect: 'manual',
        headers: { accept: 'text/csv, text/plain;q=0.9, */*;q=0.1' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new GoogleSheetError(timedOut ? 'Google Sheets took too long to answer. Try again in a moment.' : 'Google Sheets could not be reached. Try again in a moment.');
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirects >= MAX_REDIRECTS) throw new GoogleSheetError(NOT_SHARED);
      const next = new URL(location, url);
      // A sign-in page means the sheet is private.
      if (next.hostname === 'accounts.google.com') throw new GoogleSheetError(NOT_SHARED);
      if (!local && (next.protocol !== 'https:' || !ALLOWED_HOST.test(next.hostname))) throw new GoogleSheetError(NOT_SHARED);
      url = next.toString();
      continue;
    }
    if (response.status === 401 || response.status === 403) throw new GoogleSheetError(NOT_SHARED);
    if (response.status === 404) throw new GoogleSheetError('That Google Sheet was not found. Check the link, or that the tab still exists.');
    if (!response.ok) throw new GoogleSheetError(`Google Sheets answered with an error (HTTP ${response.status}). Try again in a moment.`);

    const type = (response.headers.get('content-type') ?? '').toLowerCase();
    if (type.includes('text/html')) throw new GoogleSheetError(NOT_SHARED);
    const bytes = await readCapped(response);
    return { text: new TextDecoder('utf-8').decode(bytes), title: downloadTitle(response.headers.get('content-disposition')), digestSource: bytes };
  }
}

async function readCapped(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) throw new GoogleSheetError('This sheet is larger than 10 MB. Split it into smaller sheets.');
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new GoogleSheetError('This sheet is larger than 10 MB. Split it into smaller sheets.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** `attachment; filename="Leads - Sheet1.csv"; filename*=UTF-8''Leads%20-%20Sheet1.csv` */
export function downloadTitle(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  let name: string | null = null;
  if (extended) {
    try {
      name = decodeURIComponent(extended.trim());
    } catch {
      name = null;
    }
  }
  name ??= /filename="([^"]+)"/i.exec(header)?.[1] ?? /filename=([^;]+)/i.exec(header)?.[1]?.trim() ?? null;
  if (!name) return null;
  return name.replace(/\.csv$/i, '').trim().slice(0, 160) || null;
}
