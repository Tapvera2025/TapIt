/**
 * Resume structure for screening: lines tagged with the section they sit in,
 * term matching with symbol-aware word boundaries, evidence snippets, and
 * employment-date arithmetic.
 */

export type SectionKind =
  | 'header' | 'summary' | 'experience' | 'education' | 'skills'
  | 'projects' | 'certifications' | 'other';

export interface ResumeLine {
  readonly index: number;
  readonly text: string;
  readonly lower: string;
  readonly section: SectionKind;
  /** True for the heading line itself ("WORK EXPERIENCE"). */
  readonly heading: boolean;
  /** Text of the heading this line sits under, if any. */
  readonly headingText: string | null;
}

export interface ResumeDocument {
  readonly lines: readonly ResumeLine[];
  readonly sections: ReadonlySet<SectionKind>;
  readonly characters: number;
  readonly words: number;
}

const HEADINGS: Readonly<Record<string, SectionKind>> = {};
function headings(kind: SectionKind, phrases: readonly string[]): void {
  for (const phrase of phrases) (HEADINGS as Record<string, SectionKind>)[phrase] = kind;
}
headings('experience', [
  'experience', 'experiences', 'work experience', 'professional experience', 'employment history', 'work history',
  'career history', 'employment', 'employment details', 'professional background', 'relevant experience',
  'internship', 'internships', 'internship experience', 'industrial experience', 'industry experience',
  'work experience and internships', 'experience and internships', 'professional history', 'organizational experience',
  'job history', 'working experience', 'experience details', 'work profile', 'professional experiences',
]);
headings('education', [
  'education', 'educational qualification', 'educational qualifications', 'academic qualification',
  'academic qualifications', 'academics', 'academic background', 'education and qualifications',
  'qualifications', 'qualification', 'academic details', 'scholastic record', 'educational background',
  'education details', 'academic profile', 'academic credentials', 'education and training',
]);
headings('skills', [
  'skills', 'technical skills', 'key skills', 'core skills', 'core competencies', 'competencies', 'skill set',
  'skillset', 'skills and tools', 'tools and technologies', 'technologies', 'technical expertise',
  'areas of expertise', 'it skills', 'software skills', 'professional skills', 'soft skills', 'tech stack',
  'expertise', 'technical proficiency', 'skills and abilities', 'key competencies', 'computer skills',
  'technical summary', 'skills summary', 'tools', 'languages and tools', 'skill highlights', 'top skills',
]);
headings('projects', [
  'projects', 'academic projects', 'personal projects', 'key projects', 'major projects', 'project details',
  'project work', 'selected projects', 'side projects', 'capstone project', 'final year project', 'projects undertaken',
]);
headings('certifications', [
  'certifications', 'certification', 'certificates', 'licenses and certifications', 'licences and certifications',
  'courses', 'trainings', 'training', 'training and certifications', 'certifications and trainings',
  'courses and certifications', 'online courses', 'professional certifications', 'certifications and courses',
]);
headings('summary', [
  'summary', 'professional summary', 'profile', 'profile summary', 'career objective', 'objective', 'about me',
  'career summary', 'executive summary', 'professional profile', 'about', 'personal profile', 'overview',
]);
headings('other', [
  'achievements', 'awards', 'awards and achievements', 'achievements and awards', 'honors', 'honours',
  'publications', 'languages', 'languages known', 'interests', 'hobbies', 'hobbies and interests',
  'personal details', 'personal information', 'personal profile details', 'declaration', 'references',
  'volunteer', 'volunteering', 'volunteer experience', 'extracurricular activities', 'extra curricular activities',
  'extra-curricular activities', 'positions of responsibility', 'strengths', 'additional information',
  'contact', 'contact details', 'contact information', 'activities', 'leadership', 'co-curricular activities',
]);

