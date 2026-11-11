import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { downloadTitle, exportUrl, fetchGoogleSheetCsv, GoogleSheetError, parseGoogleSheetUrl } from './google-sheets.js';
import { decodeText, detectDelimiter, parseText } from './parser.js';
import { shapeRows, tableFromFile, tableFromText } from './table.js';
import { columnIndex, excelDate, formatNumber, isDateFormatCode, readXlsx } from './xlsx.js';

/** A minimal workbook, the way Excel writes one. */
function workbook(options: { sheets?: Array<{ name: string; hidden?: boolean; xml: string }>; sharedStrings?: string[]; styles?: string; date1904?: boolean } = {}): Uint8Array {
  const sheets = options.sheets ?? [];
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<workbookPr${options.date1904 ? ' date1904="1"' : ''}/><sheets>` +
        sheets.map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}"${sheet.hidden ? ' state="hidden"' : ''} r:id="rId${index + 1}"/>`).join('') +
        `</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets.map((_sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('') +
        `</Relationships>`,
    ),
  };
  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet.xml}</sheetData></worksheet>`);
  });
  if (options.sharedStrings) {
    files['xl/sharedStrings.xml'] = strToU8(`<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${options.sharedStrings.join('')}</sst>`);
  }
  if (options.styles) files['xl/styles.xml'] = strToU8(options.styles);
  return zipSync(files);
}

describe('delimited text', () => {
  it('detects commas, semicolons, tabs and pipes', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('Name;Phone;City\nAmit;98765, ext 2;Pune\nNeha;91234;Goa')).toBe(';');
    expect(detectDelimiter('Name\tPhone\nAmit\t9876543210')).toBe('\t');
    expect(detectDelimiter('a|b\n1|2')).toBe('|');
    expect(detectDelimiter('just one column\nvalue')).toBe(',');
  });

  it("honors Excel's sep= line", () => {
    expect(parseText('sep=;\na;b\n1;2')).toMatchObject({ delimiter: ';', header: ['a', 'b'], rows: [['1', '2']] });
  });

  it('decodes UTF-8, UTF-16 and Windows-1252 bytes', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A');
    const utf16 = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x0a, 0x00, 0x42, 0x00]);
    expect(decodeText(utf16)).toBe('A\nB');
    expect(decodeText(new Uint8Array([0x41, 0x00, 0x42, 0x00, 0x43, 0x00, 0x44, 0x00]))).toBe('ABCD');
    expect(decodeText(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toBe('Café');
  });
});

