import { unzipSync } from 'fflate';

/**
 * Chat attachment type validation.
 *
 * A file is accepted only when THREE things agree: its extension names a
 * supported type, its own bytes carry that type's signature, and (for the
 * container formats) its inside has the right structure. The browser's MIME
 * label is never trusted — it is whatever the operating system guessed from
 * the extension, and an attacker controls both.
 *
 * Deliberately not accepted: executables, scripts, HTML and SVG (SVG is XML
 * that can carry script), and anything else not in the table below.
 */

export type AttachmentKind = 'image' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'text' | 'archive';

type Signature = 'jpeg' | 'png' | 'gif' | 'webp' | 'pdf' | 'ooxml' | 'odf' | 'zip' | 'ole' | 'rtf' | 'text';

interface FileTypeRule {
  readonly extensions: readonly string[];
  readonly mimeType: string;
  readonly kind: AttachmentKind;
  readonly signature: Signature;
  /** OOXML: the folder every file of this type has (`word/`, `xl/`, `ppt/`). ODF: the `mimetype` entry's content. */
  readonly marker?: string;
}

const RULES: readonly FileTypeRule[] = [
  { extensions: ['jpg', 'jpeg'], mimeType: 'image/jpeg', kind: 'image', signature: 'jpeg' },
  { extensions: ['png'], mimeType: 'image/png', kind: 'image', signature: 'png' },
  { extensions: ['gif'], mimeType: 'image/gif', kind: 'image', signature: 'gif' },
  { extensions: ['webp'], mimeType: 'image/webp', kind: 'image', signature: 'webp' },
  { extensions: ['pdf'], mimeType: 'application/pdf', kind: 'pdf', signature: 'pdf' },
  {
    extensions: ['docx'],
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'document',
    signature: 'ooxml',
    marker: 'word/',
  },
  {
    extensions: ['xlsx'],
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'spreadsheet',
    signature: 'ooxml',
    marker: 'xl/',
  },
  {
    extensions: ['pptx'],
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    kind: 'presentation',
    signature: 'ooxml',
    marker: 'ppt/',
  },
  { extensions: ['odt'], mimeType: 'application/vnd.oasis.opendocument.text', kind: 'document', signature: 'odf', marker: 'application/vnd.oasis.opendocument.text' },
  { extensions: ['ods'], mimeType: 'application/vnd.oasis.opendocument.spreadsheet', kind: 'spreadsheet', signature: 'odf', marker: 'application/vnd.oasis.opendocument.spreadsheet' },
  { extensions: ['odp'], mimeType: 'application/vnd.oasis.opendocument.presentation', kind: 'presentation', signature: 'odf', marker: 'application/vnd.oasis.opendocument.presentation' },
  { extensions: ['doc'], mimeType: 'application/msword', kind: 'document', signature: 'ole' },
  { extensions: ['xls'], mimeType: 'application/vnd.ms-excel', kind: 'spreadsheet', signature: 'ole' },
  { extensions: ['ppt'], mimeType: 'application/vnd.ms-powerpoint', kind: 'presentation', signature: 'ole' },
  { extensions: ['rtf'], mimeType: 'application/rtf', kind: 'document', signature: 'rtf' },
  { extensions: ['csv'], mimeType: 'text/csv', kind: 'spreadsheet', signature: 'text' },
  { extensions: ['tsv'], mimeType: 'text/tab-separated-values', kind: 'spreadsheet', signature: 'text' },
  { extensions: ['txt', 'log'], mimeType: 'text/plain', kind: 'text', signature: 'text' },
  { extensions: ['md'], mimeType: 'text/markdown', kind: 'text', signature: 'text' },
  { extensions: ['json'], mimeType: 'application/json', kind: 'text', signature: 'text' },
  { extensions: ['zip'], mimeType: 'application/zip', kind: 'archive', signature: 'zip' },
];

const BY_EXTENSION = new Map<string, FileTypeRule>(RULES.flatMap((rule) => rule.extensions.map((ext) => [ext, rule] as const)));

/** Every extension the composer's file picker should offer (`accept=`), with dots. */
export const SUPPORTED_EXTENSIONS: readonly string[] = RULES.flatMap((rule) => rule.extensions.map((ext) => `.${ext}`));

export interface DetectedFileType {
  readonly mimeType: string;
  readonly kind: AttachmentKind;
  readonly extension: string;
}

export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFileError';
  }
}

