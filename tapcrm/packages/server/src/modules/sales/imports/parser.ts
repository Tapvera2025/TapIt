/**
 * Delimited text (CSV, TSV, semicolon or pipe separated) for lead imports.
 *
 * No npm dependency: a small RFC-4180 reader covers what people export from
 * Excel, Google Sheets, Numbers and other CRMs:
 *   - quoted fields with embedded delimiters and newlines
 *   - "" escape for a literal quote inside a quoted field
 *   - \r\n, \r and \n row terminators, and a trailing newline
 *   - a UTF-8 BOM, UTF-16 (Excel's "Unicode text") and Windows-1252
 *     (Excel's plain "CSV" on Windows) byte encodings
 *   - Excel's `sep=;` first line, and delimiter detection when it is absent
 *
 * Not supported: the backslash-escape dialect (ESCAPE '\').
 */

export interface ParsedCsv {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export class CsvParseError extends Error {
  constructor(public readonly line: number, message: string) {
    super(`CSV parse error at line ${line}: ${message}`);
    this.name = 'CsvParseError';
  }
}

export type Delimiter = ',' | ';' | '\t' | '|';
export const DELIMITERS: readonly Delimiter[] = [',', ';', '\t', '|'];

const BOM = '﻿';

/** RFC-4180 with a comma; kept for callers that know their file is CSV. */
export function parseCsv(input: string): ParsedCsv {
  return parseDelimited(input, ',');
}

/** Parse delimited text whose delimiter is known. The first row is the header. */
export function parseDelimited(input: string, delimiter: Delimiter): ParsedCsv {
  const rows = readRows(input.startsWith(BOM) ? input.slice(1) : input, delimiter);
  if (rows.length === 0) return { header: [], rows: [] };
  const header = rows[0]!.map((h) => h.trim());
  const dataRows = rows.slice(1).filter((r) => !(r.length === 1 && r[0] === ''));
  return { header, rows: dataRows };
}

/**
 * Parse text whose delimiter is unknown: an Excel `sep=` line wins, otherwise
 * the delimiter that splits the first lines most consistently.
 */
export function parseText(input: string): ParsedCsv & { readonly delimiter: Delimiter } {
  let text = input.startsWith(BOM) ? input.slice(1) : input;
  const hint = /^sep=(.)\r?\n/i.exec(text);
  let delimiter: Delimiter;
  if (hint && (DELIMITERS as readonly string[]).includes(hint[1]!)) {
    delimiter = hint[1] as Delimiter;
    text = text.slice(hint[0].length);
  } else {
    delimiter = detectDelimiter(text);
  }
  return { ...parseDelimited(text, delimiter), delimiter };
}

/**
 * The delimiter whose count per line is highest and most consistent across
 * the first lines, ignoring delimiters inside quotes. A single-column file
 * has none of them and reads as CSV.
 */
export function detectDelimiter(text: string): Delimiter {
  const lines = sampleLines(text, 12);
  let best: Delimiter = ',';
  let bestScore = 0;
  for (const delimiter of DELIMITERS) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter));
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    const consistent = counts.filter((count) => count === first).length;
    // Consistency matters more than raw count: a comma inside free-text
    // notes must not beat a tab that splits every line the same way.
    const score = consistent * 100 + Math.min(first, 99);
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Decode uploaded bytes. Honors a BOM; recognizes BOM-less UTF-16 by its
 * zero bytes; falls back to Windows-1252 when the bytes are not valid UTF-8.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const utf16 = guessUtf16(bytes);
  if (utf16) return new TextDecoder(utf16).decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * Project parsed rows against the header into column-keyed records.
 * Columns in the file that are not in `knownColumns` are preserved as-is.
 */
export function toRecords(parsed: ParsedCsv): Array<Readonly<Record<string, string>>> {
  const records: Record<string, string>[] = [];
  for (const row of parsed.rows) {
    const record: Record<string, string> = {};
    for (let i = 0; i < parsed.header.length; i++) {
      const key = parsed.header[i]!;
      const value = row[i] ?? '';
      record[key] = value.trim();
    }
    records.push(record);
  }
  return records;
}

/* ------------------------------------------------------------------ */

function readRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let line = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (field.trim().length !== 0) {
        throw new CsvParseError(line, 'quote cannot appear mid-field without opening quotes');
      }
      field = '';
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      line++;
      continue;
    }
    field += ch;
  }
  if (inQuotes) throw new CsvParseError(line, 'unterminated quoted field at end of input');
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function sampleLines(text: string, limit: number): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length && lines.length < limit; i++) {
    const ch = text[i]!;
    if (ch === '"') inQuotes = !inQuotes;
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (current.trim()) lines.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() && lines.length < limit) lines.push(current);
  return lines;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === delimiter) count++;
  }
  return count;
}

function guessUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const sample = bytes.subarray(0, Math.min(bytes.length, 400));
  if (sample.length < 4) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] !== 0) continue;
    if (i % 2 === 0) evenZeros++;
    else oddZeros++;
  }
  const half = sample.length / 2;
  if (oddZeros > half * 0.6 && evenZeros < half * 0.1) return 'utf-16le';
  if (evenZeros > half * 0.6 && oddZeros < half * 0.1) return 'utf-16be';
  return null;
}
