import type { ParsedFieldConfidence } from '@tapcrm/contracts';

/**
 * Contact details: email addresses, phone numbers and profile links.
 *
 * Each finder returns every candidate it sees, ranked, so the caller can pick
 * the candidate's own details (the ones at the top of the resume, labelled
 * "Mobile", matching the name) over a referee's or a father's number.
 */

export interface ContactLine {
  readonly text: string;
  /** Position in the document, 0-based. */
  readonly index: number;
  /** Section the line sits in ("header", "experience", "other"…). */
  readonly section: string;
  /** Heading of that section as written, lower-cased, if any. */
  readonly heading: string | null;
}

export interface RankedValue {
  readonly value: string;
  readonly score: number;
  readonly confidence: ParsedFieldConfidence;
}

/* ------------------------------------------------------------------ *
 * Email
 * ------------------------------------------------------------------ */

const EMAIL = /[A-Za-z0-9][A-Za-z0-9._%+'-]*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,24}(?![A-Za-z0-9-])/g;
const COMMON_TLDS = 'com|in|co|org|net|edu|io|ai|me|info|biz|us|uk|gov|ac|dev|app|tech|online|xyz';
const EMAIL_LABEL = /^(?:e-?mail|mail|e-?mail-?id)[-:]+/i;

/** Rejoins addresses that a PDF drew in pieces or that a candidate obfuscated. */
function emailReady(line: string): string {
  return line
    .replace(/\s*[[(]\s*at\s*[\])]\s*/gi, '@')
    .replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, '.')
    .replace(/([A-Za-z0-9._%+-])\s+@\s*(?=[A-Za-z0-9])/g, '$1@')
    .replace(/@\s+(?=[A-Za-z0-9])/g, '@')
    .replace(new RegExp(`(@[A-Za-z0-9.-]+)\\s+(\\.(?:${COMMON_TLDS})\\b)`, 'gi'), '$1$2');
}

export function cleanEmail(raw: string): string | null {
  let value = raw.trim().toLowerCase().replace(/^mailto:/, '');
  value = value.split('?')[0] ?? value;
  try {
    value = decodeURIComponent(value);
  } catch {
    // keep as is
  }
  value = value.replace(EMAIL_LABEL, '');
  const [local = '', domain = ''] = value.split('@');
  // "9876543210rahul@…": a phone number fused to the address by the PDF.
  const unglued = local.replace(/^\+?\d{7,}(?=[a-z])/, '');
  const cleanLocal = unglued.replace(/^[._'-]+|[._'-]+$/g, '');
  if (!cleanLocal || !domain || cleanLocal.includes('..') || domain.includes('..')) return null;
  if (!/^[a-z0-9.-]+\.[a-z]{2,24}$/.test(domain)) return null;
  if (cleanLocal.length > 64 || domain.length > 190) return null;
  return `${cleanLocal}@${domain}`;
}

export function findEmails(lines: readonly ContactLine[], links: readonly string[], nameTokens: readonly string[]): RankedValue[] {
  const scores = new Map<string, number>();
  const add = (email: string | null, score: number) => {
    if (!email) return;
    scores.set(email, Math.max(scores.get(email) ?? Number.NEGATIVE_INFINITY, score));
  };

  for (const link of links) {
    if (/^mailto:/i.test(link)) add(cleanEmail(link), 30);
  }
  for (const line of lines) {
    const ready = emailReady(line.text);
    for (const match of ready.matchAll(EMAIL)) {
      let score = 20 - Math.min(line.index, 40) * 0.2;
      if (line.section === 'header') score += 4;
      if (isReferenceLine(line)) score -= 25;
      add(cleanEmail(match[0]), score);
    }
  }

  return [...scores.entries()]
    .map(([value, base]) => {
      const local = value.split('@')[0] ?? '';
      const nameHits = nameTokens.filter((token) => token.length >= 3 && local.includes(token)).length;
      const generic = /^(?:info|hr|careers|jobs|contact|admin|support|noreply|no-reply|hello|sales)@/.test(value);
      const score = base + nameHits * 6 - (generic ? 15 : 0);
      const confidence: ParsedFieldConfidence = score >= 22 ? 'high' : score >= 10 ? 'medium' : 'low';
      return { value, score, confidence };
    })
    .sort((a, b) => b.score - a.score);
}

