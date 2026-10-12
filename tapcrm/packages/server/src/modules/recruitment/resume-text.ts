import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import type * as PdfJs from 'pdfjs-dist/legacy/build/pdf.js';
import { resumeOcrEnabled } from '../../config.js';
import { layoutPdfPage, type PdfTextItem } from './pdf-layout.js';
import { readScannedPdfPages, type ScannedPdfResult } from './resume-ocr/index.js';
import { splitMarginLabels } from './section-labels.js';

/**
 * Resume text extraction.
 *
 * Turns an uploaded resume (PDF, DOCX, legacy DOC or plain text) into plain
 * text with real line breaks, because both the resume parser and the ATS
 * engine reason about lines and section headings. PDFs are read in visual
 * reading order (columns, sidebars and tables are kept apart), and pieces of
 * one row that sit far apart on the page are separated by a tab.
 *
 * A file we cannot read yields empty text and a stated issue — never the raw
 * bytes — so the ATS can report `needs_review` instead of scoring noise.
 */

export type ResumeFormat = 'pdf' | 'docx' | 'doc' | 'txt' | 'unknown';

/** One non-empty line of resume text, with what the file says about it. */
export interface ResumeTextLine {
  readonly text: string;
  /** Font size in points where the format records it (PDF, DOCX), otherwise null. */
  readonly size: number | null;
  /** 1-based page number for PDFs, otherwise null. */
  readonly page: number | null;
}

export interface ResumeTextExtraction {
  readonly format: ResumeFormat;
  /** NFKC-normalised text, one resume line per `\n`. */
  readonly text: string;
  readonly pageCount: number | null;
  /** Human-readable problems met while reading the file. */
  readonly issues: readonly string[];
  /** The non-empty lines of `text`, in order, with layout hints. */
  readonly lines?: readonly ResumeTextLine[];
  /** Hyperlink targets behind the text (mailto:, tel:, https:). */
  readonly links?: readonly string[];
  /** Set when some text was read from scanned pages with text recognition (OCR). */
  readonly ocr?: {
    readonly pages: number;
    /** Tesseract's mean word confidence, 0–100. */
    readonly confidence: number | null;
  };
}

interface RawLine {
  readonly text: string;
  readonly size: number | null;
  readonly page: number | null;
}

interface RawExtraction {
  readonly lines: readonly RawLine[];
  readonly links: readonly string[];
  readonly pageCount: number | null;
  readonly issues: readonly string[];
  /** PDFs only: what happened to pages with (almost) no text. */
  readonly scanned?: ScannedPdfResult;
}

/** Enough for any real resume; bounds work on hostile uploads. */
const MAX_PDF_PAGES = 15;
/** pdf.js skips larger images (about 120 MB once decoded). */
const MAX_IMAGE_PIXELS = 40_000_000;
/** A page with less text than this is a picture of a page (or blank). */
const SCANNED_PAGE_CHARACTERS = 20;
const MAX_TEXT_CHARS = 200_000;
const MAX_ZIP_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_LINKS = 40;

export function detectResumeFormat(buffer: Buffer, filename: string, mimeType: string): ResumeFormat {
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) return 'docx';
  if (buffer.length >= 8 && buffer.readUInt32LE(0) === 0xe011cfd0 && buffer.readUInt32LE(4) === 0xe11ab1a1) {
    return 'doc';
  }
  const lowerName = filename.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime.includes('pdf') || lowerName.endsWith('.pdf')) return 'pdf';
  if (lowerName.endsWith('.docx') || lowerMime.includes('wordprocessingml')) return 'docx';
  if (lowerName.endsWith('.doc') || lowerMime === 'application/msword') return 'doc';
  if (lowerName.endsWith('.txt') || lowerMime.startsWith('text/')) return 'txt';
  return 'unknown';
}

