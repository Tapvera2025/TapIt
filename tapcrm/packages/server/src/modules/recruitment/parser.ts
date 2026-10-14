import type { ParsedResumeData } from './types.js';
import { extractResumeText } from './resume-text.js';
import { parseResumeExtraction, RESUME_PARSER_VERSION } from './resume-parser/index.js';

/**
 * Plain text of a resume, one line per `\n`. Unreadable files give an empty
 * string — never the raw bytes, which used to leak binary noise into previews.
 */
export async function extractTextFromResume(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  return (await extractResumeText(buffer, filename, mimeType)).text;
}

/**
 * Structured candidate information from a resume file: contact details with
 * confidence, work history, education, skills and links. Parsing is local and
 * rule-based (see resume-parser/), and never throws — a file it cannot read
 * yields an empty result with the reason in `warnings`.
 */
export async function parseResume(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<ParsedResumeData> {
  const extraction = await extractResumeText(buffer, filename, mimeType);
  try {
    return parseResumeExtraction(extraction);
  } catch {
    return {
      parserVersion: RESUME_PARSER_VERSION,
      warnings: [...extraction.issues, 'The resume text could not be analysed; fill in the details manually.'],
      rawTextPreview: extraction.text.slice(0, 1000),
    };
  }
}