describe('table shape', () => {
  it('skips a title line above the header and squares the rows', () => {
    const shaped = shapeRows([['Leads — November'], ['Name', 'Phone', 'City'], ['Amit', '9876543210'], [], ['Neha', '9123456789', 'Goa', '']]);
    expect(shaped.headers).toEqual(['Name', 'Phone', 'City']);
    expect(shaped.rows).toEqual([
      ['Amit', '9876543210', ''],
      ['Neha', '9123456789', 'Goa'],
    ]);
  });

  it('names columns when the first row is already data, and de-duplicates headers', () => {
    expect(shapeRows([['Amit', '9876543210'], ['Neha', '9123456789']]).headers).toEqual(['Column 1', 'Column 2']);
    expect(shapeRows([['Phone', 'Phone', ''], ['1', '2', '3']]).headers).toEqual(['Phone', 'Phone (2)', 'Column 3']);
  });

  it('refuses empty files, header-only files and old Excel files', () => {
    expect(() => tableFromText('   ', 'paste')).toThrow(/Paste at least/);
    expect(() => tableFromText('Name,Phone\n', 'csv')).toThrow(/no leads under it/);
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(() => tableFromFile('leads.xls', xls)).toThrow(/older Excel file/);
  });

  it('reads a pasted block copied from a spreadsheet', () => {
    const table = tableFromText('Client Name\tNumber\nAmit\t98765 43210\n', 'paste');
    expect(table).toMatchObject({ kind: 'paste', headers: ['Client Name', 'Number'], rows: [['Amit', '98765 43210']] });
    expect(table.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Excel workbooks', () => {
  const sharedStrings = ['<si><t>Client Name</t></si>', '<si><t>Number</t></si>', '<si><r><t>Amit </t></r><r><rPr/><t xml:space="preserve">Shah</t></r><rPh><t>X</t></rPh></si>', '<si><t>A &amp; B_x000D_</t></si>'];

  it('reads shared, rich and inline strings, numbers and dates from the first visible sheet', () => {
    const bytes = workbook({
      sharedStrings,
      styles: '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>',
      sheets: [
        { name: 'Hidden', hidden: true, xml: '<row r="1"><c r="A1" t="inlineStr"><is><t>secret</t></is></c></row>' },
        {
          name: 'Leads',
          xml:
            '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Since</t></is></c></row>' +
            '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>9.19876543210E+11</v></c><c r="C2" s="1"><v>45600</v></c></row>' +
            '<row r="4"><c r="A4" t="s"><v>3</v></c><c r="C4" t="b"><v>1</v></c></row>',
        },
      ],
    });
    const result = readXlsx(bytes);
    expect(result.sheet).toBe('Leads');
    expect(result.sheets).toEqual([{ name: 'Hidden', hidden: true }, { name: 'Leads', hidden: false }]);
    expect(result.rows).toEqual([
      ['Client Name', 'Number', 'Since'],
      ['Amit Shah', '919876543210', '2024-11-04'],
      ['A & B', '', 'TRUE'],
    ]);
    expect(readXlsx(bytes, { sheet: 'Hidden' }).rows).toEqual([['secret']]);
  });

  it('turns a workbook into an import table and lists its sheets', () => {
    const bytes = workbook({
      sharedStrings,
      sheets: [
        { name: 'November', xml: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>9876543210</v></c></row>' },
        { name: 'December', xml: '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row>' },
      ],
    });
    const table = tableFromFile('Leads.xlsx', bytes);
    expect(table).toMatchObject({ kind: 'excel', sheet: 'November', sheets: ['November', 'December'], headers: ['Client Name', 'Number'], rows: [['Amit Shah', '9876543210']] });
  });

  it('refuses damaged zips and other spreadsheet formats with a way out', () => {
    expect(() => readXlsx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toThrow(/damaged|not an Excel/);
    const ods = zipSync({ mimetype: strToU8('application/vnd.oasis.opendocument.spreadsheet'), 'content.xml': strToU8('<x/>') });
    expect(() => readXlsx(ods)).toThrow(/OpenDocument/);
  });

  it('converts serial dates, numbers and column letters', () => {
    expect(excelDate(45600)).toBe('2024-11-04');
    expect(excelDate(45600.5)).toBe('2024-11-04 12:00');
    expect(excelDate(1)).toBe('1900-01-01');
    expect(excelDate(0, true)).toBe('1904-01-01');
    expect(formatNumber('0.30000000000000004')).toBe('0.3');
    expect(formatNumber('12.5')).toBe('12.5');
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('AB12')).toBe(27);
    expect(isDateFormatCode('dd/mm/yyyy')).toBe(true);
    expect(isDateFormatCode('[Red]#,##0.00')).toBe(false);
    expect(isDateFormatCode('"Rs" #,##0')).toBe(false);
  });
});

describe('Google Sheets links', () => {
  it('reads the spreadsheet id and tab from the usual link shapes', () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    expect(parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=123`)).toEqual({ spreadsheetId: id, gid: '123', published: false });
    expect(parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/u/1/d/${id}/edit?usp=sharing`)).toEqual({ spreadsheetId: id, gid: null, published: false });
    expect(parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/e/2PACX-${id}/pubhtml?gid=5&single=true`)).toEqual({ spreadsheetId: `2PACX-${id}`, gid: '5', published: true });
    expect(parseGoogleSheetUrl('https://evil.example.com/spreadsheets/d/abc/edit')).toBeNull();
    expect(parseGoogleSheetUrl('not a link')).toBeNull();
  });

  it('builds the CSV export address from the id alone', () => {
    expect(exportUrl({ spreadsheetId: 'abc', gid: '7', published: false })).toBe('https://docs.google.com/spreadsheets/d/abc/export?format=csv&gid=7');
    expect(exportUrl({ spreadsheetId: 'xyz', gid: null, published: true })).toBe('https://docs.google.com/spreadsheets/d/e/xyz/pub?output=csv');
  });

  it('follows Google redirects, reads the CSV and its title', async () => {
    const calls: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      if (url.startsWith('https://docs.google.com/')) return new Response(null, { status: 307, headers: { location: 'https://doc-0s-sheets.googleusercontent.com/export/abc' } });
      return new Response('Name,Phone\nAmit,9876543210\n', {
        status: 200,
        headers: { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="Leads - Sheet1.csv"; filename*=UTF-8''Leads%20-%20Sheet1.csv` },
      });
    }) as typeof fetch;
    const sheet = await fetchGoogleSheetCsv({ spreadsheetId: 'abc', gid: null, published: false }, fetcher);
    expect(sheet.text).toBe('Name,Phone\nAmit,9876543210\n');
    expect(sheet.title).toBe('Leads - Sheet1');
    expect(calls).toHaveLength(2);
  });

  it('explains a private sheet and refuses redirects off Google', async () => {
    const toLogin = (async () => new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/ServiceLogin' } })) as unknown as typeof fetch;
    await expect(fetchGoogleSheetCsv({ spreadsheetId: 'abc', gid: null, published: false }, toLogin)).rejects.toThrow(/Anyone with the link/);
    const html = (async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    await expect(fetchGoogleSheetCsv({ spreadsheetId: 'abc', gid: null, published: false }, html)).rejects.toBeInstanceOf(GoogleSheetError);
    const offsite = (async () => new Response(null, { status: 302, headers: { location: 'https://evil.example.com/x' } })) as unknown as typeof fetch;
    await expect(fetchGoogleSheetCsv({ spreadsheetId: 'abc', gid: null, published: false }, offsite)).rejects.toThrow(GoogleSheetError);
  });

  it('reads download names', () => {
    expect(downloadTitle('attachment; filename="Expo List.csv"')).toBe('Expo List');
    expect(downloadTitle(null)).toBeNull();
  });
});