export async function extractResumeText(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<ResumeTextExtraction> {
  const format = detectResumeFormat(buffer, filename, mimeType);
  let raw: RawExtraction = { lines: [], links: [], pageCount: null, issues: [] };

  try {
    switch (format) {
      case 'pdf':
        raw = await extractPdf(buffer);
        break;
      case 'docx':
        raw = extractDocx(buffer);
        break;
      case 'doc':
        raw = extractLegacyDoc(buffer);
        break;
      case 'txt':
        raw = plainTextExtraction(decodePlainText(buffer));
        break;
      case 'unknown': {
        const decoded = decodePlainText(buffer);
        raw = printableRatio(decoded) > 0.95
          ? plainTextExtraction(decoded)
          : { ...raw, issues: ['The file type is not supported for text extraction.'] };
        break;
      }
    }
  } catch (error) {
    raw = { lines: [], links: [], pageCount: null, issues: [describeExtractionFailure(format, error)] };
  }

  return finishExtraction(format, raw);
}

function finishExtraction(format: ResumeFormat, raw: RawExtraction): ResumeTextExtraction {
  const issues = [...raw.issues];
  const parts: string[] = [];
  const lines: ResumeTextLine[] = [];
  let characters = 0;
  let previousPage: number | null = null;
  let truncated = false;

  const normalized = splitMarginLabels(raw.lines.map((line) => ({ ...line, text: normalizeResumeLine(line.text) })));
  for (const line of normalized) {
    const text = line.text;
    if (characters + text.length > MAX_TEXT_CHARS) {
      truncated = true;
      break;
    }
    if (line.page !== null && previousPage !== null && line.page !== previousPage) parts.push('');
    previousPage = line.page;
    parts.push(text);
    characters += text.length + 1;
    if (text) lines.push({ text, size: line.size, page: line.page });
  }

  const scanned = raw.scanned;
  const readable = lines.reduce((sum, line) => sum + line.text.replace(/\s+/g, '').length, 0) >= 50;
  if (scanned?.status === 'read') {
    // First, because forms show the first note: every detail needs a check.
    issues.unshift(OCR_NOTE);
    if (scanned.skipped > 0) issues.push(`${scanned.skipped} more scanned page${scanned.skipped === 1 ? ' was' : 's were'} not read.`);
  } else if (format === 'pdf' && !readable && !issues.some((issue) => issue.includes('could not be read') || issue.includes('password'))) {
    issues.push(SCANNED_NOTES[scanned?.status ?? 'no-images']);
  } else if (scanned && (scanned.status === 'failed' || scanned.status === 'timeout')) {
    issues.push('A page that is a scanned image could not be read with text recognition.');
  }
  if (truncated) issues.push('The resume text was unusually long and was truncated for screening.');

  return {
    format,
    text: parts.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    pageCount: raw.pageCount,
    issues,
    lines,
    links: cleanLinks(raw.links),
    ...(scanned?.status === 'read'
      ? { ocr: { pages: scanned.pages.length, confidence: scanned.confidence === null ? null : Math.round(scanned.confidence) } }
      : {}),
  };
}

export const OCR_NOTE = 'Read from a scanned image with text recognition (OCR), so some details may be misread. Check them before saving.';

/** Why a PDF with (almost) no text gave nothing, by what text recognition found. */
const SCANNED_NOTES: Readonly<Record<Exclude<ScannedPdfResult['status'], 'read'>, string>> = {
  off: 'The PDF has almost no selectable text; it is probably a scanned image. Text recognition (OCR) is turned off on this server.',
  unreadable: 'The PDF is a scanned image, and text recognition found no readable text in it. Fill in the details manually.',
  'no-images': 'The PDF has almost no selectable text and no scanned image to read (its text may have been turned into shapes). Fill in the details manually.',
  failed: 'The PDF is a scanned image, but text recognition failed. Fill in the details manually.',
  timeout: 'The PDF is a scanned image, but text recognition took too long. Fill in the details manually.',
};

function describeExtractionFailure(format: ResumeFormat, error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (format === 'pdf' && name === 'PasswordException') {
    return 'The PDF is password-protected, so its text could not be read.';
  }
  if (format === 'pdf') return 'The PDF could not be read; it may be damaged.';
  if (format === 'docx') return 'The DOCX file could not be read; it may be damaged.';
  if (format === 'doc') return 'The legacy Word (.doc) file could not be read.';
  return 'The file could not be read.';
}

function cleanLinks(links: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const link of links) {
    const value = link.trim();
    if (value.length > 500 || !/^(?:https?:\/\/|mailto:|tel:|www\.)/i.test(value)) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Normalisation
 * ------------------------------------------------------------------ */

const BULLET_CHARACTERS = /[\u2022\u2023\u2043\u2219\u25aa\u25ab\u25cf\u25cb\u25e6\u2756\u27a2\u2713\u2714\u25ba\u25b8\uf0b7\uf0a7\uf076\uf0d8]/g;
/** Icon-font glyphs (private use area) and pictographs: phone, envelope, pin… */
const ICON = /[\p{Co}\p{So}\p{Extended_Pictographic}\u0080-\u009f]/u;
const LEADING_ICONS = new RegExp(`^\\s*(?:${ICON.source}\\s*)+`, 'u');
const ICONS = new RegExp(ICON.source, 'gu');
/** "R E S U M E", "9 8 7 6 5" — text typed or drawn with a space between every character. */
const SPACED_OUT = /(?<![\p{L}\p{N}])(?:[\p{L}\p{N}] ){3,}[\p{L}\p{N}](?![\p{L}\p{N}])/gu;

/** One line: Unicode clean-up, icons removed, spaced-out words rejoined, tabs kept as field separators. */
export function normalizeResumeLine(raw: string): string {
  let spacedOut = false;
  return raw
    .normalize('NFKC') // ligatures (ﬁ → fi), full-width forms, compatibility spaces
    .replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .replace(/[\u200b-\u200d\u2060\ufeff]|\ufe0e|\ufe0f/g, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201f\u2033]/g, '"')
    .replace(BULLET_CHARACTERS, ' - ')
    .replace(LEADING_ICONS, '- ')
    .replace(ICONS, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000a-\u001f\u007f]/g, ' ')
    .replace(SPACED_OUT, (spaced) => {
      spacedOut = true;
      return spaced.replace(/ /g, '');
    })
    // In "D E E P A K   J O S H I" the wide gap was the space between words.
    .replace(/(?<=\p{L}) {2,4}(?=\p{L})/gu, (gap) => (spacedOut ? ' ' : gap))
    // Three or more spaces line text up in columns, as a tab would.
    .replace(/ {3,}/g, '\t')
    .replace(/[ \t]*\t[ \t]*/g, '\t')
    .replace(/ {2,}/g, ' ')
    .replace(/^[\s-]*-\s*$/, '')
    .trim();
}

