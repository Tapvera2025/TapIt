import type { ParsedResumeEducation, ParsedResumeExperience, ParsedResumeProject } from '@tapcrm/contracts';
import type { DateRange, ResumeDocument, ResumeLine } from '../ats/text.js';
import {
  ACTION_VERBS,
  COMPANY_MARKERS,
  KNOWN_COMPANIES,
  PLACES,
  PRESENT_WORDS,
  REGION_CODES,
  ROLE_MODIFIERS,
  ROLE_NOUNS,
} from './lexicon.js';

/**
 * Work history, education and projects as structured entries.
 *
 * A job is anchored on its date range. The short "header" lines around the
 * anchor (title, company, location — in whatever order and split across one to
 * three lines) are cut at separators and each piece is classified by what it
 * reads like: a role ("Senior UI Designer"), an organisation ("HDFC Bank Ltd.",
 * "Razorpay") or a place ("Pune", "San Francisco, CA"). Bullets and sentences
 * are descriptions and end a header block.
 */

const MAX_ENTRIES = 15;

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s/]+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}&+#]+|[^\p{L}\p{N}&+#.]+$/gu, '').replace(/\.$/, ''))
    .filter(Boolean);
}

const BULLET = /^(?:[-*>»o]|\d{1,2}[.)])\s+/;

export function isBullet(text: string): boolean {
  return BULLET.test(text);
}

/** A description sentence rather than a header: long, verb-led, or a wrapped continuation. */
export function isProse(text: string): boolean {
  const count = words(text).length;
  if (count >= 12) return true;
  if (count >= 6 && /[.!]$/.test(text) && !/\b(?:ltd|inc|co|pvt|corp|jr|sr|llc|llp)\.$/i.test(text)) return true;
  if (/^\p{Ll}/u.test(text)) return true;
  const first = words(text)[0] ?? '';
  return ACTION_VERBS.has(first) && count >= 3;
}

export function isPlace(text: string): boolean {
  const parts = text.split(/,\s*/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => PLACES.has(part.toLowerCase())
    || (/^[A-Z]{2}$/.test(part) && REGION_CODES.has(part.toLowerCase())));
}

const LEGAL_SUFFIX = /(?:^|[\s,])(?:ltd|limited|pvt|private|inc|incorporated|llc|llp|plc|corp|corporation|co|company|gmbh|ag|pte|pty|bv|nv)\.?(?=$|[\s,)])/i;
const STRONG_ORG_WORDS = new Set([
  'bank', 'group', 'technologies', 'solutions', 'systems', 'labs', 'consulting', 'consultancy', 'consultants',
  'industries', 'enterprises', 'insurance', 'finance', 'finserv', 'motors', 'pharma', 'pharmaceuticals', 'hospital',
  'hospitals', 'university', 'college', 'institute', 'school', 'foundation', 'trust', 'hypermarket', 'supermarket',
  'infotech', 'infosystems', 'software', 'services', 'networks', 'capital', 'securities', 'ventures', 'studios',
  'holdings', 'international', 'corporation', 'airlines', 'airways', 'logistics', 'retail', 'foods', 'hotels',
]);

function knownCompany(text: string): number {
  const lower = text.toLowerCase().replace(/[.,]+$/, '').trim();
  if (KNOWN_COMPANIES.has(lower)) return 6;
  for (let cut = lower.lastIndexOf(' '); cut > 0; cut = lower.lastIndexOf(' ', cut - 1)) {
    if (KNOWN_COMPANIES.has(lower.slice(0, cut))) return 4;
  }
  return 0;
}

/** One to three capitalised words that read as neither an organisation nor a role. */
function isTownName(text: string): boolean {
  return /^\p{Lu}[\p{L}.'-]*(?:\s\p{Lu}[\p{L}.'-]*){0,2}$/u.test(text) && companyScore(text) <= 0 && titleScore(text) <= 0;
}

export function titleScore(text: string): number {
  const keys = words(text);
  if (keys.length === 0) return 0;
  let score = 0;
  const last = keys.at(-1)!;
  if (ROLE_NOUNS.has(last)) score += 4;
  else if (keys.some((key) => ROLE_NOUNS.has(key))) score += 2.5;
  score += Math.min(keys.filter((key) => ROLE_MODIFIERS.has(key)).length * 0.5, 1.5);
  if (keys.length > 8) score -= 2;
  if (LEGAL_SUFFIX.test(text)) score -= 3;
  return score;
}

