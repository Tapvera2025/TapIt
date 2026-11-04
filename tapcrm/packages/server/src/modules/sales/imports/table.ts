/**
 * Turn an upload (file bytes, pasted text or a Google Sheet's CSV) into one
 * clean table: a header row and data rows of trimmed strings, all the same
 * width. Pure apart from hashing.
 */

import { createHash } from 'node:crypto';
import { ImportFileError, ImportTooManyRowsError } from './errors.js';
import { CsvParseError, decodeText, parseText } from './parser.js';
import { looksLikeLegacyExcel, looksLikeZip, readXlsx, SpreadsheetError } from './xlsx.js';

export const IMPORT_LIMITS = {
  /** Upload size. The request carries it base64-encoded inside JSON. */
  MAX_BYTES: 10 * 1024 * 1024,
  MAX_ROWS: 10_000,
  MAX_COLUMNS: 100,
  MAX_CELL_CHARS: 1000,
} as const;

export type ImportSourceKind = 'csv' | 'excel' | 'google_sheet' | 'paste';

export interface ImportTable {
  readonly kind: ImportSourceKind;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** Excel only: every sheet in the workbook, and the one read. */
  readonly sheets: readonly string[];
  readonly sheet: string | null;
  readonly digest: string;
}

const TEXT_EXTENSIONS = /\.(csv|tsv|txt|tab|prn)$/i;
const EXCEL_EXTENSIONS = /\.(xlsx|xlsm|xltx|xltm)$/i;

export function tableFromFile(fileName: string, bytes: Uint8Array, sheet: string | null = null): ImportTable {
  if (bytes.byteLength === 0) throw new ImportFileError('The file is empty.');
  if (bytes.byteLength > IMPORT_LIMITS.MAX_BYTES) throw new ImportFileError('The file is larger than 10 MB. Split it into smaller files.');
  const digest = sha256(bytes);
  if (/\.xls$/i.test(fileName) || looksLikeLegacyExcel(bytes)) {
    throw new ImportFileError('This is an older Excel file (.xls). Open it in Excel and save it as .xlsx or CSV, then upload it again.');
  }
  if (EXCEL_EXTENSIONS.test(fileName) || looksLikeZip(bytes)) {
    try {
      const workbook = readXlsx(bytes, { sheet, maxRows: IMPORT_LIMITS.MAX_ROWS + 20, maxColumns: IMPORT_LIMITS.MAX_COLUMNS });
      if (workbook.truncated) throw new ImportTooManyRowsError(IMPORT_LIMITS.MAX_ROWS);
      const shaped = shapeRows(workbook.rows);
      return { kind: 'excel', ...shaped, sheets: workbook.sheets.filter((entry) => !entry.hidden).map((entry) => entry.name), sheet: workbook.sheet, digest };
    } catch (error) {
      if (error instanceof SpreadsheetError) throw new ImportFileError(error.message);
      throw error;
    }
  }
  if (!TEXT_EXTENSIONS.test(fileName) && looksBinary(bytes)) {
    throw new ImportFileError('This file type is not supported. Upload a CSV, TSV or Excel (.xlsx) file, or paste a Google Sheets link.');
  }
  return tableFromText(decodeText(bytes), 'csv', bytes);
}

export function tableFromText(text: string, kind: Exclude<ImportSourceKind, 'excel'>, digestSource?: Uint8Array): ImportTable {
  if (!text.trim()) throw new ImportFileError(kind === 'paste' ? 'Paste at least a header row and one row of leads.' : 'The file is empty.');
  let parsed;
  try {
    parsed = parseText(text);
  } catch (error) {
    if (error instanceof CsvParseError) throw new ImportFileError(`The file could not be read: ${error.message.replace(/^CSV parse error/, 'a quote is not closed')}.`);
    throw error;
  }
  const shaped = shapeRows([[...parsed.header], ...parsed.rows.map((row) => [...row])]);
  return { kind, ...shaped, sheets: [], sheet: null, digest: sha256(digestSource ?? new TextEncoder().encode(text)) };
}

/**
 * Pick the header row, square the table and enforce the limits. The header is
 * the first of the opening rows that is about as full as the fullest one, so a
 * title line above it ("Leads — November") is skipped. A first row that holds
 * phone numbers or emails is data, and the columns get generic names.
 */
export function shapeRows(input: readonly (readonly string[])[]): { headers: string[]; rows: string[][] } {
  const rows = input
    .map((row) => row.map((cell) => cleanCell(cell)))
    .filter((row) => row.some((cell) => cell !== ''));
  if (rows.length === 0) throw new ImportFileError('The file has no rows.');

  const width = Math.min(
    IMPORT_LIMITS.MAX_COLUMNS,
    Math.max(...rows.map((row) => lastFilledIndex(row) + 1)),
  );
  const opening = rows.slice(0, 10);
  const fullest = Math.max(...opening.map(filledCount));
  let headerIndex = opening.findIndex((row) => filledCount(row) >= Math.max(2, Math.ceil(fullest * 0.6)));
  if (headerIndex < 0) headerIndex = 0;

  const candidate = rows[headerIndex]!;
  const headerIsData = candidate.some((cell) => looksLikeContactValue(cell));
  const headers = headerIsData
    ? Array.from({ length: width }, (_unused, index) => `Column ${index + 1}`)
    : uniqueHeaders(Array.from({ length: width }, (_unused, index) => candidate[index] ?? ''));
  const data = rows.slice(headerIsData ? headerIndex : headerIndex + 1).map((row) => Array.from({ length: width }, (_unused, index) => row[index] ?? ''));
  if (data.length === 0) throw new ImportFileError('The file has a header row but no leads under it.');
  if (data.length > IMPORT_LIMITS.MAX_ROWS) throw new ImportTooManyRowsError(IMPORT_LIMITS.MAX_ROWS);
  return { headers, rows: data };
}

function cleanCell(value: string | undefined): string {
  if (!value) return '';
  const text = value.replaceAll('\u0000', '').replace(/\r\n?/g, '\n').trim();
  return text.length > IMPORT_LIMITS.MAX_CELL_CHARS ? text.slice(0, IMPORT_LIMITS.MAX_CELL_CHARS) : text;
}

function filledCount(row: readonly string[]): number {
  return row.filter((cell) => cell !== '').length;
}

function lastFilledIndex(row: readonly string[]): number {
  for (let index = row.length - 1; index >= 0; index--) if (row[index] !== '') return index;
  return -1;
}

function looksLikeContactValue(cell: string): boolean {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cell)) return true;
  return /^[+(]?[\d\s().-]{7,20}$/.test(cell) && cell.replace(/\D/g, '').length >= 7;
}

function uniqueHeaders(raw: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((header, index) => {
    const base = header.replace(/\s+/g, ' ').trim() || `Column ${index + 1}`;
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 1024));
  let control = 0;
  for (const byte of sample) if (byte < 9 || (byte > 13 && byte < 32)) control++;
  // UTF-16 text has many zero bytes but no other control characters.
  const zeros = sample.filter((byte) => byte === 0).length;
  return control - zeros > sample.length * 0.05 || (zeros > 0 && zeros < sample.length * 0.2);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