export function normalizeResumeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(normalizeResumeLine)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function plainTextExtraction(text: string): RawExtraction {
  return {
    lines: text.replace(/\r\n?/g, '\n').split('\n').map((line) => ({ text: line, size: null, page: null })),
    links: [],
    pageCount: null,
    issues: [],
  };
}

function decodePlainText(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }
  const utf8 = buffer.toString('utf8').replace(/^\ufeff/, '');
  const replacements = (utf8.match(/\ufffd/g) ?? []).length;
  return replacements > utf8.length * 0.01 ? buffer.toString('latin1') : utf8;
}

function printableRatio(text: string): number {
  if (text.length === 0) return 0;
  const printable = text.match(/[\p{L}\p{N}\p{P}\p{Zs}\n\t]/gu)?.length ?? 0;
  return printable / text.length;
}

/* ------------------------------------------------------------------ *
 * PDF — pdf.js text content in reading order, plus link annotations
 * ------------------------------------------------------------------ */

interface PdfAnnotation {
  readonly url?: unknown;
  readonly unsafeUrl?: unknown;
}

/**
 * pdf.js, loaded on first use so it (and its optional canvas probe) stays off
 * the boot path. Its legacy build is CommonJS: compiled code run by plain
 * Node — the production server — gets its functions only on `default`, while
 * tsx and Vitest also copy them onto the module itself.
 */
async function loadPdfJs(): Promise<typeof PdfJs> {
  const loaded = (await import('pdfjs-dist/legacy/build/pdf.js')) as typeof PdfJs & { default?: typeof PdfJs };
  return loaded.default ?? loaded;
}