const KEYWORD_SECTIONS: readonly (readonly [RegExp, SectionKind])[] = [
  [/\b(experience|employment|internships?)\b/, 'experience'],
  [/\b(education|academic|qualifications?)\b/, 'education'],
  [/\b(skills?|competenc|technolog|proficienc|expertise)/, 'skills'],
  [/\bprojects?\b/, 'projects'],
  [/\b(certific|courses|trainings?)\b/, 'certifications'],
  [/\b(summary|objective|profile)\b/, 'summary'],
  [/\b(achievements?|awards?|hobbies|interests|languages|personal|declaration|references|activities)\b/, 'other'],
];

/** The last word of a heading that names its section. */
const SECTION_NOUNS: Readonly<Record<string, SectionKind>> = {
  experience: 'experience', experiences: 'experience', employment: 'experience', internships: 'experience',
  internship: 'experience', education: 'education', qualifications: 'education', qualification: 'education',
  skills: 'skills', competencies: 'skills', expertise: 'skills', projects: 'projects', certifications: 'certifications',
  certificates: 'certifications', summary: 'summary', objective: 'summary', profile: 'summary', achievements: 'other',
  awards: 'other', publications: 'other', interests: 'other', hobbies: 'other', references: 'other', details: 'other',
};

function headingKey(value: string): string {
  return value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The section named by a well-known heading phrase ("Employment History",
 * "SKILLS:"), without the keyword guesses `classifyHeading` makes — so a job
 * title in capitals ("PROJECT MANAGER") is not mistaken for a heading.
 */
export function knownHeading(value: string): SectionKind | null {
  const trimmed = value.replace(/[:\-–|]+\s*$/, '').trim();
  if (trimmed.length < 3 || trimmed.length > 48) return null;
  return HEADINGS[headingKey(trimmed)] ?? null;
}

/** Classifies a whole line as a section heading, or returns null. */
export function classifyHeading(line: string): SectionKind | null {
  const trimmed = line.replace(/[:\-\u2013|]+\s*$/, '').trim();
  if (trimmed.length < 3 || trimmed.length > 48) return null;
  const key = headingKey(trimmed);
  if (!key) return null;
  const known = HEADINGS[key];
  if (known) return known;

  const words = key.split(' ').length;
  const shouty = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
  if (words <= 4 && (shouty || line.trim().endsWith(':'))) {
    for (const [pattern, kind] of KEYWORD_SECTIONS) if (pattern.test(key)) return kind;
  }
  // "Teaching Experience", "Clinical Experience": a short title-case line that
  // ends in a section word is a heading even when it is not in capitals.
  const titleCase = trimmed.split(/\s+/).every((word) => /^[A-Z&]/.test(word) || /^(?:and|of|in|&)$/.test(word));
  const head = SECTION_NOUNS[key.split(' ').at(-1) ?? ''];
  if (words <= 3 && titleCase && !/\d/.test(trimmed) && head) return head;
  return null;
}

/** "Skills: Java, Python" opens the skills section on a content line. */
function inlineHeading(line: string): SectionKind | null {
  const match = /^([A-Za-z][A-Za-z &/-]{2,40}?)\s*[:–-]\s+\S/.exec(line);
  if (!match?.[1]) return null;
  return HEADINGS[headingKey(match[1])] ?? null;
}

export function buildResumeDocument(text: string): ResumeDocument {
  const lines: ResumeLine[] = [];
  const sections = new Set<SectionKind>();
  let current: SectionKind = 'header';
  let headingText: string | null = null;

  for (const raw of text.split('\n')) {
    const value = raw.trim();
    if (!value) continue;
    const heading = classifyHeading(value);
    if (heading) {
      current = heading;
      headingText = value;
      sections.add(heading);
      lines.push({ index: lines.length, text: value, lower: value.toLowerCase(), section: heading, heading: true, headingText });
      continue;
    }
    const inline = inlineHeading(value);
    // "Languages: Java, Python" inside a skills section lists programming languages.
    if (inline && !(current === 'skills' && inline === 'other' && /^languages?\b/i.test(value))) {
      current = inline;
      headingText = value.split(/[:–-]/)[0]?.trim() ?? value;
      sections.add(inline);
    }
    lines.push({ index: lines.length, text: value, lower: value.toLowerCase(), section: current, heading: false, headingText });
  }

  return {
    lines,
    sections,
    characters: text.replace(/\s+/g, '').length,
    words: text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length,
  };
}

/* ------------------------------------------------------------------ *
 * Term matching
 * ------------------------------------------------------------------ */

const WORD_CHAR = '\\p{L}\\p{N}';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Short ambiguous forms ("IT", "BE", "C") must appear in capitals to count. */
export function isAcronymForm(term: string): boolean {
  return /^[a-z]{1,3}$/.test(normalizeTerm(term)) && normalizeTerm(term) !== 'go';
}

export function normalizeTerm(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export interface TermPattern {
  readonly term: string;
  readonly regex: RegExp;
}

/**
 * A term as a regex: separators inside it may be spaces or hyphens, and the
 * edges must not touch another letter, digit, `+` or `#` — so "Java" does not
 * match inside "JavaScript" and "C" does not match inside "C++".
 *
 * With `acronym`, the term is matched case-sensitively in capitals: short forms
 * such as "IT", "BE" or "MS" are ordinary English words in lower case.
 */
const compiled = new Map<string, TermPattern>();

export function compileTerm(term: string, options: { readonly acronym?: boolean } = {}): TermPattern {
  const normalized = normalizeTerm(term);
  const acronym = options.acronym ?? false;
  const cacheKey = `${acronym ? 'A' : 'i'}:${normalized}`;
  const cached = compiled.get(cacheKey);
  if (cached) {
    cached.regex.lastIndex = 0;
    return cached;
  }
  const body = normalized
    .split(/[\s-]+/)
    .map((part) => escapeRegExp(acronym ? part.toUpperCase() : part))
    .join('[\\s-]+');
  // "js" must not match inside "Node.js", nor "net" inside "ASP.NET".
  const leading = /^[.]/.test(normalized)
    ? `(?<![${WORD_CHAR}+#.])`
    : `(?<![${WORD_CHAR}+#])(?<![${WORD_CHAR}][.])`;
  const trailing = /[.]$/.test(normalized) ? `(?![${WORD_CHAR}+#])` : `(?![${WORD_CHAR}+#]|\\.[${WORD_CHAR}])`;
  const flags = acronym ? 'gu' : 'giu';
  const pattern = { term: normalized, regex: new RegExp(`${leading}${body}${trailing}`, flags) };
  if (compiled.size < 5000) compiled.set(cacheKey, pattern);
  return pattern;
}

export interface TermHit {
  readonly line: ResumeLine;
  readonly start: number;
  readonly end: number;
  readonly term: string;
}

export function findTerm(document: ResumeDocument, pattern: TermPattern): TermHit[] {
  const hits: TermHit[] = [];
  for (const line of document.lines) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(line.text)) !== null) {
      hits.push({ line, start: match.index, end: match.index + match[0].length, term: pattern.term });
      if (match[0].length === 0) pattern.regex.lastIndex += 1;
    }
  }
  return hits;
}

