import type { ParsedCandidateData, ParsedFieldConfidence, ParsedResumeData } from '@tapcrm/contracts';

/**
 * Filling the candidate form from a parsed resume.
 *
 * The rules, in one place for every form that reads resumes:
 *  - a field is filled only while it is empty or still holds a value an
 *    earlier resume put there — never over something HR typed;
 *  - a value the parser is unsure of is offered as a suggestion, not filled;
 *  - removing or replacing the resume takes its values back out.
 */

export type AutofillField = 'firstName' | 'lastName' | 'email' | 'phone';

export const AUTOFILL_FIELDS: readonly AutofillField[] = ['firstName', 'lastName', 'email', 'phone'];

export type CandidateFields = Readonly<Record<AutofillField, string>>;

export interface AutofillState {
  readonly values: CandidateFields;
  /** Fields whose current value came from the resume, with the parser's confidence. */
  readonly filled: Readonly<Partial<Record<AutofillField, ParsedFieldConfidence>>>;
  /** Values read from the resume that were not filled in: unsure, or HR had typed something else. */
  readonly suggestions: Readonly<Partial<Record<AutofillField, string>>>;
}

export const EMPTY_AUTOFILL: AutofillState = {
  values: { firstName: '', lastName: '', email: '', phone: '' },
  filled: {},
  suggestions: {},
};

function without<T extends object>(record: T, key: keyof T): T {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

/** HR typing in a field makes the value theirs. */
export function editField(state: AutofillState, field: AutofillField, value: string): AutofillState {
  return {
    values: { ...state.values, [field]: value },
    filled: without(state.filled, field),
    suggestions: without(state.suggestions, field),
  };
}

/** Takes back every value a resume filled, keeping what HR typed. */
export function clearAutofill(state: AutofillState): AutofillState {
  const values = { ...state.values };
  for (const field of AUTOFILL_FIELDS) if (state.filled[field]) values[field] = '';
  return { values, filled: {}, suggestions: {} };
}

/** Uses the suggested value for a field — both name fields at once for a name. */
export function acceptSuggestion(state: AutofillState, field: AutofillField): AutofillState {
  const fields: AutofillField[] = field === 'firstName' || field === 'lastName' ? ['firstName', 'lastName'] : [field];
  let next = state;
  for (const target of fields) {
    const value = state.suggestions[target];
    if (value === undefined) continue;
    next = { ...editField(next, target, value), filled: { ...next.filled, [target]: 'high' } };
  }
  return next;
}

/** Applies a parsed resume to the form under the rules above. */
export function applyParsedResume(state: AutofillState, parsed: ParsedCandidateData): AutofillState {
  const base = clearAutofill(state);
  const values = { ...base.values };
  const filled: Partial<Record<AutofillField, ParsedFieldConfidence>> = {};
  const suggestions: Partial<Record<AutofillField, string>> = {};
  const confidence = parsed.confidence ?? {};

  const offer = (field: AutofillField, value: string | null | undefined, sure: ParsedFieldConfidence | undefined) => {
    const clean = value?.trim();
    if (!clean) return;
    const current = values[field].trim();
    if (current && current.toLowerCase() !== clean.toLowerCase()) {
      suggestions[field] = clean;
      return;
    }
    if (current) return; // HR already typed the same value
    if ((sure ?? 'medium') === 'low') {
      suggestions[field] = clean;
      return;
    }
    values[field] = clean;
    filled[field] = sure ?? 'medium';
  };

  // The name is one value: if HR typed a different name, the resume's whole name
  // is offered rather than mixing their first name with the resume's last name.
  const first = parsed.firstName?.trim() ?? '';
  const last = parsed.lastName?.trim() ?? '';
  const typedFirst = values.firstName.trim();
  const typedLast = values.lastName.trim();
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (first) {
    const conflict = (typedFirst && !same(typedFirst, first)) || (typedLast && !same(typedLast, last));
    if (conflict || (confidence.name ?? 'medium') === 'low') {
      suggestions.firstName = first;
      suggestions.lastName = last;
    } else {
      offer('firstName', first, confidence.name);
      offer('lastName', last, confidence.name);
    }
  }
  offer('email', parsed.email, confidence.email);
  offer('phone', parsed.phone, confidence.phone);
  return { values, filled, suggestions };
}

/** A link that is safe to open: http(s) only. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** "linkedin.com/in/asha" for display. */
export function shortUrl(value: string): string {
  return value.replace(/^https?:\/\/(?:www\.)?/i, '').replace(/\/$/, '');
}

export interface ResumeHighlights {
  /** "Senior UI Designer at Zoho Corporation". */
  readonly role: string | null;
  readonly experienceYears: number | null;
  readonly skills: readonly string[];
  readonly links: readonly { readonly label: string; readonly href: string }[];
}

/** The few facts worth showing while HR checks the form. */
export function resumeHighlights(parsed: ParsedResumeData): ResumeHighlights {
  const latest = parsed.experience?.[0];
  const role = latest?.title && latest.company ? `${latest.title} at ${latest.company}` : parsed.headline ?? latest?.title ?? null;
  const links: { label: string; href: string }[] = [];
  for (const [label, value] of [['LinkedIn', parsed.links?.linkedin], ['GitHub', parsed.links?.github], ['Portfolio', parsed.links?.portfolio]] as const) {
    const href = safeHttpUrl(value);
    if (href) links.push({ label, href });
  }
  return {
    role,
    experienceYears: typeof parsed.experienceYears === 'number' ? parsed.experienceYears : null,
    skills: (parsed.skills ?? []).slice(0, 6),
    links,
  };
}

/** "6.5 yrs" / "8 months". */
export function formatYears(years: number): string {
  if (years < 1) return `${Math.max(1, Math.round(years * 12))} months`;
  const rounded = Math.round(years * 10) / 10;
  return `${rounded} ${rounded === 1 ? 'yr' : 'yrs'}`;
}

/** A short text version of the parsed resume for screening notes. */
export function resumeNotes(parsed: ParsedResumeData): string {
  const lines: string[] = [];
  const highlights = resumeHighlights(parsed);
  const latest = parsed.experience?.[0];
  if (highlights.role) lines.push(`Latest role: ${highlights.role}${latest?.duration ? ` (${latest.duration})` : ''}`);
  if (highlights.experienceYears !== null && highlights.experienceYears > 0) lines.push(`Experience: ${formatYears(highlights.experienceYears)}`);
  const education = (parsed.education ?? []).slice(0, 2).map((entry) => [
    [entry.degree, entry.field].filter(Boolean).join(', '),
    entry.institution,
    entry.year,
  ].filter(Boolean).join(' · '));
  if (education.length > 0) lines.push(`Education: ${education.join('; ')}`);
  if (parsed.skills && parsed.skills.length > 0) lines.push(`Skills: ${parsed.skills.slice(0, 15).join(', ')}`);
  return lines.join('\n');
}

/** The MIME type to send for a chosen file; browsers leave it empty for some Word files. */
export function resumeMimeType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  const byExtension: Readonly<Record<string, string>> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    txt: 'text/plain',
  };
  return byExtension[extension] ?? 'application/octet-stream';
}