async function extractPdf(buffer: Buffer): Promise<RawExtraction> {
  const pdfjsLib = await loadPdfJs();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    maxImageSize: MAX_IMAGE_PIXELS,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  try {
    const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const byPage: RawLine[][] = [];
    const links: string[] = [];
    const scannedPages: number[] = [];
    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const view = page.view as unknown;
      const pageTop = Array.isArray(view) && view.length === 4 ? Math.max(Number(view[1]), Number(view[3])) : 842;
      const lines = layoutPdfPage(content.items as unknown as PdfTextItem[], pageNumber, pageTop)
        .map((line): RawLine => ({ text: line.text, size: Math.round(line.size * 10) / 10, page: pageNumber }));
      byPage.push(lines);
      if (lines.reduce((sum, line) => sum + line.text.replace(/\s+/g, '').length, 0) < SCANNED_PAGE_CHARACTERS) {
        scannedPages.push(pageNumber);
      }
      try {
        const annotations = (await page.getAnnotations()) as PdfAnnotation[];
        for (const annotation of annotations) {
          const url = typeof annotation.url === 'string' ? annotation.url : annotation.unsafeUrl;
          if (typeof url === 'string') links.push(url);
        }
      } catch {
        // Links are a bonus; the text is what matters.
      }
      page.cleanup();
    }

    // Pages that are pictures of a page: read them with text recognition.
    let scanned: ScannedPdfResult | undefined;
    if (scannedPages.length > 0) {
      scanned = await readScannedPdfPages(
        createHash('sha256').update(buffer).digest('hex'),
        scannedPages,
        (pageNumber) => pdf.getPage(pageNumber),
        pdfjsLib.OPS,
        { enabled: resumeOcrEnabled() },
      );
      for (const page of scanned.pages) {
        const recognised = page.lines.map((line): RawLine => ({ text: line.text, size: Math.round(line.size * 10) / 10, page: page.page }));
        byPage[page.page - 1] = [...(byPage[page.page - 1] ?? []), ...recognised];
      }
    }

    const issues = pdf.numPages > MAX_PDF_PAGES ? [`Only the first ${MAX_PDF_PAGES} pages were read.`] : [];
    return { lines: byPage.flat(), links, pageCount: pdf.numPages, issues, ...(scanned ? { scanned } : {}) };
  } finally {
    await pdf.destroy();
  }
}

/* ------------------------------------------------------------------ *
 * DOCX — a ZIP of WordprocessingML parts
 * ------------------------------------------------------------------ */

interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

function readZipEntries(buffer: Buffer): ZipEntry[] {
  const minimum = Math.max(0, buffer.length - 0xffff - 22);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= minimum; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP end of central directory not found');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('ZIP central directory is corrupt');
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    entries.push({
      method: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      uncompressedSize: buffer.readUInt32LE(offset + 24),
      localHeaderOffset: buffer.readUInt32LE(offset + 42),
      name: buffer.toString('utf8', offset + 46, offset + 46 + nameLength),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const header = entry.localHeaderOffset;
  if (header + 30 > buffer.length || buffer.readUInt32LE(header) !== 0x04034b50) {
    throw new Error('ZIP local header is corrupt');
  }
  const start = header + 30 + buffer.readUInt16LE(header + 26) + buffer.readUInt16LE(header + 28);
  const data = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) {
    return inflateRawSync(data, { maxOutputLength: MAX_ZIP_ENTRY_BYTES });
  }
  throw new Error(`Unsupported ZIP compression method ${entry.method}`);
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    try {
      if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(parseInt(body.slice(2), 16));
      if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
    } catch {
      return ' ';
    }
    return XML_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attributes);
  if (!match) return null;
  return decodeXmlEntities(match[1] ?? match[2] ?? '');
}

/** Font sizes (points) of paragraph styles, from word/styles.xml. */
export interface WordStyleSizes {
  readonly defaultSize: number;
  readonly paragraphStyles: ReadonlyMap<string, number>;
}

const DEFAULT_WORD_STYLES: WordStyleSizes = { defaultSize: 11, paragraphStyles: new Map() };

export function readWordStyleSizes(xml: string): WordStyleSizes {
  const halfPoints = (block: string): number | null => {
    const match = /<w:rPr>[\s\S]*?<w:sz\s+w:val\s*=\s*"(\d+)"/.exec(block);
    return match ? Number(match[1]) / 2 : null;
  };
  const defaults = /<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.exec(xml)?.[0] ?? '';
  const defaultSize = halfPoints(defaults) ?? 11;
  const own = new Map<string, { size: number | null; basedOn: string | null }>();
  for (const match of xml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const attributes = match[1] ?? '';
    if (attribute(attributes, 'w:type') !== 'paragraph') continue;
    const id = attribute(attributes, 'w:styleId');
    if (!id) continue;
    const body = match[2] ?? '';
    own.set(id, { size: halfPoints(body), basedOn: /<w:basedOn\s+w:val\s*=\s*"([^"]+)"/.exec(body)?.[1] ?? null });
  }
  const paragraphStyles = new Map<string, number>();
  for (const id of own.keys()) {
    let cursor: string | null = id;
    let size: number | null = null;
    for (let depth = 0; cursor && size === null && depth < 8; depth += 1) {
      const style = own.get(cursor);
      size = style?.size ?? null;
      cursor = style?.basedOn ?? null;
    }
    paragraphStyles.set(id, size ?? defaultSize);
  }
  return { defaultSize, paragraphStyles };
}

