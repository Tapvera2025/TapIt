import { layoutPdfPage, type LayoutLine, type PdfTextItem } from '../pdf-layout.js';
import { recognizePicture, type OcrWord } from './engine.js';
import {
  compose,
  encodePgm,
  IDENTITY,
  imageToGray,
  maskToGray,
  pageCoverage,
  rasterizePage,
  type Matrix,
  type PageBox,
  type PdfImageData,
  type PlacedImage,
} from './raster.js';

/**
 * Scanned PDF pages → text lines.
 *
 * The page's images are found from pdf.js's drawing operations (with where
 * each one sits), redrawn as one upright grey page picture, read by Tesseract,
 * and the recognised words are handed to the same layout code as real PDF
 * text — so columns, margin labels and type sizes (the name is the largest
 * text) are read the same way for a scan as for a typed PDF.
 */

export { stopResumeOcr, OcrTimeoutError } from './engine.js';

/** The parts of a pdf.js page this module uses. */
export interface PdfPageForOcr {
  readonly view: readonly number[];
  readonly rotate: number;
  getOperatorList(): Promise<{ readonly fnArray: readonly number[]; readonly argsArray: readonly unknown[] }>;
  readonly objs: { get(id: string, callback: (data: unknown) => void): unknown };
  readonly commonObjs: { get(id: string, callback: (data: unknown) => void): unknown };
}

/** pdf.js `OPS`: operation names to numbers. */
export type PdfOps = Readonly<Record<string, number>>;

export interface ScannedPage {
  readonly page: number;
  readonly lines: readonly LayoutLine[];
  /** Mean word confidence, 0–100, or null when nothing was read. */
  readonly confidence: number | null;
}

/** Icons, logos and photos are smaller than this share of the page. */
const MIN_COVERAGE = 0.05;
const IMAGE_WAIT_MS = 10_000;

function isMatrix(value: unknown): value is Matrix {
  return Array.isArray(value) && value.length === 6 && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function pdfObject(page: PdfPageForOcr, id: string): Promise<unknown> {
  const store = id.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), IMAGE_WAIT_MS);
    timer.unref();
    try {
      store.get(id, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** Every image the page draws, with the transform it is drawn under. */
export async function placedImages(page: PdfPageForOcr, ops: PdfOps): Promise<PlacedImage[]> {
  const list = await page.getOperatorList();
  const images: PlacedImage[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;

  for (let index = 0; index < list.fnArray.length; index += 1) {
    const fn = list.fnArray[index];
    const args = (list.argsArray[index] ?? []) as readonly unknown[];
    if (fn === ops['save']) {
      stack.push(ctm);
    } else if (fn === ops['restore']) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === ops['transform']) {
      if (isMatrix(args)) ctm = compose(ctm, args);
    } else if (fn === ops['paintFormXObjectBegin']) {
      stack.push(ctm);
      if (isMatrix(args[0])) ctm = compose(ctm, args[0]);
    } else if (fn === ops['paintFormXObjectEnd']) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === ops['beginGroup']) {
      stack.push(ctm);
      const matrix = (args[0] as { matrix?: unknown } | undefined)?.matrix;
      if (isMatrix(matrix)) ctm = compose(ctm, matrix);
    } else if (fn === ops['endGroup']) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === ops['paintImageXObject'] || fn === ops['paintInlineImageXObject']) {
      const data = typeof args[0] === 'string' ? await pdfObject(page, args[0]) : args[0];
      const gray = data && typeof data === 'object' ? imageToGray(data as PdfImageData) : null;
      if (gray) images.push({ ...gray, transform: ctm });
    } else if (fn === ops['paintImageMaskXObject']) {
      const gray = args[0] && typeof args[0] === 'object' ? maskToGray(args[0] as PdfImageData) : null;
      if (gray) images.push({ ...gray, transform: ctm, stencil: true });
    }
  }
  return images;
}

