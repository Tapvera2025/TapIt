import { describe, expect, it } from 'vitest';
import { decodeImage, sanitizeOriginalFilename } from './screenshots.js';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');

describe('screenshot upload validation', () => {
  it('derives the image format from content instead of the filename or browser MIME', () => {
    const result = decodeImage({ fileName: '../../secret.exe', mimeType: 'text/plain', fileBase64: png });
    expect(result.mimeType).toBe('image/png');
  });

  it('rejects invalid image content', () => {
    expect(() => decodeImage({ fileName: 'image.png', mimeType: 'image/png', fileBase64: Buffer.from('not an image').toString('base64') })).toThrow('supported JPEG, PNG, or WEBP image');
  });

  it('sanitizes the display filename without using it as a storage path', () => {
    expect(sanitizeOriginalFilename('../receipt\\final\u0000.png')).toBe('.._receipt_final.png');
    expect(sanitizeOriginalFilename('\u0000')).toBe('screenshot');
  });
});