interface WordParagraph {
  text: string;
  size: number | null;
  styleSize: number | null;
}

/**
 * WordprocessingML → lines with font sizes.
 *
 * Paragraphs become lines (a `<w:br/>` starts a new one). A table row whose
 * cells each hold one paragraph is a data row and becomes one tab-separated
 * line ("M.Com · Mahatma Gandhi University · 2012"); a row with multi-paragraph
 * cells is page layout (a sidebar beside the main column), so each cell is
 * read top to bottom, left cell first. Hidden text and the VML fallback copy of
 * text boxes are skipped.
 */
export function wordprocessingXmlToLines(xml: string, styles: WordStyleSizes = DEFAULT_WORD_STYLES): {
  lines: RawLine[];
  links: string[];
} {
  const out: RawLine[] = [];
  const links: string[] = [];
  const cells: RawLine[][] = [];
  const rows: RawLine[][][] = [];
  const paragraphs: WordParagraph[] = [];
  let fallbackDepth = 0;
  let textTarget: 'text' | 'instruction' | null = null;
  let inRun = false;
  let inRunProperties = false;
  let runSize: number | null = null;
  let runHidden = false;
  let instruction = '';

  const emit = (line: RawLine) => (cells.at(-1) ?? out).push(line);
  const paragraph = () => paragraphs.at(-1);
  const append = (value: string) => {
    const current = paragraph();
    if (current && !runHidden) current.text += value;
  };
  const noteSize = () => {
    const current = paragraph();
    if (!current || runHidden) return;
    const size = runSize ?? current.styleSize ?? styles.defaultSize;
    current.size = Math.max(current.size ?? 0, size);
  };

  const token = /<(\/?)([A-Za-z][\w.-]*:[\w.-]+)([^>]*?)(\/?)>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(xml)) !== null) {
    const [, closing, name, attributes = '', selfClosing, text] = match;
    if (text !== undefined) {
      if (fallbackDepth > 0 || textTarget === null) continue;
      const value = decodeXmlEntities(text);
      if (textTarget === 'instruction') instruction += value;
      else {
        noteSize();
        append(value);
      }
      continue;
    }
    if (name === 'mc:Fallback') {
      if (selfClosing) continue;
      fallbackDepth += closing ? -1 : 1;
      continue;
    }
    if (fallbackDepth > 0) continue;

    switch (name) {
      case 'w:p':
        if (selfClosing) emit({ text: '', size: null, page: null });
        else if (!closing) paragraphs.push({ text: '', size: null, styleSize: null });
        else {
          const done = paragraphs.pop();
          if (done) {
            const size = done.size ?? done.styleSize;
            for (const line of done.text.split('\n')) emit({ text: line, size, page: null });
          }
        }
        break;
      case 'w:pStyle': {
        const current = paragraph();
        const style = attribute(attributes, 'w:val');
        if (current && style) current.styleSize = styles.paragraphStyles.get(style) ?? null;
        break;
      }
      case 'w:r':
        if (selfClosing) break;
        inRun = !closing;
        runSize = null;
        runHidden = false;
        break;
      case 'w:rPr':
        if (!selfClosing) inRunProperties = !closing && inRun;
        break;
      case 'w:sz':
        if (inRunProperties) {
          const value = Number(attribute(attributes, 'w:val'));
          if (Number.isFinite(value) && value > 0) runSize = value / 2;
        }
        break;
      case 'w:vanish':
        if (inRunProperties) runHidden = !/^(?:0|false|off)$/i.test(attribute(attributes, 'w:val') ?? 'true');
        break;
      case 'w:t':
      case 'w:instrText':
        if (selfClosing) break;
        textTarget = closing ? null : name === 'w:t' ? 'text' : 'instruction';
        if (closing && name === 'w:instrText') {
          collectFieldLink(instruction, links);
          instruction = '';
        }
        break;
      case 'w:tab':
        if (inRun) append('\t');
        break;
      case 'w:br':
      case 'w:cr':
        if (inRun) append('\n');
        break;
      case 'w:noBreakHyphen':
        if (inRun) append('-');
        break;
      case 'w:fldSimple':
        if (!closing) collectFieldLink(attribute(attributes, 'w:instr') ?? '', links);
        break;
      case 'w:tr':
        if (selfClosing) break;
        if (!closing) rows.push([]);
        else flushRow(rows.pop() ?? [], emit);
        break;
      case 'w:tc':
        if (selfClosing) break;
        if (!closing) cells.push([]);
        else {
          const cell = cells.pop() ?? [];
          const row = rows.at(-1);
          if (row) row.push(cell);
          else for (const line of cell) emit(line);
        }
        break;
      default:
        break;
    }
  }
  return { lines: out, links };
}