function isReferenceLine(line: ContactLine): boolean {
  return /\b(?:references?|referees?)\b/.test(line.heading ?? '');
}

/* ------------------------------------------------------------------ *
 * Phone
 * ------------------------------------------------------------------ */

type PhoneKind = 'in-mobile' | 'in-landline' | 'nanp' | 'international' | 'local';

interface PhoneCandidate {
  readonly display: string;
  readonly key: string;
  readonly kind: PhoneKind;
}

/** Runs of digits with the separators phone numbers are written with. */
const PHONE_RUN = /(?:\+|\b00)?\s?(?:\(\s?\+?\d{1,4}\s?\)\s?)?\d[\d\s().-]{5,22}\d/g;
const NOT_A_PHONE_LABEL = /\b(?:aadhaa?r|uid|pan|passport|a\/c|account|acct|ifsc|cin|gstin?|roll|reg(?:istration)?\.?\s*no|enrol(?:l)?ment|employee\s*id|emp\.?\s*id|ctc|salary|lpa|package|pin\s*code|pincode|pin|zip|postal|isbn|issn|license|licence|invoice|order|ticket|policy|dob|date\s+of\s+birth|batch|id\s*no|serial)\b/i;
const OTHER_PERSON = /\b(?:father|mother|parent|guardian|spouse|husband|wife|brother|sister|emergency|reference|referee|manager's|supervisor's)\b/i;
const MOBILE_LABEL = /\b(?:mobile|mob|cell|cellphone|whatsapp|wa|m)\b\.?\s*(?:no\.?|number|#)?\s*[:.-]?\s*$/i;
const PHONE_LABEL = /\b(?:phone|ph|contact|tel|telephone|call|p|t)\b\.?\s*(?:no\.?|number|#)?\s*[:.-]?\s*$/i;
const SECONDARY_LABEL = /\b(?:alt|alternate|alternative|landline|office|off|res|residence|home|work|fax|other)\b\.?\s*(?:no\.?|number|#)?\s*[:.-]?\s*$/i;

function looksLikeDate(run: string): boolean {
  const compact = run.trim();
  return /^\(?(?:19|20)\d{2}\s*[-.–]\s*(?:19|20)?\d{2}\)?$/.test(compact) // 2016 - 2020
    || /^\d{1,2}\s*[-./]\s*\d{1,2}\s*[-./]\s*(?:19|20)?\d{2}$/.test(compact) // 14-08-1994
    || /^(?:19|20)\d{2}\s*[-./]\s*\d{1,2}\s*[-./]\s*\d{1,2}$/.test(compact) // 1994-08-14
    || /^\(?(?:19|20)\d{2}\)?(?:\s+\(?(?:19|20)\d{2}\)?)+$/.test(compact); // 2019 2021
}

function groupDigits(digits: string, sizes: readonly number[]): string {
  const parts: string[] = [];
  let offset = 0;
  for (const size of sizes) {
    parts.push(digits.slice(offset, offset + size));
    offset += size;
  }
  return parts.join(' ');
}

/** Classifies one run of digits; null when it is not a usable phone number. */
export function classifyPhone(run: string): PhoneCandidate | null {
  if (looksLikeDate(run)) return null;
  // "+91 (0) 98765 43210": the bracketed trunk zero is not dialled after a country code.
  const trimmed = run.trim().replace(/\(\s*0\s*\)\s*/, '');
  const plus = /^\(?\s*\+/.test(trimmed) || /^00\d/.test(trimmed);
  let digits = trimmed.replace(/\D/g, '');
  if (/^00/.test(digits) && plus) digits = digits.slice(2);
  if (digits.length < 7 || digits.length > 15) return null;
  // "80-41234567", "+91-80-41234567": a two-digit metro code and an eight-digit
  // number is a landline, although 8 can also start a mobile number.
  const national = trimmed.replace(/^\(?\s*(?:\+|00)\s*91\s*\)?[\s.-]*/, '');
  const groups = national.split(/[\s.-]+/).filter(Boolean);
  if (groups.length === 2 && /^0?\d{2}$/.test(groups[0]!) && /^\d{8}$/.test(groups[1]!)) {
    const local = `${groups[0]!.replace(/^0/, '')}${groups[1]!}`;
    return { display: `+91 ${groups[0]!.replace(/^0/, '')} ${groups[1]!}`, key: `+91${local}`, kind: 'in-landline' };
  }

  const mobile = (national: string): PhoneCandidate => ({
    display: `+91 ${groupDigits(national, [5, 5])}`,
    key: `+91${national}`,
    kind: 'in-mobile',
  });

  if (plus) {
    if (digits.startsWith('91') && digits.length === 12 && /^[6-9]/.test(digits.slice(2))) return mobile(digits.slice(2));
    if (digits.startsWith('91') && digits.length >= 11 && digits.length <= 12) {
      return { display: `+91 ${digits.slice(2)}`, key: `+${digits}`, kind: 'in-landline' };
    }
    if (digits.startsWith('1') && digits.length === 11) {
      return { display: `+1 ${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`, key: `+${digits}`, kind: 'nanp' };
    }
    if (digits.length < 8) return null;
    const display = `+${trimmed.replace(/^[(\s]*(?:\+|00)/, '').replace(/[()]/g, ' ').replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim()}`;
    return { display, key: `+${digits}`, kind: 'international' };
  }

  // A bracketed area code is how North American numbers are written: (415) 555-0134.
  if (digits.length === 10 && /^\(\s?\d{3}\s?\)/.test(trimmed)) {
    return { display: `+1 ${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`, key: `+1${digits}`, kind: 'nanp' };
  }
  if (digits.length === 10 && /^[6-9]/.test(digits)) return mobile(digits);
  // "080-41234567" is an STD code and a landline, even though 8 can start a mobile number.
  const firstGroup = trimmed.split(/[\s.-]+/)[0] ?? '';
  const stdCode = digits.length === 11 && /^0\d{2,4}$/.test(firstGroup) && trimmed.length > firstGroup.length;
  if (digits.length === 11 && digits.startsWith('0') && !stdCode && /^[6-9]/.test(digits.slice(1))) return mobile(digits.slice(1));
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) return mobile(digits.slice(2));
  if (digits.length === 11 && /^0[1-9]/.test(digits)) {
    return { display: trimmed.replace(/\s+/g, ' '), key: `+91${digits.slice(1)}`, kind: 'in-landline' };
  }
  if (digits.length >= 7 && digits.length <= 8 && /[\s-]/.test(trimmed) === false) {
    return { display: digits, key: digits, kind: 'local' };
  }
  return null;
}

/**
 * A run can hold two numbers written side by side ("98765 43210 91234 56789");
 * when it does not read as one number, its space-separated groups are tried
 * as consecutive numbers.
 */
function phonesIn(run: string): PhoneCandidate[] {
  const whole = classifyPhone(run);
  if (whole) return [whole];
  if (run.replace(/\D/g, '').length < 14) return [];
  const found: PhoneCandidate[] = [];
  let buffer = '';
  for (const group of run.trim().split(/\s+/)) {
    buffer = buffer ? `${buffer} ${group}` : group;
    const candidate = buffer.replace(/\D/g, '').length >= 10 ? classifyPhone(buffer) : null;
    if (candidate) {
      found.push(candidate);
      buffer = '';
    }
  }
  return found;
}

const KIND_SCORE: Readonly<Record<PhoneKind, number>> = {
  'in-mobile': 8,
  nanp: 6,
  international: 6,
  'in-landline': 2,
  local: -2,
};

export function findPhones(lines: readonly ContactLine[], links: readonly string[]): RankedValue[] {
  const best = new Map<string, { display: string; score: number }>();
  const add = (candidate: PhoneCandidate | null, score: number) => {
    if (!candidate) return;
    const total = score + KIND_SCORE[candidate.kind];
    const previous = best.get(candidate.key);
    if (!previous || total > previous.score) best.set(candidate.key, { display: candidate.display, score: total });
  };

  for (const link of links) {
    const match = /^tel:(.+)$/i.exec(link.trim());
    if (match?.[1]) {
      let number = match[1];
      try {
        number = decodeURIComponent(number);
      } catch {
        // keep as is
      }
      add(classifyPhone(number), 14);
    }
  }

  for (const line of lines) {
    const text = line.text.replace(/\t/g, '  ');
    if (OTHER_PERSON.test(text) && !/\b(?:my|self)\b/i.test(text)) continue;
    for (const match of text.matchAll(PHONE_RUN)) {
      const start = match.index ?? 0;
      const before = text.slice(Math.max(0, start - 28), start);
      if (NOT_A_PHONE_LABEL.test(before) || /[A-Za-z0-9]$/.test(before)) continue;
      // "080-41234567 / +91 99000 11223": several numbers in one run.
      for (const piece of match[0].split(/\s{2,}|\s[/|,]\s/)) {
        let score = 6 - Math.min(line.index, 60) * 0.1;
        if (line.section === 'header') score += 3;
        if (isReferenceLine(line)) score -= 20;
        if (MOBILE_LABEL.test(before)) score += 5;
        else if (PHONE_LABEL.test(before)) score += 3;
        if (SECONDARY_LABEL.test(before)) score -= 3;
        if (/\bfax\b/i.test(before)) continue;
        for (const candidate of phonesIn(piece)) add(candidate, score);
      }
    }
  }

  return [...best.values()]
    .map(({ display, score }): RankedValue => ({
      value: display,
      score,
      confidence: score >= 14 ? 'high' : score >= 8 ? 'medium' : 'low',
    }))
    .sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ *
 * Profile links
 * ------------------------------------------------------------------ */

const LINKEDIN = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(in|pub)\/([A-Za-z0-9\-_%.]+)/gi;
const GITHUB = /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?)(?![A-Za-z0-9-])/gi;
const GITHUB_RESERVED = new Set(['features', 'about', 'pricing', 'orgs', 'topics', 'marketplace', 'sponsors', 'login', 'join', 'explore', 'settings']);
const URL = /\b(?:https?:\/\/|www\.)[^\s|,;()<>"']+|\b[a-z0-9-]+\.(?:github\.io|vercel\.app|netlify\.app|wordpress\.com|blogspot\.com|medium\.com)(?:\/[^\s|,;()<>"']*)?|\b(?:behance\.net|dribbble\.com|kaggle\.com|leetcode\.com|medium\.com|about\.me|codepen\.io|hackerrank\.com|codechef\.com|stackoverflow\.com)\/[^\s|,;()<>"']+/gi;
const NOT_PORTFOLIO = /linkedin\.com|github\.com|google\.|facebook\.com|instagram\.com|twitter\.com|\bx\.com|youtube\.com|wa\.me|whatsapp/i;

export interface FoundLinks {
  readonly linkedin?: string;
  readonly github?: string;
  readonly portfolio?: string;
}

/**
 * PDF exports wrap long profile URLs: "linkedin.com/in/anil-" + "menon-1234".
 * Rejoins a line ending inside a URL with the next line's first word.
 */
function unwrapUrls(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index] ?? '';
    const next = lines[index + 1];
    if (next && /(?:linkedin\.com\/(?:in|pub)\/|github\.com\/)[A-Za-z0-9_%.-]*-$/i.test(line)) {
      const head = /^[A-Za-z0-9_%.-]+/.exec(next)?.[0];
      if (head) line += head;
    }
    out.push(line);
  }
  return out;
}

export function findLinks(lines: readonly ContactLine[], links: readonly string[]): FoundLinks {
  const header = lines.filter((line) => line.index < 25 || line.section === 'header').map((line) => line.text);
  const sources = [...links, ...unwrapUrls(lines.map((line) => line.text))];
  let linkedin: string | undefined;
  let github: string | undefined;
  let portfolio: string | undefined;

  for (const source of sources) {
    if (!linkedin) {
      for (const match of source.matchAll(LINKEDIN)) {
        const slug = (match[2] ?? '').replace(/[.%]+$/, '');
        if (slug.length >= 2) {
          linkedin = `https://www.linkedin.com/${(match[1] ?? 'in').toLowerCase()}/${slug}`;
          break;
        }
      }
    }
    if (!github) {
      for (const match of source.matchAll(GITHUB)) {
        const user = match[1] ?? '';
        if (user && !GITHUB_RESERVED.has(user.toLowerCase())) {
          github = `https://github.com/${user}`;
          break;
        }
      }
    }
  }

  for (const source of [...links, ...header]) {
    if (portfolio) break;
    for (const match of source.matchAll(URL)) {
      const value = match[0].replace(/[.,]+$/, '');
      if (NOT_PORTFOLIO.test(value) || /@/.test(value)) continue;
      portfolio = /^https?:\/\//i.test(value) ? value : `https://${value}`;
      break;
    }
  }

  return {
    ...(linkedin ? { linkedin } : {}),
    ...(github ? { github } : {}),
    ...(portfolio ? { portfolio } : {}),
  };
}
