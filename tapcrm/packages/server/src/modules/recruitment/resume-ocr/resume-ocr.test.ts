import { readFileSync } from 'node:fs';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateResume } from '../ats/engine.js';
import { parseResume } from '../parser.js';
import { extractResumeText, OCR_NOTE } from '../resume-text.js';
import { __clearOcrCache, readScannedPdfPages, stopResumeOcr } from './index.js';

/**
 * A made-up one-page resume (fictional person) printed to a black-and-white
 * 170 dpi image inside a PDF with no text layer — what an office scanner makes.
 * Its section names sit in a left margin.
 */
const SCANNED = readFileSync(new URL('./__fixtures__/scanned-resume.pdf', import.meta.url));

/** A one-page PDF with no text and no pictures. */
function blankPdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

afterEach(() => vi.unstubAllEnvs());
afterAll(() => stopResumeOcr());

describe('scanned resumes (text recognition)', () => {
  it('reads a scanned resume like a typed one, marking every detail for a check', async () => {
    __clearOcrCache();
    const parsed = await parseResume(SCANNED, 'scan.pdf', 'application/pdf');
    expect(parsed).toMatchObject({
      name: 'Priyanka Deshmukh',
      email: 'priyanka.d@outlook.com',
      phone: '+91 98220 12345',
      confidence: { name: 'medium', email: 'medium', phone: 'medium' },
      ocr: { pages: 1 },
    });
    expect(parsed.ocr?.confidence).toBeGreaterThan(80);
    expect(parsed.experience?.map((job) => [job.title, job.company, job.startDate])).toEqual([
      ['Audit Manager', 'Deloitte', '2019-08'],
      ['Senior Accountant', 'Tata Motors', '2016-06'],
    ]);
    expect(parsed.education).toEqual([
      { degree: 'B.Com', field: 'Accounting', institution: 'Savitribai Phule Pune University, Pune', year: '2016' },
    ]);
    expect(parsed.skills).toEqual(expect.arrayContaining(['Statutory Audit', 'GST Compliance', 'Tally ERP']));
    expect(parsed.warnings?.[0]).toBe(OCR_NOTE);
  }, 120_000);

  it('reads each file once: the form, the saved application and an ATS scan share the result', async () => {
    const started = Date.now();
    const again = await extractResumeText(SCANNED, 'scan.pdf', 'application/pdf');
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(again.ocr?.pages).toBe(1);

    const evaluation = evaluateResume(again, {
      requiredSkills: ['Statutory Audit', 'GST Compliance'],
      preferredSkills: [],
      minimumExperienceYears: 5,
      requiredQualifications: ['B.Com'],
    }, { asOf: new Date('2026-10-05T00:00:00Z') });
    expect(evaluation.status).toBe('completed');
    expect(evaluation.extraction).toMatchObject({ format: 'pdf', ocrPages: 1 });
    expect(evaluation.warnings).toContain(OCR_NOTE);
  });

  it('says why nothing was read when text recognition is turned off', async () => {
    vi.stubEnv('RESUME_OCR', 'false');
    const extraction = await extractResumeText(SCANNED, 'scan.pdf', 'application/pdf');
    expect(extraction.text).toBe('');
    expect(extraction.ocr).toBeUndefined();
    expect(extraction.issues).toEqual([expect.stringContaining('turned off on this server')]);
    await expect(readScannedPdfPages('any', [1], () => Promise.reject(new Error('not read')), {}, { enabled: false }))
      .resolves.toEqual({ status: 'off', pages: [], skipped: 1, confidence: null });
  });

  it('says so when a PDF has neither text nor a picture to read', async () => {
    const extraction = await extractResumeText(blankPdf(), 'blank.pdf', 'application/pdf');
    expect(extraction.issues).toEqual([expect.stringContaining('no scanned image to read')]);
  });
});