function pageBox(view: readonly number[]): PageBox {
  const [a = 0, b = 0, c = 595, d = 842] = view;
  return { x0: Math.min(a, c), y0: Math.min(b, d), x1: Math.max(a, c), y1: Math.max(b, d) };
}

/** Tesseract's usual readings of a bullet at the start of a line. */
const BULLET_GLYPH = /^(?:[eoc°•·*«»¢©®>~]|e¢|ee|oe|\*\*)$/;
/** Rules and borders read as text. */
const RULE = /^([-_=.—–~·•*])\1{2,}$/u;

function keepWord(word: OcrWord): boolean {
  if (RULE.test(word.text)) return false;
  if (word.confidence < 30) return false;
  return /[\p{L}\p{N}]/u.test(word.text) || word.confidence >= 60;
}

/**
 * Recognised words as positioned text, the shape pdf.js gives for real text:
 * PDF points, y up, one item per word, its line's type size as the font size.
 */
export function wordsToItems(words: readonly OcrWord[], picture: { readonly height: number; readonly scale: number }): {
  readonly items: PdfTextItem[];
  readonly pageTop: number;
} {
  const pageTop = picture.height / picture.scale;
  const items: PdfTextItem[] = [];
  let previousLine = -1;
  for (const [index, word] of words.entries()) {
    const firstInLine = word.line !== previousLine;
    previousLine = word.line;
    let text = word.text;
    const next = words[index + 1];
    if (firstInLine && next?.line === word.line && BULLET_GLYPH.test(text) && /^\p{Lu}/u.test(next.text)) {
      text = '•';
    } else if (!keepWord(word)) {
      continue;
    }
    const size = word.size / picture.scale;
    items.push({
      str: text,
      transform: [size, 0, 0, size, word.x0 / picture.scale, pageTop - word.baseline / picture.scale],
      width: Math.max(0.1, (word.x1 - word.x0) / picture.scale),
      height: size,
    });
  }
  return { items, pageTop };
}

/** Reads a page that has images but (almost) no text. Null when it has no sizeable image. */
export async function readScannedPage(page: PdfPageForOcr, pageNumber: number, ops: PdfOps): Promise<ScannedPage | null> {
  const box = pageBox(page.view);
  const images = (await placedImages(page, ops)).filter((image) => pageCoverage(image, box) >= MIN_COVERAGE);
  if (images.length === 0) return null;
  const picture = rasterizePage(images, box, page.rotate);
  const result = await recognizePicture(encodePgm(picture), picture.scale * 72);
  const { items, pageTop } = wordsToItems(result.words, picture);
  return { page: pageNumber, lines: layoutPdfPage(items, pageNumber, pageTop), confidence: result.confidence };
}

/* ------------------------------------------------------------------ *
 * Whole documents: switch, limits and a small cache
 * ------------------------------------------------------------------ */

/**
 * What happened to a PDF's scanned pages:
 * - read: text was recognised on at least one page
 * - unreadable: pictures were found but no legible text in them
 * - no-images: the pages have neither text nor a picture to read
 * - failed / timeout: recognition broke or ran out of time
 * - off: RESUME_OCR=false
 */
export type ScannedPdfStatus = 'read' | 'unreadable' | 'no-images' | 'failed' | 'timeout' | 'off';

export interface ScannedPdfResult {
  readonly status: ScannedPdfStatus;
  readonly pages: readonly ScannedPage[];
  /** Scanned pages left unread because of the page limit or the time budget. */
  readonly skipped: number;
  /** Mean word confidence over the pages read, 0–100. */
  readonly confidence: number | null;
}

export interface ScannedPdfOptions {
  readonly enabled: boolean;
  readonly maxPages?: number;
  readonly budgetMs?: number;
}

/** A resume is rarely longer; each page takes a few seconds. */
const MAX_OCR_PAGES = 3;
const OCR_BUDGET_MS = 150_000;
/** Recognised text shorter than this is noise, not a resume. */
const MIN_READ_CHARACTERS = 30;
const CACHE_SIZE = 12;
const CACHE_TTL_MS = 30 * 60_000;

