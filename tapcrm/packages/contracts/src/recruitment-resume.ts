/**
 * Recruitment resume parsing contracts.
 *
 * Resumes are parsed on our own servers with a rule-based parser — no external
 * AI or parsing service sees the candidate's data. The result pre-fills forms
 * and helps HR read a resume quickly; it is never a decision by itself.
 *
 * Records written by older parser versions carry only some of these fields, so
 * every field is optional and readers must tolerate its absence.
 */

/** How sure the parser is about a contact field, from the evidence it found. */
export type ParsedFieldConfidence = 'high' | 'medium' | 'low';

export interface ParsedResumeExperience {
  readonly title?: string | undefined;
  readonly company?: string | undefined;
  readonly location?: string | undefined;
  /** The dates as written, e.g. "Mar 2019 - Present". */
  readonly duration?: string | undefined;
  /** "YYYY-MM", or "YYYY" when the resume gives only the year. */
  readonly startDate?: string | undefined;
  /** "YYYY-MM" or "YYYY"; absent while the role is current. */
  readonly endDate?: string | undefined;
  readonly current?: boolean | undefined;
}

export interface ParsedResumeEducation {
  /** Short form, e.g. "B.Tech", "MBA", "HSC". */
  readonly degree?: string | undefined;
  /** Field of study, e.g. "Computer Science". */
  readonly field?: string | undefined;
  readonly institution?: string | undefined;
  /** Year completed, or expected ("2025 (expected)"). */
  readonly year?: string | undefined;
  /** As written: "CGPA 8.6/10", "72%". */
  readonly grade?: string | undefined;
}

export interface ParsedResumeProject {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
}

export interface ParsedResumeLinks {
  readonly linkedin?: string | undefined;
  readonly github?: string | undefined;
  readonly portfolio?: string | undefined;
}

export interface ParsedResumeConfidence {
  readonly name?: ParsedFieldConfidence | undefined;
  readonly email?: ParsedFieldConfidence | undefined;
  readonly phone?: ParsedFieldConfidence | undefined;
}

export interface ParsedResumeData {
  readonly name?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly skills?: readonly string[] | undefined;
  readonly education?: readonly ParsedResumeEducation[] | undefined;
  readonly experience?: readonly ParsedResumeExperience[] | undefined;
  readonly projects?: readonly ParsedResumeProject[] | undefined;
  /** The resume's own summary or objective, when it has one. */
  readonly summary?: string | null | undefined;
  readonly rawTextPreview?: string | undefined;
  /** Set by the current parser; absent on records from the first version. */
  readonly parserVersion?: string | undefined;
  /** The line under the name, e.g. "Senior UI Designer". */
  readonly headline?: string | null | undefined;
  readonly links?: ParsedResumeLinks | undefined;
  /** Years of dated, non-internship employment; null when no dates were found. */
  readonly experienceYears?: number | null | undefined;
  readonly confidence?: ParsedResumeConfidence | undefined;
  /** Further addresses and numbers found, after the primary ones. */
  readonly otherEmails?: readonly string[] | undefined;
  readonly otherPhones?: readonly string[] | undefined;
  /** Why parts of the file could not be read (scanned PDF, damaged file). */
  readonly warnings?: readonly string[] | undefined;
  /**
   * Set when the text was read from scanned pages with text recognition (OCR).
   * Every value may then be misread, so none is reported with high confidence.
   */
  readonly ocr?: ParsedResumeOcr | undefined;
}

export interface ParsedResumeOcr {
  /** Scanned pages read. */
  readonly pages: number;
  /** Mean word confidence, 0–100, from the recognition engine. */
  readonly confidence: number | null;
}

/** What the "parse resume" endpoint returns to pre-fill a form. */
export interface ParsedCandidateData extends ParsedResumeData {
  readonly name: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly skills: readonly string[];
}

/** "K.", "K", "K.S." or "KS" — initials, not a name. */
function isInitial(token: string): boolean {
  if (/^(?:\p{Lu}\.){1,3}\p{Lu}?$/u.test(token) || /^\p{Lu}$/u.test(token)) return true;
  // Two or three capitals without a vowel ("KS", "KSR") are initials; "LI" is a name.
  return /^\p{Lu}{2,3}$/u.test(token) && !/[AEIOUY]/.test(token);
}

/**
 * Splits a person's name for First/Last name fields.
 *
 * The first full word is the first name and everything else, in order, is the
 * last name — "Rohit Kumar Verma" → Rohit / Kumar Verma. Initials are never a
 * first name, wherever they stand: "K. S. Raghavan" → Raghavan / K. S., so
 * emails can greet the candidate by the name they use.
 */
export function splitPersonName(name: string): { readonly firstName: string; readonly lastName: string } {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: '', lastName: '' };
  const firstIndex = tokens.findIndex((token) => !isInitial(token));
  if (firstIndex < 0) return { firstName: tokens.join(' '), lastName: '' };
  return {
    firstName: tokens[firstIndex]!,
    lastName: tokens.filter((_, index) => index !== firstIndex).join(' '),
  };
}
