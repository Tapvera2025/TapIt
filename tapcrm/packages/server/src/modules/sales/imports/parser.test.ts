import { describe, expect, it } from 'vitest';
import { CsvParseError, parseCsv, toRecords } from './parser.js';

describe('parseCsv', () => {
  it('parses a simple header + rows', () => {
    const parsed = parseCsv('name,email\nRahul,rahul@example.com\nPriya,priya@example.com\n');
    expect(parsed.header).toEqual(['name', 'email']);
    expect(parsed.rows).toEqual([
      ['Rahul', 'rahul@example.com'],
      ['Priya', 'priya@example.com'],
    ]);
  });

  it('handles quoted fields with embedded commas, newlines, and escaped quotes', () => {
    const parsed = parseCsv('a,b\n"he, said ""hi""","line1\nline2"');
    expect(parsed.rows[0]).toEqual(['he, said "hi"', 'line1\nline2']);
  });

  it('strips a leading UTF-8 BOM', () => {
    const parsed = parseCsv('﻿a,b\n1,2');
    expect(parsed.header).toEqual(['a', 'b']);
  });

  it('tolerates mixed line endings', () => {
    const parsed = parseCsv('a,b\r\n1,2\r3,4\n5,6');
    expect(parsed.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
    ]);
  });

  it('throws on an unterminated quoted field', () => {
    expect(() => parseCsv('a,b\n"opened,but,never,closed')).toThrow(CsvParseError);
  });
});

describe('toRecords', () => {
  it('maps rows into header-keyed records with trimmed whitespace', () => {
    const parsed = parseCsv('name,  email\nRahul,  rahul@example.com');
    const records = toRecords(parsed);
    expect(records[0]).toEqual({ name: 'Rahul', email: 'rahul@example.com' });
  });
});