function flushRow(row: readonly RawLine[][], emit: (line: RawLine) => void): void {
  const filled = row.map((cell) => cell.filter((line) => line.text.trim()));
  if (filled.every((cell) => cell.length <= 1)) {
    const parts = filled.map((cell) => cell[0]?.text.trim() ?? '').filter(Boolean);
    if (parts.length === 0) return;
    const sizes = filled.flatMap((cell) => cell.map((line) => line.size ?? 0));
    emit({ text: parts.join('\t'), size: Math.max(0, ...sizes) || null, page: null });
    return;
  }
  for (const cell of filled) for (const line of cell) emit(line);
}

function collectFieldLink(instruction: string, links: string[]): void {
  const match = /HYPERLINK\s+(?!\\l)"([^"]+)"/i.exec(instruction);
  if (match?.[1]) links.push(match[1]);
}

function relationshipLinks(xml: string): string[] {
  const links: string[] = [];
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attributes = match[1] ?? '';
    if (!/\/hyperlink$/i.test(attribute(attributes, 'Type') ?? '')) continue;
    if ((attribute(attributes, 'TargetMode') ?? '').toLowerCase() !== 'external') continue;
    const target = attribute(attributes, 'Target');
    if (target) links.push(target);
  }
  return links;
}

function extractDocx(buffer: Buffer): RawExtraction {
  const entries = readZipEntries(buffer);
  const document = entries.find((entry) => entry.name === 'word/document.xml');
  if (!document) throw new Error('word/document.xml missing');
  const xml = (entry: ZipEntry) => readZipEntry(buffer, entry).toString('utf8');

  const stylesEntry = entries.find((entry) => entry.name === 'word/styles.xml');
  let styles = DEFAULT_WORD_STYLES;
  try {
    if (stylesEntry) styles = readWordStyleSizes(xml(stylesEntry));
  } catch {
    styles = DEFAULT_WORD_STYLES;
  }

  const lines: RawLine[] = [];
  const links: string[] = [];
  const read = (entry: ZipEntry) => {
    const part = wordprocessingXmlToLines(xml(entry), styles);
    links.push(...part.links);
    return part.lines;
  };

  // Contact details often live in the page header, so it is read first. A
  // document can have several headers (first page, even pages) repeating the
  // same text; each line is kept once.
  const seenHeaderLines = new Set<string>();
  for (const entry of entries.filter((candidate) => /^word\/header\d*\.xml$/.test(candidate.name))) {
    for (const line of read(entry)) {
      const key = line.text.trim();
      if (key && seenHeaderLines.has(key)) continue;
      if (key) seenHeaderLines.add(key);
      lines.push(line);
    }
  }
  if (lines.length > 0) lines.push({ text: '', size: null, page: null });
  lines.push(...read(document));
  for (const entry of entries.filter((candidate) => /^word\/footer\d*\.xml$/.test(candidate.name))) {
    lines.push({ text: '', size: null, page: null }, ...read(entry));
  }
  for (const entry of entries.filter((candidate) => /^word\/_rels\/(?:document|header\d*|footer\d*)\.xml\.rels$/.test(candidate.name))) {
    links.push(...relationshipLinks(xml(entry)));
  }
  return { lines, links, pageCount: null, issues: [] };
}

/* ------------------------------------------------------------------ *
 * Legacy .doc — Compound File Binary + Word 97 piece table
 * ------------------------------------------------------------------ */

const CFB_FREE = 0xffffffff;
const CFB_END_OF_CHAIN = 0xfffffffe;

interface CfbDirectoryEntry {
  readonly name: string;
  readonly type: number;
  readonly startSector: number;
  readonly size: number;
}

class CompoundFile {
  private readonly sectorSize: number;
  private readonly miniSectorSize: number;
  private readonly miniStreamCutoff: number;
  private readonly fat: number[];
  private readonly miniFat: number[];
  private readonly entries: CfbDirectoryEntry[];
  private miniStream: Buffer | null = null;

