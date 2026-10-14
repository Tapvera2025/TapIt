import type { ParsedFieldConfidence, ParsedResumeData } from '@tapcrm/contracts';
import { buildResumeDocument, estimateExperience, findDateRanges, type ResumeDocument } from '../ats/text.js';
import type { ResumeTextExtraction } from '../resume-text.js';
import { findEmails, findLinks, findPhones, type ContactLine } from './contact.js';
import { isBullet, isPlace, parseEducation, parseExperience, parseProjects, titleScore } from './entries.js';
import { findName, type NameLine } from './name.js';
import { extractSkills } from './skills.js';

/**
 * Rule-based resume parser. Runs entirely on our servers: no resume text is
 * sent to any external AI or parsing service.
 *
 * Bump the version when the output changes in a way stored records would
 * reveal (new fields, different splitting), so old and new parses can be told
 * apart.
 */
export const RESUME_PARSER_VERSION = 'tapcrm-resume/2.1.0';

const PREVIEW_CHARACTERS = 1000;
const SUMMARY_CHARACTERS = 600;

export interface ParseOptions {
  /** "Now", for "Present" in date ranges. */
  readonly asOf?: Date;
}

/** Font sizes and pages from the extraction, matched to the document's lines. */
function layoutHints(document: ResumeDocument, extraction: ResumeTextExtraction): (readonly [number | null, number | null])[] {
  const lines = extraction.lines ?? [];
  const aligned = lines.length === document.lines.length
    && lines.every((line, index) => line.text === document.lines[index]?.text);
  return document.lines.map((_, index) => (aligned ? [lines[index]!.size, lines[index]!.page] as const : [null, null] as const));
}

function summaryOf(document: ResumeDocument): string | null {
  const parts = document.lines
    .filter((line) => line.section === 'summary' && !line.heading)
    .map((line) => {
      const label = line.headingText ?? '';
      const text = label && line.text.startsWith(label) ? line.text.slice(label.length) : line.text;
      return text.replace(/^[\s:–-]+/, '').replace(/^[-*>]\s+/, '').trim();
    })
    .filter(Boolean);
  let text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (text.length > SUMMARY_CHARACTERS) text = `${text.slice(0, SUMMARY_CHARACTERS).replace(/\s+\S*$/, '')}…`;
  return text || null;
}

/** "Senior UI Designer" under the name; contact lines and places are skipped. */
function headlineAfter(document: ResumeDocument, nameIndex: number | null, name: string | null): string | null {
  if (nameIndex === null) return null;
  const nameKey = (name ?? '').toLowerCase();
  for (const line of document.lines.slice(nameIndex + 1, nameIndex + 4)) {
    if (line.heading) return null;
    const text = line.text;
    if (nameKey.includes(text.toLowerCase())) continue;
    if (/@|https?:|www\.|\d{5,}|linkedin|github/i.test(text)) continue;
    const pieces = text.split(/\t| \| | · | - (?=\p{Lu})/u).map((piece) => piece.trim()).filter((piece) => piece && !isPlace(piece));
    const candidate = pieces[0];
    if (!candidate || isBullet(candidate) || candidate.split(/\s+/).length > 8) return null;
    if (titleScore(candidate) < 2.5) return null;
    const letters = candidate.replace(/[^\p{L}]/gu, '');
    return letters === letters.toUpperCase()
      ? candidate.split(' ').map((word) => (word.length <= 3 ? word : word.charAt(0) + word.slice(1).toLowerCase())).join(' ')
      : candidate;
  }
  return null;
}

export function parseResumeExtraction(extraction: ResumeTextExtraction, options: ParseOptions = {}): ParsedResumeData {
  const asOf = options.asOf ?? new Date();
  const document = buildResumeDocument(extraction.text);
  const hints = layoutHints(document, extraction);
  const links = extraction.links ?? [];

  const contactLines: ContactLine[] = document.lines.map((line) => {
    const heading = line.headingText?.toLowerCase() ?? null;
    // A sidebar "Contact" block is as good as the top of the page.
    const section = line.section === 'other' && heading && /\b(?:contact|personal)\b/.test(heading) ? 'header' : line.section;
    return { text: line.text, index: line.index, section, heading };
  });
  const nameLines: NameLine[] = document.lines.map((line, index) => ({
    text: line.text,
    index: line.index,
    size: hints[index]?.[0] ?? null,
    page: hints[index]?.[1] ?? null,
    section: line.section,
    heading: line.heading,
  }));

  const firstEmails = findEmails(contactLines, links, []);
  const name = findName(nameLines, firstEmails.map((email) => email.value));
  const nameTokens = (name?.value ?? '').toLowerCase().split(/\s+/).map((token) => token.replace(/[^\p{L}]/gu, '')).filter(Boolean);
  const emails = findEmails(contactLines, links, nameTokens);
  const phones = findPhones(contactLines, links);
  const profileLinks = findLinks(contactLines, links);

  const ranges = findDateRanges(document, asOf);
  const experience = parseExperience(document, ranges, asOf);
  const education = parseEducation(document, asOf);
  const projects = parseProjects(document, ranges);
  const skills = extractSkills(document);
  const summary = summaryOf(document);
  const estimate = estimateExperience(document, asOf);
  const experienceYears = estimate.datedYears ?? estimate.statedYears ?? null;

  const email = emails[0];
  const phone = phones[0];
  // Text recognised from a scan can be misread anywhere, so nothing is certain.
  const sure = (confidence: ParsedFieldConfidence): ParsedFieldConfidence =>
    extraction.ocr && confidence === 'high' ? 'medium' : confidence;
  return {
    parserVersion: RESUME_PARSER_VERSION,
    name: name?.value ?? null,
    email: email?.value ?? null,
    phone: phone?.value ?? null,
    headline: headlineAfter(document, name?.lineIndex ?? null, name?.value ?? null),
    links: profileLinks,
    skills,
    ...(experience.length > 0 ? { experience } : {}),
    ...(education.length > 0 ? { education } : {}),
    ...(projects.length > 0 ? { projects } : {}),
    summary,
    experienceYears,
    confidence: {
      ...(name ? { name: sure(name.confidence) } : {}),
      ...(email ? { email: sure(email.confidence) } : {}),
      ...(phone ? { phone: sure(phone.confidence) } : {}),
    },
    ...(emails.length > 1 ? { otherEmails: emails.slice(1, 4).map((entry) => entry.value) } : {}),
    ...(phones.length > 1 ? { otherPhones: phones.slice(1, 4).map((entry) => entry.value) } : {}),
    ...(extraction.issues.length > 0 ? { warnings: [...extraction.issues] } : {}),
    ...(extraction.ocr ? { ocr: { pages: extraction.ocr.pages, confidence: extraction.ocr.confidence } } : {}),
    rawTextPreview: extraction.text.slice(0, PREVIEW_CHARACTERS),
  };
}