export function companyScore(text: string): number {
  const keys = words(text);
  if (keys.length === 0) return 0;
  let score = knownCompany(text);
  if (LEGAL_SUFFIX.test(text)) score += 5;
  if (keys.some((key) => STRONG_ORG_WORDS.has(key))) score += 3;
  else if (keys.some((key) => COMPANY_MARKERS.has(key))) score += 1;
  if (text.includes('&') && keys.length <= 6) score += 1;
  if (ROLE_NOUNS.has(keys.at(-1)!)) score -= 4;
  return score;
}

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

interface Point {
  readonly year: number;
  readonly month: number | null;
}

function parsePoint(raw: string, asOfYear: number): Point | null {
  const text = raw.trim().toLowerCase().replace(/[.,']/g, ' ').replace(/\s+/g, ' ').trim();
  const named = /^([a-z]{3,9}) (\d{2}|\d{4})$/.exec(text);
  if (named?.[1] && named[2]) {
    const month = MONTHS[named[1].slice(0, named[1] === 'sept' ? 4 : 3)] ?? MONTHS[named[1].slice(0, 3)];
    let year = Number(named[2]);
    if (named[2].length === 2) year += year <= (asOfYear % 100) + 1 ? 2000 : 1900;
    return month ? { year, month } : null;
  }
  const numeric = /^(\d{1,2}) ?[/-] ?(\d{4})$/.exec(raw.trim());
  if (numeric?.[1] && numeric[2]) return { year: Number(numeric[2]), month: Number(numeric[1]) };
  const bare = /^(\d{4})$/.exec(text);
  if (bare?.[1]) return { year: Number(bare[1]), month: null };
  return null;
}

function formatPoint(point: Point): string {
  return point.month ? `${point.year}-${String(point.month).padStart(2, '0')}` : String(point.year);
}

export interface RangeParts {
  readonly start?: string;
  readonly end?: string;
  readonly current: boolean;
  readonly endYear: number | null;
}

export function rangeParts(text: string, asOf: Date): RangeParts {
  const asOfYear = asOf.getUTCFullYear();
  const since = /^since\s+(.+)$/i.exec(text.trim());
  const pieces = since ? [since[1] ?? '', 'present'] : (/^(.*?)\s*(?:-|to|till|until|~|→|>)\s*(.*)$/i.exec(text.trim())?.slice(1) ?? []);
  const start = pieces[0] ? parsePoint(pieces[0], asOfYear) : null;
  const endText = (pieces[1] ?? '').trim().toLowerCase();
  const current = PRESENT_WORDS.has(endText.replace(/\s+/g, ' '));
  const end = current ? null : parsePoint(pieces[1] ?? '', asOfYear);
  return {
    ...(start ? { start: formatPoint(start) } : {}),
    ...(end ? { end: formatPoint(end) } : {}),
    current,
    endYear: end?.year ?? (current ? asOfYear : null),
  };
}

function displayRange(text: string): string {
  return text.replace(/\s*(?:-|–|—|~|→)\s*/g, ' - ').replace(/\s+/g, ' ').trim();
}

/** "(3 years 7 months)" after a LinkedIn date range. */
const DURATION_NOTE = /\(\s*(?:\d+\s*(?:years?|yrs?)\s*)?(?:\d+\s*(?:months?|mos?))?\s*\)/gi;

/* ------------------------------------------------------------------ *
 * Experience
 * ------------------------------------------------------------------ */

type LineKind = 'anchor' | 'header' | 'bullet' | 'prose';

interface SectionLine {
  readonly line: ResumeLine;
  readonly kind: LineKind;
  readonly range: DateRange | null;
}

/** Pieces of a header line: split at tabs, pipes, dashes and " at ". */
function headerPieces(text: string): string[] {
  return text
    .split(/\t|\s*\|\s*|\s+[•·]\s+| - | — | @ |\s+at\s+(?=\p{Lu})/u)
    .map((piece) => piece.replace(/^[\s,;:-]+|[\s,;:(-]+$/g, '').replace(/\(\s*\)/g, '').trim())
    .filter((piece) => piece.length > 0 && !PRESENT_WORDS.has(piece.toLowerCase()));
}

interface Piece {
  readonly text: string;
  /** For a "Title, Company" piece kept whole: where it could be split. */
  readonly commaParts: readonly string[];
}

function classifyEntry(lines: readonly string[]): { title?: string; company?: string; location?: string } {
  const pieces: Piece[] = [];
  const locations: string[] = [];

  for (const line of lines) {
    for (const raw of headerPieces(line)) {
      if (isPlace(raw)) {
        locations.push(raw);
        continue;
      }
      // "Fractal Analytics (Mumbai)": a bracketed place.
      const bracketed = /^(.*\S)\s*\(([^()]+)\)$/.exec(raw);
      const text = bracketed?.[1] && bracketed[2] && isPlace(bracketed[2]) ? bracketed[1] : raw;
      if (text !== raw && bracketed?.[2]) locations.push(bracketed[2]);
      const parts = text.split(/,\s*/).map((part) => part.trim()).filter(Boolean);
      // Trailing places: "Tata Motors, Pune" → company + location.
      while (parts.length > 1 && isPlace(parts.at(-1)!)) locations.unshift(parts.pop()!);
      while (parts.length > 2 && isPlace(parts.slice(-2).join(', '))) locations.unshift(parts.splice(-2).join(', '));
      // "McLean, VA": a town before a state code is a place even if the town is not in our list.
      if (locations[0] && /^[A-Z]{2}$/.test(locations[0]) && parts.length >= 1 && isTownName(parts.at(-1)!)) {
        locations[0] = `${parts.pop()!}, ${locations[0]}`;
      }
      if (parts.length === 0) continue;
      if (parts.length >= 2) {
        const companyAt = parts.findIndex((part, index) => index > 0 && companyScore(part) >= 3 && titleScore(part) < 2);
        if (companyAt > 0 && titleScore(parts.slice(0, companyAt).join(', ')) > 0) {
          pieces.push({ text: parts.slice(0, companyAt).join(', '), commaParts: [] });
          pieces.push({ text: parts.slice(companyAt).join(', '), commaParts: [] });
          continue;
        }
        const titleAt = parts.findIndex((part, index) => index > 0 && titleScore(part) >= 2.5);
        if (titleAt > 0 && companyScore(parts.slice(0, titleAt).join(', ')) >= 3) {
          pieces.push({ text: parts.slice(0, titleAt).join(', '), commaParts: [] });
          pieces.push({ text: parts.slice(titleAt).join(', '), commaParts: [] });
          continue;
        }
      }
      pieces.push({ text: parts.join(', '), commaParts: parts });
    }
  }

  // "Manager - Sales", "Assistant Manager - Finance": a piece of bare role
  // qualifiers belongs to the title before it, unless it names a real company.
  for (let index = pieces.length - 1; index > 0; index -= 1) {
    const text = pieces[index]!.text;
    const keys = words(text);
    const qualifier = keys.length > 0 && keys.length <= 3 && keys.every((key) => ROLE_MODIFIERS.has(key))
      && knownCompany(text) === 0 && !LEGAL_SUFFIX.test(text);
    if (qualifier && titleScore(pieces[index - 1]!.text) >= 2.5) {
      pieces[index - 1] = { text: `${pieces[index - 1]!.text} - ${pieces[index]!.text}`, commaParts: [] };
      pieces.splice(index, 1);
    }
  }

  let title: Piece | undefined;
  let company: Piece | undefined;
  const byTitle = [...pieces].sort((a, b) => titleScore(b.text) - titleScore(a.text));
  if (byTitle[0] && titleScore(byTitle[0].text) > 0) title = byTitle[0];
  const rest = pieces.filter((piece) => piece !== title);
  const byCompany = [...rest].sort((a, b) => companyScore(b.text) - companyScore(a.text));
  if (byCompany[0] && companyScore(byCompany[0].text) > 0) company = byCompany[0];
  company ??= rest.find((piece) => titleScore(piece.text) < 2.5);

  let titleText = title?.text;
  let companyText = company?.text;
  // "Caritas Hospital, Kottayam": a short trailing part with no organisation or
  // role words is the town, even when the town is not in our list.
  if (company && company.commaParts.length >= 2 && isTownName(company.commaParts.at(-1)!)) {
    locations.push(company.commaParts.at(-1)!);
    companyText = company.commaParts.slice(0, -1).join(', ');
  }
  // "Software Engineer, Brightlabs" with no other company: the last part is the company.
  if (!companyText && title && title.commaParts.length >= 2) {
    const last = title.commaParts.at(-1)!;
    if (titleScore(last) < 1) {
      companyText = last;
      titleText = title.commaParts.slice(0, -1).join(', ');
    }
  }
  if (!titleText) titleText = rest.find((piece) => piece !== company)?.text;

  return {
    ...(titleText ? { title: titleText } : {}),
    ...(companyText ? { company: companyText } : {}),
    ...(locations.length > 0 ? { location: locations.join(', ') } : {}),
  };
}

/** Column titles of a table ("School · Designation · Period"), not an entry. */
const TABLE_HEADER_WORDS = new Set([
  'school', 'college', 'designation', 'position', 'role', 'title', 'period', 'duration', 'from', 'to', 'year', 'years',
  'organisation', 'organization', 'company', 'employer', 'institute', 'institution', 'university', 'board', 'qualification',
  'degree', 'course', 'specialisation', 'specialization', 'percentage', 'marks', 'grade', 'cgpa', 'score', 'result',
  'location', 'place', 'name', 'of', 'the', 's.no', 'sr.no', 'sl.no', 'no', 'sr', 'sl', 'passing', 'class', 'division',
  'stream', 'subject', 'subjects', 'date', 'dates', 'responsibilities', 'details', 'project', 'client', 'team', 'size',
]);

function isTableHeader(text: string): boolean {
  const cells = text.split('\t').map((cell) => cell.trim()).filter(Boolean);
  return cells.length >= 2 && !/\d{2}/.test(text)
    && cells.every((cell) => words(cell).length > 0 && words(cell).every((word) => TABLE_HEADER_WORDS.has(word)));
}

function withoutRange(text: string, range: DateRange | null): string {
  let value = (range ? text.replace(range.text, ' ') : text).replace(BULLET, '');
  value = value.replace(DURATION_NOTE, ' ').replace(/\(\s*\)|\[\s*\]/g, ' ');
  return value.replace(/[ ]{2,}/g, ' ').replace(/\s*\t\s*/g, '\t').replace(/^[\s|,;:-]+|[\s|,;:(-]+$/g, '').trim();
}

function sectionLines(document: ResumeDocument, ranges: readonly DateRange[], section: string): SectionLine[] {
  const rangeByLine = new Map<number, DateRange>();
  for (const range of ranges) if (!rangeByLine.has(range.line.index)) rangeByLine.set(range.line.index, range);
  return document.lines
    .filter((line) => line.section === section && !line.heading)
    .filter((line) => !isTableHeader(line.text))
    .map((line) => {
      const range = rangeByLine.get(line.index) ?? null;
      let kind: LineKind;
      // "1. Front Office Associate, Taj Hotels (2019 - 2021)": a numbered or
      // bulleted job line is still a job header when it is short and dated.
      if (range && (!isBullet(line.text) || !isProse(withoutRange(line.text, range)))) kind = 'anchor';
      else if (isBullet(line.text)) kind = 'bullet';
      else kind = isProse(line.text) ? 'prose' : 'header';
      return { line, kind, range };
    });
}

/** Consecutive header and anchor lines, split wherever a bullet, a sentence or a gap in the section intervenes. */
function headerBlocks(lines: readonly SectionLine[]): SectionLine[][] {
  const blocks: SectionLine[][] = [];
  let current: SectionLine[] = [];
  let previousIndex = -2;
  for (const entry of lines) {
    const contiguous = entry.line.index === previousIndex + 1;
    if (entry.kind === 'bullet' || entry.kind === 'prose' || !contiguous) {
      if (current.length > 0) blocks.push(current);
      current = [];
    }
    if (entry.kind === 'anchor' || entry.kind === 'header') current.push(entry);
    previousIndex = entry.line.index;
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

/** Whether a dated line names both the role and the employer on its own. */
function isCompleteAnchor(entry: SectionLine): boolean {
  const roles = classifyEntry([withoutRange(entry.line.text, entry.range)]);
  return Boolean(roles.title && roles.company);
}

/**
 * Splits a block holding several dated jobs into one group of lines per job.
 * A header line between two dated lines joins the job that still lacks a title
 * or employer; when both or neither do, the block's own layout decides —
 * extra lines sit above their dates (LinkedIn, most templates) unless the
 * block starts with a dated line.
 */
function groupsOf(block: readonly SectionLine[]): SectionLine[][] {
  const anchors = block.map((entry, index) => (entry.kind === 'anchor' ? index : -1)).filter((index) => index >= 0);
  if (anchors.length <= 1) return [block.slice(Math.max(0, (anchors[0] ?? 0) - 2), (anchors[0] ?? 0) + 3)];
  const above = block[0]?.kind !== 'anchor';
  const complete = anchors.map((index) => isCompleteAnchor(block[index]!));
  const groups: SectionLine[][] = anchors.map((index) => [block[index]!]);
  for (let index = 0; index < block.length; index += 1) {
    if (block[index]!.kind === 'anchor') continue;
    const previous = anchors.filter((anchor) => anchor < index).length - 1;
    let owner: number;
    if (previous < 0) owner = 0;
    else if (previous === anchors.length - 1) owner = previous;
    else if (index === anchors[previous]! + 1 && isPlace(block[index]!.line.text)) owner = previous;
    else if (complete[previous] !== complete[previous + 1]) owner = complete[previous] ? previous + 1 : previous;
    else owner = above ? previous + 1 : previous;
    groups[owner]!.push(block[index]!);
  }
  return groups.map((group) => group.sort((a, b) => a.line.index - b.line.index));
}

export function parseExperience(document: ResumeDocument, ranges: readonly DateRange[], asOf: Date): ParsedResumeExperience[] {
  const lines = sectionLines(document, ranges, 'experience');
  if (lines.length === 0) return [];
  const blocks = headerBlocks(lines);
  const dated = lines.some((entry) => entry.kind === 'anchor');
  const entries: ParsedResumeExperience[] = [];

  for (const block of blocks) {
    if (dated && !block.some((entry) => entry.kind === 'anchor')) continue;
    if (!dated && block.length > 3) continue;
    for (const group of groupsOf(block)) {
      const anchor = group.find((entry) => entry.kind === 'anchor');
      const texts = group.map((entry) => withoutRange(entry.line.text, entry.range)).filter(Boolean);
      const roles = classifyEntry(texts);
      if (!roles.title && !roles.company) continue;
      const parts = anchor?.range ? rangeParts(anchor.range.text, asOf) : null;
      entries.push({
        ...roles,
        ...(anchor?.range ? { duration: displayRange(anchor.range.text) } : {}),
        ...(parts?.start ? { startDate: parts.start } : {}),
        ...(parts?.end ? { endDate: parts.end } : {}),
        ...(parts?.current ? { current: true } : {}),
      });
      if (entries.length >= MAX_ENTRIES) return entries;
    }
  }
  return entries;
}

/* ------------------------------------------------------------------ *
 * Education
 * ------------------------------------------------------------------ */

interface DegreePattern {
  readonly label: string;
  readonly pattern: RegExp;
}

const OF_IN = "(?:'?s)?\\s+(?:of|in)\\s+";
const degree = (label: string, source: string, flags = 'i'): DegreePattern => ({ label, pattern: new RegExp(source, flags) });

/** Most specific first: "PGDM" before "Diploma", "B.Ed" before "B.E.", "HSC" before "SSC". */
export const DEGREES: readonly DegreePattern[] = [
  degree('PGDM', `\\b(?:pgdm|pgdbm|pgpm|post\\s*-?\\s*graduate\\s+diploma\\s+in\\s+(?:business\\s+)?management)\\b`),
  degree('PG Diploma', `\\b(?:pg\\s*diploma|p\\.g\\.\\s*diploma|post\\s*-?\\s*graduate\\s+diploma|pgd)\\b`),
  degree('Ph.D.', `\\b(?:ph\\.?\\s?d\\.?|doctorate|doctor\\s+of\\s+philosophy)(?![a-z])`),
  degree('M.Phil', `\\bm\\.?\\s?phil\\b`),
  degree('MBA', `\\b(?:m\\.?b\\.?a\\.?|executive\\s+mba|master${OF_IN}business\\s+administration)(?![a-z])`),
  degree('MCA', `\\b(?:m\\.?c\\.?a\\.?|master${OF_IN}computer\\s+applications?)(?![a-z])`),
  degree('M.Tech', `\\b(?:m\\.?\\s?tech|master${OF_IN}technology)\\b`),
  degree('M.E.', `\\b(?:M\\.\\s?E\\.?(?![A-Za-z])|ME(?=\\s+(?:in\\s+)?[A-Z(]))`, ''),
  degree('M.E.', `\\bmaster${OF_IN}engineering\\b`),
  degree('M.Sc', `\\b(?:m\\.?\\s?sc\\.?|master${OF_IN}science)(?![a-z])`),
  degree('M.S.', `\\b(?:M\\.S\\.?(?![A-Za-z])|MS(?=\\s+(?:in\\s+)?[A-Z(]))`, ''),
  degree('M.Com', `\\b(?:m\\.?\\s?com|master${OF_IN}commerce)\\b`),
  degree('M.A.', `\\b(?:M\\.A\\.?(?![A-Za-z])|MA(?=\\s+(?:in\\s+)?[A-Z(]))`, ''),
  degree('M.A.', `\\bmaster${OF_IN}arts\\b`),
  degree('M.Des', `\\b(?:m\\.?\\s?des|master${OF_IN}design)\\b`),
  degree('M.Arch', `\\b(?:m\\.?\\s?arch|master${OF_IN}architecture)\\b`),
  degree('M.Pharm', `\\b(?:m\\.?\\s?pharm(?:a)?|master${OF_IN}pharmacy)\\b`),
  degree('M.Ed', `\\b(?:M\\.\\s?Ed\\.?|MEd|master${OF_IN}education)\\b`),
  degree('LL.M', `\\b(?:ll\\.?\\s?m|master\\s+of\\s+laws)\\b`),
  degree('LL.B', `\\b(?:(?:b\\.?a\\.?|b\\.?b\\.?a\\.?)\\s*[,-]?\\s*ll\\.?\\s?b|ll\\.?\\s?b|bachelor\\s+of\\s+laws?)\\b`),
  degree('MBBS', `\\bmbbs\\b`),
  degree('BDS', `\\bBDS\\b`, ''),
  degree('B.Tech', `\\b(?:b\\.?\\s?tech|bachelor${OF_IN}technology)\\b`),
  degree('B.Ed', `\\b(?:B\\.\\s?Ed\\.?|BEd|bachelor${OF_IN}education)\\b`),
  degree('B.E.', `\\b(?:B\\.\\s?E\\.?(?![A-Za-z])|BE(?=\\s+(?:in\\s+)?[A-Z(]))`, ''),
  degree('B.E.', `\\bbachelor${OF_IN}engineering\\b`),
  degree('BCA', `\\b(?:b\\.?\\s?c\\.?\\s?a\\.?|bachelor${OF_IN}computer\\s+applications?)(?![a-z])`),
  degree('BBA', `\\b(?:b\\.?\\s?b\\.?\\s?a\\.?|bachelor${OF_IN}business\\s+administration)(?![a-z])`),
  degree('BBM', `\\b(?:bbm|bachelor${OF_IN}business\\s+management)\\b`),
  degree('BMS', `\\b(?:BMS|bachelor${OF_IN}management\\s+studies)\\b`),
  degree('B.Com', `\\b(?:b\\.?\\s?com|bachelor${OF_IN}commerce)\\b`),
  degree('B.Sc', `\\b(?:b\\.?\\s?sc\\.?|bachelor${OF_IN}science)(?![a-z])`),
  degree('B.S.', `\\b(?:B\\.S\\.?(?![A-Za-z])|BS(?=\\s+(?:in\\s+)?[A-Z(]))`, ''),
  degree('B.A.', `\\b(?:B\\.A\\.?(?![A-Za-z])|BA(?=\\s+(?:in\\s+)?[A-Z(]))`, ''),
  degree('B.A.', `\\bbachelor${OF_IN}arts\\b`),
  degree('B.Des', `\\b(?:b\\.?\\s?des|bachelor${OF_IN}design)\\b`),
  degree('B.Arch', `\\b(?:b\\.?\\s?arch|bachelor${OF_IN}architecture)\\b`),
  degree('B.Pharm', `\\b(?:b\\.?\\s?pharm(?:a)?|bachelor${OF_IN}pharmacy)\\b`),
  degree('CA', `\\b(?:chartered\\s+accountan(?:t|cy)|ca\\s+(?:final|inter(?:mediate)?|foundation))\\b`),
  degree('Diploma', `\\b(?:diploma|polytechnic)\\b`),
  degree('ITI', `\\bITI\\b`, ''),
  degree('HSC', `\\b(?:hsc|h\\.s\\.c\\.?|12th|xii(?:th)?|class\\s*(?:12|xii)|higher\\s+secondary|senior\\s+secondary|intermediate|puc|pre-?university|10\\s*\\+\\s*2|isc)\\b`),
  degree('SSC', `\\b(?:ssc|s\\.s\\.c\\.?|10th|class\\s*(?:10|x)\\b|matriculation|matric|secondary\\s+school(?:\\s+certificate)?|sslc|icse|high\\s+school)\\b`),
];

const INSTITUTION = /\b(?:universit(?:y|ies)|college|institute|institution|school|academy|iit|iim|nit|iiit|bits|vidyalaya|vidyapeeth|vidyapith|mahavidyalaya|polytechnic|campus|faculty|hss|h\.s\.s|convent)\b|^st\.?\s+\p{Lu}/iu;
const ACRONYM_INSTITUTION = /^(?:[A-Z]{3,6})(?:\s+[A-Z][a-z]+){0,2}$/;
/** Certificates and courses are not where a degree was earned. */
const CERTIFICATE = /\b(?:certificate|certification|certified|course|training|nebosh|iosh)\b/i;
/** Short forms that are fields of study, not institutions: "B.Tech (ECE)". */
const FIELD_ACRONYMS = new Set(['cse', 'ece', 'eee', 'ee', 'cs', 'it', 'me', 'ce', 'entc', 'ict', 'eie', 'ai', 'ml', 'ds', 'hr', 'pcm', 'pcb', 'pcmb', 'mech']);
/** Streams a school-leaving certificate can name. */
const SCHOOL_STREAMS = /^(?:science|commerce|arts|humanities|pcm|pcb|pcmb|maths?|mathematics|biology|computer science|vocational)$/i;
const GRADE_WORD = /\b(?:c?gpa|cpi|sgpa|percentage|score|marks|grade)\b/i;

/**
 * Degrees named on a line, leftmost first. A second degree counts only when it
 * is joined to the first ("B.Tech + M.Tech"), so "HSC, Don Bosco Matriculation
 * School" is one HSC, not an HSC and an SSC.
 */
function findDegrees(text: string): { label: string; start: number; end: number }[] {
  const found: { label: string; start: number; end: number }[] = [];
  for (const { label, pattern } of DEGREES) {
    const match = pattern.exec(text);
    if (!match) continue;
    const start = match.index;
    const end = start + match[0].length;
    if (found.some((other) => other.label === label || (start < other.end && end > other.start))) continue;
    found.push({ label, start, end });
  }
  found.sort((a, b) => a.start - b.start);
  const [first, second] = found;
  if (!first) return [];
  if (second && /^\s*(?:\+|&|and|\/|,)\s*$/i.test(text.slice(first.end, second.start))) return [first, second];
  return [first];
}

function isDegreeText(text: string): boolean {
  return findDegrees(text).length > 0;
}

/** The field of study right after the degree: "in Computer Science", "(Marketing)". */
function fieldAfter(text: string): { field?: string; consumed: number } {
  const pieces = text.split(/([,|;\t·()]| - )/);
  let consumed = 0;
  for (const piece of pieces) {
    const length = piece.length;
    const value = piece.trim().replace(/^(?:in|of|with)\s+/i, '').replace(/\s+(?:from|at)$/i, '').trim();
    consumed += length;
    if (!value || /^[,|;\t·()-]+$/.test(value)) continue;
    if (/\d/.test(value) || INSTITUTION.test(value) || isPlace(value) || GRADE_WORD.test(value) || isDegreeText(value)) {
      if (/\d/.test(value) || INSTITUTION.test(value) || GRADE_WORD.test(value)) break;
      continue;
    }
    if (ACRONYM_INSTITUTION.test(value) && /\s/.test(value)) break;
    const count = value.split(/\s+/).length;
    if (count > 7 || !/^[\p{Lu}&]/u.test(value)) break;
    return { field: value, consumed };
  }
  return { consumed: 0 };
}

function institutionIn(text: string): string | undefined {
  const pieces = text.split(/\t|\s*\|\s*| - | — |;/).map((piece) => piece.trim()).filter(Boolean);
  const clean = (piece: string) => piece
    .replace(/\(?\b(?:19|20)\d{2}\b.*$/, '')
    .replace(/\b(?:c?gpa|cpi|percentage)\b.*$/i, '')
    .replace(/^[\s,:;)\]-]+|[\s,:;([-]+$/g, '')
    .trim();
  const named = pieces.find((piece) => INSTITUTION.test(piece) && !CERTIFICATE.test(piece));
  if (named) return clean(named) || undefined;
  const acronym = pieces.map(clean).find((piece) => ACRONYM_INSTITUTION.test(piece) && !GRADE_WORD.test(piece)
    && !isDegreeText(piece) && !CERTIFICATE.test(piece) && !FIELD_ACRONYMS.has(piece.toLowerCase()));
  return acronym || undefined;
}

const GRADE_PATTERNS: readonly RegExp[] = [
  /\b(?:c?gpa|cpi|sgpa)\s*[:-]?\s*\d{1,2}(?:\.\d{1,2})?(?:\s*\/\s*\d{1,2}(?:\.\d{1,2})?)?/i,
  /\b\d{1,2}(?:\.\d{1,2})?\s*(?:c?gpa|cpi)\b/i,
  /\b\d{1,2}(?:\.\d{1,2})?\s*\/\s*(?:10|4)(?:\.0)?\b/,
  /\b\d{2}(?:\.\d{1,2})?\s*%/,
  /\b(?:first\s+class(?:\s+with\s+distinction)?|distinction|second\s+class|pass\s+class)\b/i,
];

function gradeIn(text: string): string | undefined {
  for (const pattern of GRADE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[0].replace(/\s*:\s*/, ' ').replace(/\s+/g, ' ').trim();
  }
  return undefined;
}

const DATE_PART = String.raw`(?:(?:[a-z]{3,9}\.?,?|\d{1,2}[/.-])\s*)?(?:19|20)\d{2}`;
/** A line that is only a date or a date range: "Jul 2010 - Apr 2013", "(2016-2020)", "2019 - Present". */
const DATE_LINE = new RegExp(
  String.raw`^\(?${DATE_PART}(?:\s*(?:-|to|till|until)\s*(?:${DATE_PART}|present|current|now|date|ongoing))?\)?$`,
  'i',
);

function yearIn(text: string, asOf: Date): string | undefined {
  const asOfYear = asOf.getUTCFullYear();
  const years = [...text.matchAll(/\b(19[6-9]\d|20\d{2})\b/g)].map((match) => Number(match[1])).filter((year) => year <= asOfYear + 6);
  if (years.length === 0) return undefined;
  const year = Math.max(...years);
  const expected = year > asOfYear || /\b(?:expected|pursuing|ongoing|present|current|till date)\b/i.test(text);
  return expected ? `${year} (expected)` : String(year);
}

export function parseEducation(document: ResumeDocument, asOf: Date): ParsedResumeEducation[] {
  const hasSection = document.sections.has('education');
  const lines = document.lines.filter((line) => !line.heading && (hasSection ? line.section === 'education' : true));
  const degreeAt = new Map<number, { label: string; start: number; end: number }[]>();
  for (const line of lines) {
    const found = findDegrees(line.text);
    // Without an education section, only lines that read like education count.
    if (found.length > 0 && (hasSection || INSTITUTION.test(line.text) || /\b(?:19|20)\d{2}\b/.test(line.text))) {
      degreeAt.set(line.index, found);
    }
  }
  const institutionLines = new Set(lines
    .filter((line) => !degreeAt.has(line.index) && institutionIn(line.text) && !isBullet(line.text) && !CERTIFICATE.test(line.text))
    .map((line) => line.index));

  const below = [...degreeAt.keys()].filter((index) => institutionLines.has(index + 1)).length;
  const aboveCount = [...degreeAt.keys()].filter((index) => institutionLines.has(index - 1)).length;
  const preferBelow = below > aboveCount;
  const claimed = new Set<number>();
  const byIndex = new Map(lines.map((line) => [line.index, line]));
  const entries: ParsedResumeEducation[] = [];

  /** "Jul 2010 - Apr 2013" on a line of its own below the degree (or below its college). */
  const yearBelow = (index: number): string | undefined => {
    for (let offset = 1; offset <= 3; offset += 1) {
      const below = byIndex.get(index + offset);
      if (!below || degreeAt.has(below.index)) return undefined;
      if (DATE_LINE.test(below.text.trim())) return yearIn(below.text, asOf);
      if (!institutionLines.has(below.index)) return undefined;
    }
    return undefined;
  };

  for (const [index, degrees] of degreeAt) {
    const line = byIndex.get(index)!;
    for (const found of degrees) {
      const after = line.text.slice(found.end);
      const parsedField = fieldAfter(after);
      let field = parsedField.field;
      const rest = line.text.slice(0, found.start) + ' ' + after.slice(field ? parsedField.consumed : 0);
      let institution = institutionIn(rest);
      // "B.Tech, DTU" and "12th - CBSE": what follows is a college or board, not a field of study.
      const schoolLevel = found.label === 'HSC' || found.label === 'SSC';
      if (field && ((/^[A-Z]{3,}$/.test(field) && !FIELD_ACRONYMS.has(field.toLowerCase()))
          || (schoolLevel && !SCHOOL_STREAMS.test(field)) || INSTITUTION.test(field))) {
        institution ??= field;
        field = undefined;
      }
      let support = '';
      if (!institution) {
        const order = preferBelow ? [index + 1, index - 1] : [index - 1, index + 1];
        const neighbour = order.find((candidate) => institutionLines.has(candidate) && !claimed.has(candidate));
        if (neighbour !== undefined) {
          claimed.add(neighbour);
          support = byIndex.get(neighbour)?.text ?? '';
          institution = institutionIn(support);
        }
      }
      const year = yearIn(line.text, asOf) ?? yearIn(support, asOf) ?? yearBelow(index);
      const grade = gradeIn(line.text) ?? gradeIn(support);
      entries.push({
        degree: found.label,
        ...(field ? { field } : {}),
        ...(institution ? { institution } : {}),
        ...(year ? { year } : {}),
        ...(grade ? { grade } : {}),
      });
      if (entries.length >= MAX_ENTRIES) return entries;
    }
  }
  return entries;
}

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */

export function parseProjects(document: ResumeDocument, ranges: readonly DateRange[]): ParsedResumeProject[] {
  const lines = sectionLines(document, ranges, 'projects');
  const projects: { title: string; description: string[] }[] = [];
  for (const entry of lines) {
    if (entry.kind === 'header' || entry.kind === 'anchor') {
      const title = withoutRange(entry.line.text, entry.range).split(/\t|\s+\|\s+| - /)[0]?.trim();
      if (title && title.length <= 120) projects.push({ title, description: [] });
    } else {
      const current = projects.at(-1);
      if (current && current.description.length < 3) current.description.push(entry.line.text.replace(BULLET, '').trim());
    }
    if (projects.length > 8) break;
  }
  return projects.slice(0, 8).map((project) => {
    const description = project.description.join(' ').slice(0, 300).trim();
    return { title: project.title, ...(description ? { description } : {}) };
  });
}