  constructor(private readonly buffer: Buffer) {
    this.sectorSize = 1 << buffer.readUInt16LE(0x1e);
    this.miniSectorSize = 1 << buffer.readUInt16LE(0x20);
    this.miniStreamCutoff = buffer.readUInt32LE(0x38);
    if (this.sectorSize !== 512 && this.sectorSize !== 4096) throw new Error('Unsupported CFB sector size');

    const fatSectors: number[] = [];
    for (let i = 0; i < 109; i += 1) {
      const sector = buffer.readUInt32LE(0x4c + i * 4);
      if (sector !== CFB_FREE) fatSectors.push(sector);
    }
    let difatSector = buffer.readUInt32LE(0x44);
    for (let guard = 0; difatSector !== CFB_END_OF_CHAIN && difatSector !== CFB_FREE && guard < 10_000; guard += 1) {
      const base = this.sectorOffset(difatSector);
      const perSector = this.sectorSize / 4 - 1;
      for (let i = 0; i < perSector; i += 1) {
        const sector = buffer.readUInt32LE(base + i * 4);
        if (sector !== CFB_FREE) fatSectors.push(sector);
      }
      difatSector = buffer.readUInt32LE(base + perSector * 4);
    }

    this.fat = [];
    for (const sector of fatSectors) {
      const base = this.sectorOffset(sector);
      for (let i = 0; i < this.sectorSize / 4; i += 1) this.fat.push(buffer.readUInt32LE(base + i * 4));
    }

    const directory = this.readChain(buffer.readUInt32LE(0x30), Number.POSITIVE_INFINITY);
    this.entries = [];
    for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
      const nameLength = directory.readUInt16LE(offset + 0x40);
      this.entries.push({
        name: directory.toString('utf16le', offset, offset + Math.max(0, nameLength - 2)),
        type: directory[offset + 0x42] ?? 0,
        startSector: directory.readUInt32LE(offset + 0x74),
        size: directory.readUInt32LE(offset + 0x78),
      });
    }

    const miniFatStart = buffer.readUInt32LE(0x3c);
    const miniFatBytes = miniFatStart === CFB_END_OF_CHAIN ? Buffer.alloc(0) : this.readChain(miniFatStart, Number.POSITIVE_INFINITY);
    this.miniFat = [];
    for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) this.miniFat.push(miniFatBytes.readUInt32LE(i));
  }

  private sectorOffset(sector: number): number {
    const offset = (sector + 1) * this.sectorSize;
    if (offset + this.sectorSize > this.buffer.length) throw new Error('CFB sector out of range');
    return offset;
  }

  private readChain(start: number, size: number): Buffer {
    const parts: Buffer[] = [];
    let sector = start;
    let read = 0;
    for (let guard = 0; sector !== CFB_END_OF_CHAIN && read < size; guard += 1) {
      if (guard > this.fat.length + 1 || sector >= this.fat.length && this.fat.length > 0) {
        throw new Error('CFB chain is corrupt');
      }
      const offset = this.sectorOffset(sector);
      parts.push(this.buffer.subarray(offset, offset + this.sectorSize));
      read += this.sectorSize;
      sector = this.fat[sector] ?? CFB_END_OF_CHAIN;
    }
    const all = Buffer.concat(parts);
    return Number.isFinite(size) ? all.subarray(0, size) : all;
  }

  stream(name: string): Buffer | null {
    const entry = this.entries.find((candidate) => candidate.type === 2 && candidate.name === name);
    if (!entry) return null;
    if (entry.size >= this.miniStreamCutoff) return this.readChain(entry.startSector, entry.size);

    const root = this.entries[0];
    if (!root) return null;
    this.miniStream ??= this.readChain(root.startSector, root.size);
    const parts: Buffer[] = [];
    let sector = entry.startSector;
    let read = 0;
    for (let guard = 0; sector !== CFB_END_OF_CHAIN && read < entry.size; guard += 1) {
      if (guard > this.miniFat.length) throw new Error('CFB mini chain is corrupt');
      const offset = sector * this.miniSectorSize;
      parts.push(this.miniStream.subarray(offset, offset + this.miniSectorSize));
      read += this.miniSectorSize;
      sector = this.miniFat[sector] ?? CFB_END_OF_CHAIN;
    }
    return Buffer.concat(parts).subarray(0, entry.size);
  }
}

