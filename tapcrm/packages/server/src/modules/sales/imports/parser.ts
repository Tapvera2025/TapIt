/**
 * Sales v1.1 — minimal RFC-4180 CSV parser (R1 plan step 1.11).
 *
 * No npm dependency: imports are a Super-Admin pilot tool, so a small
 * inline parser avoids pulling in `papaparse` or `csv-parse` for the
 * one use case. XLSX is deferred — the pilot flows through CSV.
 *
 * Supports:
 *   - quoted fields with embedded commas and newlines
 *   - "" escape for a literal quote inside a quoted field
 *   - \r\n, \r and \n row terminators
 *   - UTF-8 BOM stripping
 *   - trailing-newline tolerance
 *
 * Does NOT support:
 *   - alternative delimiters
 *   - escape-char CSV dialect (ESCAPE '\')
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

const BOM = '﻿';

export function parseCsv(input: string): ParsedCsv {
  const stripped = input.startsWith(BOM) ? input.slice(1) : input;
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let line = 1;

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (stripped[i + 1] === '"') {
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
      if (field.length !== 0) {
        throw new CsvParseError(line, 'quote cannot appear mid-field without opening quotes');
      }
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\r') {
      if (stripped[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      line++;
      continue;
    }
    if (ch === '\n') {
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
  if (rows.length === 0) return { header: [], rows: [] };
  const header = rows[0]!.map((h) => h.trim());
  const dataRows = rows.slice(1).filter((r) => !(r.length === 1 && r[0] === ''));
  return { header, rows: dataRows };
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
