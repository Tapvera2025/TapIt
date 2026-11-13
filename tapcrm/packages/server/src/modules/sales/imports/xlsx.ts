/**
 * A small reader for Excel workbooks (.xlsx / .xlsm): the first visible sheet,
 * or a named one, as rows of display strings.
 *
 * An .xlsx file is a zip of XML parts. This reads only the parts a lead list
 * needs (workbook, relationships, shared strings, styles, one worksheet) with
 * `fflate`, and walks the XML with anchored patterns rather than a DOM, so a
 * 10 000-row sheet stays fast and memory-light. It covers what Excel, Google
 * Sheets, LibreOffice and Numbers write: shared, inline and rich-text strings,
 * formulas (their cached value), booleans, errors, dates by number format and
 * both the 1900 and 1904 date systems.
 *
 * Not read: formatting, merged cells, hidden rows, charts, macros. Legacy
 * binary .xls, OpenDocument and Numbers files are recognized and refused with
 * a message that says how to save them.
 */

import { strFromU8, unzipSync, type UnzipFileInfo } from 'fflate';

export class SpreadsheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpreadsheetError';
  }
}

export interface XlsxSheetInfo {
  readonly name: string;
  readonly hidden: boolean;
}

export interface XlsxReadResult {
  readonly sheets: readonly XlsxSheetInfo[];
  readonly sheet: string;
  readonly rows: string[][];
  /** True when the sheet had more rows than `maxRows`; `rows` is cut there. */
  readonly truncated: boolean;
}

export interface XlsxReadOptions {
  readonly sheet?: string | null;
  /** Rows to read, header included. Default 10 001. */
  readonly maxRows?: number;
  /** Columns to keep. Default 200. */
  readonly maxColumns?: number;
}

/** Uncompressed bytes we are willing to inflate — a guard against zip bombs. */
const MAX_PART_BYTES = 120 * 1024 * 1024;
const MAX_TOTAL_BYTES = 160 * 1024 * 1024;

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function looksLikeZip(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((value, index) => bytes[index] === value);
}

export function looksLikeLegacyExcel(bytes: Uint8Array): boolean {
  return OLE_MAGIC.every((value, index) => bytes[index] === value);
}

export function readXlsx(bytes: Uint8Array, options: XlsxReadOptions = {}): XlsxReadResult {
  if (looksLikeLegacyExcel(bytes)) {
    throw new SpreadsheetError('This is an older Excel file (.xls). Open it in Excel and save it as .xlsx or CSV, then upload it again.');
  }
  if (!looksLikeZip(bytes)) throw new SpreadsheetError('This file is not an Excel workbook we can read.');

  const index = inflate(bytes, (name) => name === 'xl/workbook.xml' || name === 'xl/_rels/workbook.xml.rels' || name === 'mimetype' || name === 'content.xml' || name.startsWith('Index/'));
  if (!index['xl/workbook.xml']) {
    if (index['content.xml'] || (index['mimetype'] && strFromU8(index['mimetype']).includes('opendocument'))) {
      throw new SpreadsheetError('OpenDocument spreadsheets (.ods) are not supported. Save the file as .xlsx or CSV and upload it again.');
    }
    if (Object.keys(index).some((name) => name.startsWith('Index/'))) {
      throw new SpreadsheetError('Numbers files are not supported. In Numbers choose File → Export To → Excel or CSV, then upload that file.');
    }
    throw new SpreadsheetError('This file is not an Excel workbook we can read.');
  }

  const workbookXml = strFromU8(index['xl/workbook.xml']);
  const sheets = workbookSheets(workbookXml);
  if (sheets.length === 0) throw new SpreadsheetError('The workbook has no sheets.');
  const targets = relationshipTargets(index['xl/_rels/workbook.xml.rels'] ? strFromU8(index['xl/_rels/workbook.xml.rels']) : '');

  const wanted = options.sheet
    ? sheets.find((sheet) => sheet.name === options.sheet)
    : sheets.find((sheet) => !sheet.hidden) ?? sheets[0];
  if (!wanted) throw new SpreadsheetError(`The workbook has no sheet named "${options.sheet ?? ''}".`);
  const sheetPath = resolveTarget(targets.get(wanted.relationshipId) ?? `worksheets/sheet${sheets.indexOf(wanted) + 1}.xml`);

  const parts = inflate(bytes, (name) => name === sheetPath || name === 'xl/sharedStrings.xml' || name === 'xl/styles.xml');
  const sheetXml = parts[sheetPath];
  if (!sheetXml) throw new SpreadsheetError(`The sheet "${wanted.name}" could not be read.`);

  const sharedStrings = parts['xl/sharedStrings.xml'] ? readSharedStrings(strFromU8(parts['xl/sharedStrings.xml'])) : [];
  const dateStyles = parts['xl/styles.xml'] ? readDateStyles(strFromU8(parts['xl/styles.xml'])) : new Set<number>();
  const date1904 = /<(?:\w+:)?workbookPr\b[^>]*\bdate1904="(?:1|true)"/.test(workbookXml);

  const { rows, truncated } = readSheetRows(strFromU8(sheetXml), {
    sharedStrings,
    dateStyles,
    date1904,
    maxRows: options.maxRows ?? 10_001,
    maxColumns: options.maxColumns ?? 200,
  });
  return {
    sheets: sheets.map((sheet) => ({ name: sheet.name, hidden: sheet.hidden })),
    sheet: wanted.name,
    rows,
    truncated,
  };
}