/** Where a mention is the best evidence: used in work beats merely listed. */
const SECTION_RANK: Readonly<Record<SectionKind, number>> = {
  experience: 0, projects: 1, summary: 2, skills: 3, certifications: 4, education: 5, header: 6, other: 7,
};

export function bestHit(hits: readonly TermHit[]): TermHit | null {
  let best: TermHit | null = null;
  for (const hit of hits) {
    if (hit.line.heading) continue;
    if (!best || SECTION_RANK[hit.line.section] < SECTION_RANK[best.line.section]) best = hit;
  }
  return best ?? hits[0] ?? null;
}

/** The resume line as evidence, without its bullet, cut to a window around the match. */
export function snippet(line: string, start = 0, end = 0, max = 160): string {
  const bullet = /^[-*>•·o]\s+/.exec(line)?.[0].length ?? 0;
  const text = line.slice(bullet);
  if (text.length <= max) return text;
  const matchStart = Math.max(0, start - bullet);
  const matchEnd = Math.max(0, end - bullet);
  const windowStart = Math.max(0, matchStart - 60);
  const windowEnd = Math.min(text.length, Math.max(matchEnd, windowStart) + (max - 60));
  const lead = windowStart > 0 ? '…' : '';
  const tail = windowEnd < text.length ? '…' : '';
  return lead + text.slice(windowStart, windowEnd).trim() + tail;
}

