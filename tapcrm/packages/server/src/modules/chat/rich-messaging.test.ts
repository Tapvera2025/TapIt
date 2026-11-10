import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { isSingleEmoji, normalizeEmoji } from './emoji.js';
import { detectFileType, sanitizeFileName, UnsupportedFileError } from './file-types.js';
import { extractLinks, normalizeUrl } from './links.js';
import { decodeEntities, detectProvider, parsePageMeta } from './link-preview.js';
import { previewText, toPlainText } from './plain-text.js';
import { assertFetchableUrl, BlockedUrlError, isPublicAddress } from './safe-fetch.js';
import { prefixQuery, searchTerms } from './search.js';
import { coarsePresence } from './presence.js';
import { reactionSchema, scheduleMessageSchema, searchQuerySchema, sendMessageSchema } from './validators.js';

/* Minimal valid file headers for the signature checks. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
const OLE = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64, 2)]);
const DOCX = Buffer.from(zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8('<w:document/>') }));
const XLSX = Buffer.from(zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'xl/workbook.xml': strToU8('<workbook/>') }));
const ZIP = Buffer.from(zipSync({ 'notes.txt': strToU8('hello') }));
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0)]);

describe('chat attachment type validation', () => {
  it('accepts each supported type only when the bytes match the extension', () => {
    expect(detectFileType('screenshot.png', PNG)).toEqual({ mimeType: 'image/png', kind: 'image', extension: 'png' });
    expect(detectFileType('photo.JPG', JPEG).kind).toBe('image');
    expect(detectFileType('Invoice #42.pdf', PDF)).toMatchObject({ mimeType: 'application/pdf', kind: 'pdf' });
    expect(detectFileType('contract.docx', DOCX).kind).toBe('document');
    expect(detectFileType('budget.xlsx', XLSX).kind).toBe('spreadsheet');
    expect(detectFileType('legacy.xls', OLE).kind).toBe('spreadsheet');
    expect(detectFileType('archive.zip', ZIP).kind).toBe('archive');
    expect(detectFileType('leads.csv', Buffer.from('name,phone\nA,1\n')).mimeType).toBe('text/csv');
  });

  it('refuses a file whose content does not match its extension', () => {
    expect(() => detectFileType('fake.png', PDF)).toThrow(UnsupportedFileError);
    expect(() => detectFileType('fake.pdf', PNG)).toThrow(UnsupportedFileError);
    // A zip is not a .docx unless it has a Word document inside.
    expect(() => detectFileType('fake.docx', ZIP)).toThrow(UnsupportedFileError);
    expect(() => detectFileType('fake.xlsx', DOCX)).toThrow(UnsupportedFileError);
    // An executable renamed to .txt / .csv.
    expect(() => detectFileType('readme.txt', EXE)).toThrow(UnsupportedFileError);
    expect(() => detectFileType('data.csv', OLE)).toThrow(UnsupportedFileError);
  });

  it('refuses unsupported and extensionless files with an actionable message', () => {
    expect(() => detectFileType('installer.exe', EXE)).toThrow(/\.exe files can't be shared/);
    expect(() => detectFileType('logo.svg', Buffer.from('<svg/>'))).toThrow(UnsupportedFileError);
    expect(() => detectFileType('page.html', Buffer.from('<html>'))).toThrow(UnsupportedFileError);
    expect(() => detectFileType('README', Buffer.from('hello'))).toThrow(/Add a file extension/);
  });

  it('sanitizes names: no path, no control characters, at most 255 characters with the extension kept', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\me\\Q3 "final".pdf')).toBe('Q3 _final_.pdf');
    expect(sanitizeFileName('bad\u0000name\u0007.png')).toBe('badname.png');
    expect(sanitizeFileName('...hidden.txt')).toBe('hidden.txt');
    const long = sanitizeFileName(`${'a'.repeat(400)}.xlsx`);
    expect(long.length).toBeLessThanOrEqual(255);
    expect(long.endsWith('.xlsx')).toBe(true);
  });
});

describe('reactions: any single emoji', () => {
  it('accepts RGI emoji including skin tones, ZWJ sequences, keycaps and flags', () => {
    for (const emoji of ['👍', '👍🏽', '❤️', '🇮🇳', '👨‍👩‍👧', '1️⃣', '🫠', '🏳️‍🌈']) expect(isSingleEmoji(emoji)).toBe(true);
  });

  it('refuses text, two emoji and empty strings, and normalises a missing variation selector', () => {
    for (const value of ['a', 'ok', '👍👍', '', ' ']) expect(isSingleEmoji(value)).toBe(false);
    expect(normalizeEmoji('❤')).toBe('❤️');
    expect(reactionSchema.parse({ emoji: '❤' }).emoji).toBe('❤️');
    expect(() => reactionSchema.parse({ emoji: 'lol' })).toThrow();
  });
});

describe('message text', () => {
  it('strips formatting markers for notifications without touching snake_case or maths', () => {
    expect(toPlainText('*Invoice* is _ready_ and ~old~ `code` here')).toBe('Invoice is ready and old code here');
    expect(toPlainText('**Bold** move')).toBe('Bold move');
    expect(toPlainText('use file_name_v2 and 2*3*4')).toBe('use file_name_v2 and 2*3*4');
    expect(toPlainText('> quoted\n- item one\n* item two')).toBe('quoted\n• item one\n• item two');
    expect(toPlainText('see [the spec](https://example.com/spec)')).toBe('see the spec');
    expect(toPlainText('```js\nconst x = 1;\n```')).toBe('const x = 1;');
    expect(previewText('line one\nline two', 12)).toBe('line one li…');
  });

  it('finds the links people share, but not inside code', () => {
    expect(extractLinks('See https://figma.com/design/abc/Home-page?node-id=1. Thanks!')).toEqual(['https://figma.com/design/abc/Home-page?node-id=1']);
    expect(extractLinks('Wiki (https://en.wikipedia.org/wiki/Foo_(bar)) ok')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)']);
    expect(extractLinks('run `curl https://internal/api` or\n```\nhttps://hidden.example\n```')).toEqual([]);
    expect(extractLinks('dupe https://a.com/x and https://a.com/x#frag')).toEqual(['https://a.com/x']);
    expect(normalizeUrl('ftp://example.com')).toBeNull();
    expect(normalizeUrl('https://user:pass@example.com')).toBeNull();
  });
});

describe('message input validation', () => {
  it('a message needs text or a file', () => {
    expect(() => sendMessageSchema.parse({ body: '   ' })).toThrow(/cannot be empty/);
    expect(sendMessageSchema.parse({ body: '', attachmentIds: ['0198c1d2-0000-7000-8000-000000000001'] }).body).toBe('');
    expect(sendMessageSchema.parse({ body: '  hi  ' }).body).toBe('hi');
  });

  it('search needs a query or a filter; scheduling needs a time', () => {
    expect(() => searchQuerySchema.parse({})).toThrow();
    expect(searchQuerySchema.parse({ type: 'pdf' }).type).toBe('pdf');
    expect(() => scheduleMessageSchema.parse({ body: 'hi' })).toThrow();
  });
});

describe('search query building', () => {
  it('turns any input into safe prefix terms (no tsquery syntax survives)', () => {
    expect(searchTerms("Invoice Q3 & client's 'approval' | !")).toEqual(['invoice', 'q3', 'client', 's', 'approval']);
    expect(prefixQuery(searchTerms('Ravi Kumar'))).toBe('ravi:* & kumar:*');
    expect(searchTerms('नमस्ते दुनिया')).toEqual(['नमस्ते', 'दुनिया']);
    expect(searchTerms('   ')).toEqual([]);
  });
});

describe('presence mapping from live-status', () => {
  it('green when working, orange on a break, grey otherwise', () => {
    const at = { shiftStartAt: null, shiftEndAt: null };
    expect(coarsePresence({ state: 'WORKING', dayGroup: null, ...at })).toBe('active');
    expect(coarsePresence({ state: 'ON_BREAK', dayGroup: null, ...at })).toBe('idle');
    expect(coarsePresence({ state: 'FINISHED', dayGroup: null, ...at })).toBe('offline');
    expect(coarsePresence({ state: 'NOT_IN', dayGroup: null, ...at })).toBe('offline');
    expect(coarsePresence({ state: 'WORKING', dayGroup: 'leave', ...at })).toBe('offline');
    expect(coarsePresence(undefined)).toBe('offline');
  });

  it('anyone with TapIt open is green, unless they are on a break', () => {
    const at = { shiftStartAt: null, shiftEndAt: null };
    expect(coarsePresence(undefined, true)).toBe('active');
    expect(coarsePresence({ state: 'NOT_IN', dayGroup: null, ...at }, true)).toBe('active');
    expect(coarsePresence({ state: 'FINISHED', dayGroup: null, ...at }, true)).toBe('active');
    expect(coarsePresence({ state: 'WORKING', dayGroup: 'holiday', ...at }, true)).toBe('active');
    expect(coarsePresence({ state: 'ON_BREAK', dayGroup: null, ...at }, true)).toBe('idle');
  });
});

describe('link preview safety (SSRF)', () => {
  it('only public unicast addresses are fetchable', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(isPublicAddress(address)).toBe(true);
    for (const address of [
      '127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
      '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '224.0.0.1', 'not-an-ip',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it('refuses other schemes, embedded credentials, non-web ports and private literals', () => {
    expect(() => assertFetchableUrl('file:///etc/passwd')).toThrow(BlockedUrlError);
    expect(() => assertFetchableUrl('http://user:pw@example.com/')).toThrow(BlockedUrlError);
    expect(() => assertFetchableUrl('http://example.com:6379/')).toThrow(BlockedUrlError);
    expect(() => assertFetchableUrl('http://127.0.0.1/')).toThrow(BlockedUrlError);
    expect(() => assertFetchableUrl('http://[::1]/')).toThrow(BlockedUrlError);
    expect(() => assertFetchableUrl('http://169.254.169.254/latest/meta-data')).toThrow(BlockedUrlError);
    expect(assertFetchableUrl('https://github.com/org/repo').hostname).toBe('github.com');
  });
});

describe('link preview parsing', () => {
  const html = `<!doctype html><html><head>
    <title>Fallback title</title>
    <meta property="og:title" content="Q3 Roadmap &amp; Plan">
    <meta name="description" content="Plain description">
    <meta property="og:description" content='OG &quot;description&quot;'>
    <meta property="og:site_name" content="Example">
    <meta property="og:image" content="/img/card.png">
  </head><body><meta property="og:title" content="ignored body tag"></body></html>`;

  it('prefers Open Graph, decodes entities and resolves a relative image', () => {
    expect(parsePageMeta(html, 'https://example.com/roadmap')).toEqual({
      title: 'Q3 Roadmap & Plan',
      description: 'OG "description"',
      siteName: 'Example',
      image: 'https://example.com/img/card.png',
    });
  });

  it('falls back to <title> and meta description', () => {
    const meta = parsePageMeta('<head><title> Just a page </title><meta name="description" content="About it"></head>', 'https://x.test/');
    expect(meta).toEqual({ title: 'Just a page', description: 'About it', siteName: null, image: null });
    expect(decodeEntities('&#x1F44D; &#39;q&#39; &unknown;')).toBe("👍 'q' &unknown;");
  });

  it('recognises the products a services team shares, with a title from the URL alone', () => {
    expect(detectProvider('https://www.figma.com/design/AbC123/Homepage-Redesign?node-id=1-2')).toEqual({
      provider: 'figma', siteName: 'Figma', fallbackTitle: 'Homepage Redesign',
    });
    expect(detectProvider('https://github.com/tapvera/crm/pull/42')?.fallbackTitle).toBe('tapvera/crm#42');
    expect(detectProvider('https://docs.google.com/spreadsheets/d/1xyz/edit')?.provider).toBe('google-sheets');
    expect(detectProvider('https://docs.google.com/document/d/1xyz/edit')?.siteName).toBe('Google Docs');
    expect(detectProvider('https://www.loom.com/share/abc')?.provider).toBe('loom');
    expect(detectProvider('https://example.com/')).toBeNull();
  });
});