function extractLegacyDoc(buffer: Buffer): RawExtraction {
  let text: string;
  const links: string[] = [];
  const issues: string[] = [];
  try {
    const raw = extractDocPieceTable(buffer);
    // Field instructions carry hyperlink targets: \x13 HYPERLINK "mailto:…" \x14 shown text \x15
    for (const match of raw.matchAll(/HYPERLINK\s+(?!\\l)"([^"]+)"/gi)) if (match[1]) links.push(match[1]);
    text = cleanWordControlCharacters(raw);
  } catch {
    text = extractPrintableRuns(buffer);
    issues.push('Legacy Word (.doc) file: text was recovered approximately. Ask for a PDF or DOCX if details look missing.');
  }
  return {
    lines: text.split('\n').map((line) => ({ text: line, size: null, page: null })),
    links,
    pageCount: null,
    issues,
  };
}

/** [MS-DOC]: FIB → CLX → piece descriptors → raw text (with field codes) in the WordDocument stream. */
function extractDocPieceTable(buffer: Buffer): string {
  const cfb = new CompoundFile(buffer);
  const word = cfb.stream('WordDocument');
  if (!word || word.length < 0x01aa || word.readUInt16LE(0) !== 0xa5ec) throw new Error('Not a Word 97+ document');

  const flags = word.readUInt16LE(0x0a);
  if (flags & 0x0100) throw new Error('Encrypted .doc');
  const table = cfb.stream(flags & 0x0200 ? '1Table' : '0Table');
  if (!table) throw new Error('Table stream missing');

  const fcClx = word.readUInt32LE(0x01a2);
  const lcbClx = word.readUInt32LE(0x01a6);
  if (lcbClx === 0 || fcClx + lcbClx > table.length) throw new Error('CLX out of range');

  let offset = fcClx;
  const end = fcClx + lcbClx;
  while (offset < end && table[offset] === 0x01) offset += 3 + table.readUInt16LE(offset + 1); // skip Prc
  if (table[offset] !== 0x02) throw new Error('Piece table missing');
  const plcLength = table.readUInt32LE(offset + 1);
  const plc = table.subarray(offset + 5, offset + 5 + plcLength);
  const pieces = (plcLength - 4) / 12;
  if (!Number.isInteger(pieces) || pieces <= 0) throw new Error('Piece table malformed');

  let text = '';
  for (let i = 0; i < pieces; i += 1) {
    const cpStart = plc.readUInt32LE(i * 4);
    const cpEnd = plc.readUInt32LE((i + 1) * 4);
    const descriptor = (pieces + 1) * 4 + i * 8;
    const fcValue = plc.readUInt32LE(descriptor + 2);
    const characters = cpEnd - cpStart;
    if (characters <= 0) continue;
    if (fcValue & 0x40000000) {
      const fc = (fcValue & 0x3fffffff) / 2;
      text += decodeCp1252(word.subarray(fc, fc + characters));
    } else {
      text += word.subarray(fcValue, fcValue + characters * 2).toString('utf16le');
    }
  }
  return text;
}

/** "Compressed" Word pieces are Windows-1252, which differs from Latin-1 in 0x80–0x9F. */
const CP1252_HIGH: Readonly<Record<number, string>> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰',
  0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: "'", 0x92: "'", 0x93: '"', 0x94: '"', 0x95: '•',
  0x96: '-', 0x97: '-', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function decodeCp1252(bytes: Buffer): string {
  let out = '';
  for (const byte of bytes) out += CP1252_HIGH[byte] ?? String.fromCharCode(byte);
  return out;
}

function cleanWordControlCharacters(text: string): string {
  // \x13 field-begin … \x14 separator … \x15 end: keep the displayed result only.
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/\x13[^\x13\x14\x15]*\x14/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x13[^\x13\x14\x15]*\x15/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x14\x15]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\r\x0b\x0c]/g, '\n')
    // A table row ends with the last cell's mark followed by the row mark.
    // eslint-disable-next-line no-control-regex
    .replace(/\x07\x07/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/\x07/g, '\t');
}

/** Last resort for damaged .doc files: readable runs of UTF-16LE and 8-bit text. */
function extractPrintableRuns(buffer: Buffer): string {
  const runs: string[] = [];
  const utf16 = buffer.toString('utf16le');
  for (const match of utf16.matchAll(/[\p{L}\p{N}\p{P}\p{Zs}+#/&]{6,}/gu)) runs.push(match[0]);
  const latin = buffer.toString('latin1');
  for (const match of latin.matchAll(/[A-Za-z0-9 .,;:()@+#/&'-]{6,}/g)) runs.push(match[0]);
  return runs
    .map((run) => run.trim())
    .filter((run) => /[a-z]{3,}/i.test(run))
    .join('\n');
}