const startsWith = (body: Buffer, bytes: readonly number[], offset = 0): boolean =>
  body.length >= offset + bytes.length && bytes.every((byte, index) => body[offset + index] === byte);

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Signatures of formats that must never pass as text (executables, archives, media). */
function looksBinary(body: Buffer): boolean {
  const sample = body.subarray(0, 64 * 1024);
  // UTF-16 text has a byte-order mark and NUL bytes in every other position.
  if (startsWith(sample, [0xff, 0xfe]) || startsWith(sample, [0xfe, 0xff])) return false;
  return sample.includes(0);
}

function zipEntryNames(body: Buffer): string[] {
  const names: string[] = [];
  // The filter sees each entry's header and returns false, so nothing is inflated:
  // listing a container costs a read of its central directory, not its contents.
  unzipSync(new Uint8Array(body.buffer, body.byteOffset, body.byteLength), {
    filter: (file) => {
      names.push(file.name);
      return false;
    },
  });
  return names;
}

function matchesSignature(rule: FileTypeRule, body: Buffer): boolean {
  switch (rule.signature) {
    case 'jpeg':
      return startsWith(body, [0xff, 0xd8, 0xff]);
    case 'png':
      return startsWith(body, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'gif':
      return body.subarray(0, 6).toString('latin1') === 'GIF87a' || body.subarray(0, 6).toString('latin1') === 'GIF89a';
    case 'webp':
      return body.subarray(0, 4).toString('latin1') === 'RIFF' && body.subarray(8, 12).toString('latin1') === 'WEBP';
    case 'pdf':
      // The header may follow a little leading junk; readers accept it within the first KiB.
      return body.subarray(0, 1024).includes(Buffer.from('%PDF-', 'latin1'));
    case 'ole':
      return startsWith(body, OLE);
    case 'rtf':
      return body.subarray(0, 5).toString('latin1') === '{\\rtf';
    case 'zip':
      if (!startsWith(body, ZIP) && !startsWith(body, [0x50, 0x4b, 0x05, 0x06])) return false;
      try {
        zipEntryNames(body);
        return true;
      } catch {
        return false;
      }
    case 'ooxml': {
      if (!startsWith(body, ZIP)) return false;
      try {
        const names = zipEntryNames(body);
        return names.includes('[Content_Types].xml') && names.some((name) => name.startsWith(rule.marker ?? '\u0000'));
      } catch {
        return false;
      }
    }
    case 'odf':
      // ODF requires an uncompressed first entry named `mimetype` holding the type.
      return startsWith(body, ZIP)
        && body.subarray(30, 38).toString('latin1') === 'mimetype'
        && body.subarray(38, 38 + (rule.marker?.length ?? 0)).toString('latin1') === rule.marker;
    case 'text':
      return !looksBinary(body)
        && !startsWith(body, ZIP)
        && !startsWith(body, OLE)
        && !startsWith(body, [0x4d, 0x5a]) // "MZ": a Windows executable
        && !startsWith(body, [0x7f, 0x45, 0x4c, 0x46]); // ELF
    default:
      return false;
  }
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 || dot === fileName.length - 1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/** Human list for error messages. */
const SUPPORTED_SUMMARY = 'images (JPG, PNG, GIF, WebP), PDF, Word/Docs (DOC, DOCX, ODT, RTF, TXT, MD), spreadsheets (XLS, XLSX, ODS, CSV), presentations (PPT, PPTX, ODP) and ZIP';

/**
 * Establishes the type from the file name and bytes, or throws
 * `UnsupportedFileError` with a message the uploader can act on.
 */
export function detectFileType(fileName: string, body: Buffer): DetectedFileType {
  const extension = extensionOf(fileName);
  const rule = BY_EXTENSION.get(extension);
  if (!rule) {
    throw new UnsupportedFileError(
      extension
        ? `.${extension} files can't be shared in chat. Supported: ${SUPPORTED_SUMMARY}.`
        : `Add a file extension (for example .pdf) so the file type can be checked. Supported: ${SUPPORTED_SUMMARY}.`,
    );
  }
  if (!matchesSignature(rule, body)) {
    throw new UnsupportedFileError(`This file's content doesn't match its .${extension} extension, so it can't be shared.`);
  }
  return { mimeType: rule.mimeType, kind: rule.kind, extension };
}

/**
 * A file name safe to store and to put in a Content-Disposition header: no
 * path, no control characters, no characters filesystems or headers trip on,
 * at most 255 characters with the extension kept.
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = Array.from(base.normalize('NFC'))
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (code < 32 || code === 127) return '';
      return '<>:"|?*'.includes(character) ? '_' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (cleaned.length <= 255) return cleaned;
  const extension = extensionOf(cleaned);
  const keep = extension ? 255 - extension.length - 1 : 255;
  return extension ? `${Array.from(cleaned).slice(0, keep).join('').trimEnd()}.${extension}` : Array.from(cleaned).slice(0, 255).join('');
}