/* ------------------------------------------------------------------ *
 * Zip
 * ------------------------------------------------------------------ */

function inflate(bytes: Uint8Array, want: (name: string) => boolean): Record<string, Uint8Array> {
  let total = 0;
  try {
    // A property, not a method: CI-23 reads a line-leading `filter(` as a ResourcePolicy.
    const keep = (file: UnzipFileInfo): boolean => {
      if (!want(file.name)) return false;
      if (file.originalSize > MAX_PART_BYTES) throw new SpreadsheetError('This workbook is too large to import. Split it into smaller files.');
      total += file.originalSize;
      if (total > MAX_TOTAL_BYTES) throw new SpreadsheetError('This workbook is too large to import. Split it into smaller files.');
      return true;
    };
    return unzipSync(bytes, { filter: keep });
  } catch (error) {
    if (error instanceof SpreadsheetError) throw error;
    throw new SpreadsheetError('This Excel file looks damaged and could not be opened.');
  }
}

/* ------------------------------------------------------------------ *
 * Workbook structure
 * ------------------------------------------------------------------ */

interface SheetEntry {
  readonly name: string;
  readonly relationshipId: string;
  readonly hidden: boolean;
}

function workbookSheets(xml: string): SheetEntry[] {
  const sheets: SheetEntry[] = [];
  for (const match of xml.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?>/g)) {
    const attrs = attributes(match[1] ?? '');
    const relationshipId = Object.entries(attrs).find(([key]) => key === 'id' || key.endsWith(':id'))?.[1];
    const name = attrs['name'];
    if (!name || !relationshipId) continue;
    sheets.push({ name: decodeXml(name), relationshipId, hidden: attrs['state'] === 'hidden' || attrs['state'] === 'veryHidden' });
  }
  return sheets;
}

function relationshipTargets(xml: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const match of xml.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
    const attrs = attributes(match[1] ?? '');
    if (attrs['Id'] && attrs['Target']) targets.set(attrs['Id'], decodeXml(attrs['Target']));
  }
  return targets;
}

function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = ['xl'];
  for (const segment of target.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment && segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

/* ------------------------------------------------------------------ *
 * Shared strings and styles
 * ------------------------------------------------------------------ */

function readSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const match of xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\b[^>]*\/>/g)) {
    strings.push(match[1] === undefined ? '' : richText(match[1]));
  }
  return strings;
}

/** The text of an <si> or <is>: every <t>, skipping phonetic runs (<rPh>). */
function richText(xml: string): string {
  const withoutPhonetic = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
  let text = '';
  for (const match of withoutPhonetic.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)) text += decodeXml(match[1] ?? '');
  return text;
}

/** Built-in number formats that show a date or a time. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function readDateStyles(xml: string): Set<number> {
  const customDateFormats = new Set<number>();
  for (const match of xml.matchAll(/<(?:\w+:)?numFmt\b([^>]*?)\/?>/g)) {
    const attrs = attributes(match[1] ?? '');
    const id = Number(attrs['numFmtId']);
    if (Number.isInteger(id) && isDateFormatCode(decodeXml(attrs['formatCode'] ?? ''))) customDateFormats.add(id);
  }
  const dateStyles = new Set<number>();
  const cellXfs = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(xml)?.[1] ?? '';
  let index = 0;
  for (const match of cellXfs.matchAll(/<(?:\w+:)?xf\b([^>]*?)(?:\/>|>)/g)) {
    const id = Number(attributes(match[1] ?? '')['numFmtId'] ?? 0);
    if (BUILTIN_DATE_FORMATS.has(id) || customDateFormats.has(id)) dateStyles.add(index);
    index++;
  }
  return dateStyles;
}

export function isDateFormatCode(code: string): boolean {
  const bare = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '')
    .toLowerCase();
  if (/^(general|@|0|#)/.test(bare) && !/[dy]/.test(bare)) return false;
  return /[dy]/.test(bare) || /h[^a-z]*m/.test(bare) || /m[^a-z]*s/.test(bare);
}

/* ------------------------------------------------------------------ *
 * Worksheet
 * ------------------------------------------------------------------ */