/* ------------------------------------------------------------------ *
 * Employment dates
 * ------------------------------------------------------------------ */

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

const MONTH_NAME = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const DATE = `(?:${MONTH_NAME}[\\s,]*'?\\s*(\\d{4}|\\d{2})|(0?[1-9]|1[0-2])\\s*[/.-]\\s*((?:19|20)\\d{2})|((?:19|20)\\d{2}))`;
const PRESENT = '(present|current(?:ly)?|now|till\\s+date|to\\s+date|till\\s+now|today|ongoing|date)';
const SEPARATOR = '\\s*(?:-|to|till|until|~|→|>)\\s*';
const RANGE = new RegExp(`(?<![\\p{L}\\p{N}])${DATE}${SEPARATOR}(?:${DATE}|${PRESENT})(?![\\p{L}\\p{N}])`, 'giu');
const SINCE = new RegExp(`\\bsince\\s+${DATE}`, 'giu');

interface MonthPoint {
  readonly year: number;
  readonly month: number | null;
}

function pointFrom(groups: readonly (string | undefined)[], asOfYear: number): MonthPoint | null {
  const [monthName, shortOrLongYear, numericMonth, numericYear, bareYear] = groups;
  if (monthName && shortOrLongYear) {
    const month = MONTHS[monthName.toLowerCase().replace('.', '')] ?? MONTHS[monthName.toLowerCase().slice(0, 3)];
    let year = Number(shortOrLongYear);
    if (shortOrLongYear.length === 2) year += year <= (asOfYear % 100) + 1 ? 2000 : 1900;
    return month ? { year, month } : null;
  }
  if (numericMonth && numericYear) return { year: Number(numericYear), month: Number(numericMonth) };
  if (bareYear) return { year: Number(bareYear), month: null };
  return null;
}

export interface DateRange {
  readonly line: ResumeLine;
  /** Month index (year * 12 + month - 1), inclusive. */
  readonly start: number;
  /** Month index, exclusive. */
  readonly end: number;
  readonly text: string;
  readonly approximate: boolean;
}

export function monthIndex(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

export function findDateRanges(document: ResumeDocument, asOf: Date): DateRange[] {
  const asOfYear = asOf.getUTCFullYear();
  const now = monthIndex(asOf) + 1;
  const ranges: DateRange[] = [];

  for (const line of document.lines) {
    for (const pattern of [RANGE, SINCE]) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line.text)) !== null) {
        const from = pointFrom(match.slice(1, 6), asOfYear);
        if (!from) continue;
        const present = pattern === SINCE || Boolean(match[11]);
        const to = present ? null : pointFrom(match.slice(6, 11), asOfYear);
        if (!present && !to) continue;

        let start = from.year * 12 + (from.month ?? 1) - 1;
        let end = present ? now : to!.year * 12 + (to!.month ?? 1) - 1 + (to!.month ? 1 : 0);
        const approximate = from.month === null || (!present && to!.month === null);
        if (end <= start && approximate) end = start + 6; // "2021 - 2021"
        if (from.year < 1960 || from.year > asOfYear + 1) continue;
        end = Math.min(end, now);
        start = Math.min(start, end);
        if (end - start <= 0 || end - start > 50 * 12) continue;
        ranges.push({ line, start, end, text: match[0], approximate });
      }
    }
  }
  return ranges;
}

const EDUCATION_WORDS = /\b(university|college|school|institute|iit|nit|b\.?\s?tech|b\.?\s?e\b|bachelor|master|m\.?\s?tech|mba|mca|bca|b\.?sc|m\.?sc|degree|cgpa|gpa|percentage|ssc|hsc|class\s+(x|xii|10|12)|10th|12th|semester|graduat)/i;
const INTERNSHIP = /\b(intern|internship|trainee\s+intern|summer\s+intern)\b/i;