/**
 * The same file is read when its form is filled in, again when the application
 * is saved, and again by an ATS scan; recognition is cached by file content so
 * only the first read pays for it.
 */
const cache = new Map<string, { readonly at: number; readonly result: ScannedPdfResult }>();

function cached(key: string): ScannedPdfResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  cache.delete(key);
  if (Date.now() - entry.at > CACHE_TTL_MS) return null;
  cache.set(key, entry);
  return entry.result;
}

function remember(key: string, result: ScannedPdfResult): void {
  cache.set(key, { at: Date.now(), result });
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

/** Test-only. */
export function __clearOcrCache(): void {
  cache.clear();
}

/** Reads already under way, so a second request for the same file waits for the first. */
const inflight = new Map<string, Promise<ScannedPdfResult>>();

export async function readScannedPdfPages(
  fingerprint: string,
  pageNumbers: readonly number[],
  getPage: (pageNumber: number) => Promise<PdfPageForOcr>,
  ops: PdfOps,
  options: ScannedPdfOptions,
): Promise<ScannedPdfResult> {
  if (!options.enabled) return { status: 'off', pages: [], skipped: pageNumbers.length, confidence: null };
  const key = `${fingerprint}:${pageNumbers.join(',')}`;
  const hit = cached(key);
  if (hit) return hit;
  const running = inflight.get(key);
  if (running) return running;
  const read = readPages(key, pageNumbers, getPage, ops, options).finally(() => inflight.delete(key));
  inflight.set(key, read);
  return read;
}

async function readPages(
  key: string,
  pageNumbers: readonly number[],
  getPage: (pageNumber: number) => Promise<PdfPageForOcr>,
  ops: PdfOps,
  options: ScannedPdfOptions,
): Promise<ScannedPdfResult> {
  const limit = options.maxPages ?? MAX_OCR_PAGES;
  const budget = options.budgetMs ?? OCR_BUDGET_MS;
  const started = Date.now();
  const pages: ScannedPage[] = [];
  let pictures = 0;
  let attempted = 0;
  let stopped: 'failed' | 'timeout' | null = null;

  for (const pageNumber of pageNumbers) {
    if (pictures >= limit || Date.now() - started > budget) break;
    attempted += 1;
    try {
      const page = await readScannedPage(await getPage(pageNumber), pageNumber, ops);
      if (!page) continue;
      pictures += 1;
      pages.push(page);
    } catch (error) {
      stopped = error instanceof Error && error.name === 'OcrTimeoutError' ? 'timeout' : 'failed';
      console.warn(JSON.stringify({
        level: 'warn',
        msg: 'Resume text recognition failed',
        page: pageNumber,
        error: error instanceof Error ? error.message : String(error),
      }));
      break;
    }
  }

  const read = pages.filter((page) => page.lines.reduce((sum, line) => sum + line.text.replace(/\s+/g, '').length, 0) > 0);
  const characters = read.reduce((sum, page) => sum + page.lines.reduce((total, line) => total + line.text.replace(/\s+/g, '').length, 0), 0);
  const weighted = read.filter((page) => page.confidence !== null);
  const confidence = weighted.length > 0
    ? weighted.reduce((sum, page) => sum + page.confidence!, 0) / weighted.length
    : null;
  const status: ScannedPdfStatus = characters >= MIN_READ_CHARACTERS
    ? 'read'
    : stopped ?? (pictures > 0 ? 'unreadable' : 'no-images');

  const result: ScannedPdfResult = {
    status,
    pages: status === 'read' ? read : [],
    skipped: pageNumbers.length - attempted + (stopped ? 1 : 0),
    confidence: status === 'read' ? confidence : null,
  };
  // A broken or slow run may do better next time.
  if (!stopped) remember(key, result);
  return result;
}