interface SheetContext {
  readonly sharedStrings: readonly string[];
  readonly dateStyles: ReadonlySet<number>;
  readonly date1904: boolean;
  readonly maxRows: number;
  readonly maxColumns: number;
}

function readSheetRows(xml: string, context: SheetContext): { rows: string[][]; truncated: boolean } {
  const data = /<(?:\w+:)?sheetData\b[^>]*>([\s\S]*?)<\/(?:\w+:)?sheetData>/.exec(xml)?.[1] ?? '';
  const rows: string[][] = [];
  let nextRowIndex = 0;
  let truncated = false;
  for (const match of data.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const rowNumber = Number(attributes(match[1] ?? '')['r']);
    const rowIndex = Number.isInteger(rowNumber) && rowNumber > 0 ? rowNumber - 1 : nextRowIndex;
    nextRowIndex = rowIndex + 1;
    const cells = readRowCells(match[2] ?? '', context);
    if (cells.every((cell) => cell === '')) continue;
    if (rows.length >= context.maxRows) {
      truncated = true;
      break;
    }
    rows.push(cells);
  }
  return { rows, truncated };
}

function readRowCells(xml: string, context: SheetContext): string[] {
  const cells: string[] = [];
  let nextColumn = 0;
  for (const match of xml.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
    const attrs = attributes(match[1] ?? '');
    const column = attrs['r'] ? columnIndex(attrs['r']) : nextColumn;
    nextColumn = column + 1;
    if (column >= context.maxColumns) continue;
    const value = cellValue(match[2] ?? '', attrs, context);
    while (cells.length < column) cells.push('');
    cells[column] = value;
  }
  return cells;
}

function cellValue(xml: string, attrs: Readonly<Record<string, string>>, context: SheetContext): string {
  const type = attrs['t'] ?? 'n';
  if (type === 'inlineStr') {
    const inline = /<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/.exec(xml)?.[1];
    return clean(inline === undefined ? '' : richText(inline));
  }
  const raw = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(xml)?.[1];
  if (raw === undefined) return '';
  const text = decodeXml(raw);
  switch (type) {
    case 's':
      return clean(context.sharedStrings[Number(text)] ?? '');
    case 'b':
      return text === '1' ? 'TRUE' : 'FALSE';
    case 'e':
      return '';
    case 'str':
    case 'd':
      return clean(text);
    default: {
      const style = Number(attrs['s'] ?? 0);
      if (context.dateStyles.has(style)) return excelDate(Number(text), context.date1904) ?? clean(text);
      return formatNumber(text);
    }
  }
}

/** "9.19876543210E+11" → "919876543210"; float noise trimmed; text kept. */
export function formatNumber(text: string): string {
  const value = Number(text);
  if (!Number.isFinite(value) || text.trim() === '') return clean(text);
  if (Number.isInteger(value) && Math.abs(value) < 1e21) return value.toFixed(0);
  return String(Number(value.toPrecision(15)));
}

/** Serial day number → "YYYY-MM-DD" (with " HH:MM" when there is a time). */
export function excelDate(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return null;
  // 1900 system: day 1 is 1900-01-01 and Excel counts a 29 Feb 1900 that
  // never was, so days from 61 on are one too many; epoch 1899-12-30 absorbs it.
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const adjusted = !date1904 && serial < 61 ? serial + 1 : serial;
  const millis = Math.round(adjusted * 86_400_000);
  const date = new Date(epoch + millis);
  const day = date.toISOString().slice(0, 10);
  const time = date.toISOString().slice(11, 16);
  return millis % 86_400_000 === 0 ? day : `${day} ${time}`;
}

export function columnIndex(reference: string): number {
  let index = 0;
  for (const ch of reference.toUpperCase()) {
    if (ch < 'A' || ch > 'Z') break;
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return Math.max(index - 1, 0);
}

/* ------------------------------------------------------------------ *
 * XML text
 * ------------------------------------------------------------------ */

function attributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g)) {
    const key = match[1] ?? match[3];
    const value = match[2] ?? match[4];
    if (key !== undefined && value !== undefined) attrs[key] = value;
  }
  return attrs;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
      if (entity[0] === '#') {
        const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
    })
    // OOXML escapes characters XML cannot hold as _xHHHH_.
    .replace(/_x([0-9a-f]{4})_/gi, (_whole, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function clean(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}