export interface ExperienceEstimate {
  /** Years from merged employment date ranges (internships excluded), or null when none. */
  readonly datedYears: number | null;
  readonly roles: number;
  readonly internshipMonths: number;
  readonly approximate: boolean;
  readonly firstStart: number | null;
  /** Largest "N years of experience" the resume states, or null. */
  readonly statedYears: number | null;
  readonly statedEvidence: string | null;
  readonly datedEvidence: string | null;
}

function isWorkRange(document: ResumeDocument, range: DateRange): boolean {
  const { section } = range.line;
  // With an experience section, only dates inside it are employment.
  if (document.sections.has('experience')) return section === 'experience';
  if (section === 'education' || section === 'projects' || section === 'certifications' || section === 'skills') return false;
  // Without one, keep ranges that do not read as schooling.
  const previous = document.lines[range.line.index - 1];
  return !EDUCATION_WORDS.test(range.line.text)
    && !(previous && !previous.heading && previous.text.length < 90 && EDUCATION_WORDS.test(previous.text));
}

function isInternship(document: ResumeDocument, range: DateRange): boolean {
  if (INTERNSHIP.test(range.line.text)) return true;
  if (range.line.headingText && INTERNSHIP.test(range.line.headingText)) return true;
  const previous = document.lines[range.line.index - 1];
  return Boolean(previous && !previous.heading && previous.text.length <= 90 && INTERNSHIP.test(previous.text));
}

const STATED = [
  /\b(\d{1,2}(?:\.\d{1,2})?)\s*\+?\s*(?:years?|yrs?)'?(?:\s*(?:and|&)?\s*\d{1,2}\s*(?:months?|mos?))?\s*(?:of\s+)?(?:[a-z/&.+#-]+\s+){0,4}?(?:work\s+|professional\s+|industry\s+|relevant\s+|total\s+|hands-on\s+)?experience\b/gi,
  /\b(?:total\s+|overall\s+|work\s+|professional\s+)?experience\s*(?:of|:|-)?\s*(\d{1,2}(?:\.\d{1,2})?)\s*\+?\s*(?:years?|yrs?)\b/gi,
];

export function estimateExperience(document: ResumeDocument, asOf: Date): ExperienceEstimate {
  const ranges = findDateRanges(document, asOf);
  const work: DateRange[] = [];
  let internshipMonths = 0;
  for (const range of ranges) {
    if (!isWorkRange(document, range)) continue;
    if (isInternship(document, range)) {
      internshipMonths += range.end - range.start;
      continue;
    }
    work.push(range);
  }

  // Overlapping roles (a promotion, a part-time job) must not double-count time.
  const sorted = [...work].sort((a, b) => a.start - b.start);
  let months = 0;
  let cursorStart = -1;
  let cursorEnd = -1;
  for (const range of sorted) {
    if (range.start >= cursorEnd) {
      months += cursorEnd - cursorStart;
      cursorStart = range.start;
      cursorEnd = range.end;
    } else {
      cursorEnd = Math.max(cursorEnd, range.end);
    }
  }
  months += cursorEnd - cursorStart;

  let statedYears: number | null = null;
  let statedEvidence: string | null = null;
  for (const line of document.lines) {
    if (line.section === 'education') continue;
    for (const pattern of STATED) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line.text)) !== null) {
        const years = Number(match[1]);
        if (Number.isFinite(years) && years > 0 && years <= 50 && (statedYears === null || years > statedYears)) {
          statedYears = years;
          statedEvidence = snippet(line.text, match.index, match.index + match[0].length);
        }
      }
    }
  }

  const first = sorted[0];
  return {
    datedYears: sorted.length > 0 ? Math.round((months / 12) * 10) / 10 : null,
    roles: sorted.length,
    internshipMonths,
    approximate: sorted.some((range) => range.approximate),
    firstStart: first ? first.start : null,
    statedYears,
    statedEvidence,
    datedEvidence: first ? snippet(first.line.text) : null,
  };
}
