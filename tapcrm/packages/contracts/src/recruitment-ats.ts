/**
 * Recruitment ATS (applicant screening) contracts.
 *
 * The scan is local, deterministic and evidence-based: it compares the resume
 * text against job-related criteria HR configured for the job and explains
 * every point it awards. It is decision SUPPORT — a score never accepts or
 * rejects an application by itself; HR does that.
 */
export interface AtsCriteria {
  readonly requiredSkills: readonly string[];
  readonly preferredSkills: readonly string[];
  readonly minimumExperienceYears: number | null;
  readonly requiredQualifications: readonly string[];
}

export type AtsCategory = 'required_skills' | 'preferred_skills' | 'experience' | 'qualifications';

/**
 * Relative importance of each category. A job's score is spread over only the
 * categories it uses, in these proportions, so the weights always total 100.
 */
export const ATS_BASE_WEIGHTS: Readonly<Record<AtsCategory, number>> = {
  required_skills: 50,
  experience: 20,
  qualifications: 15,
  preferred_skills: 15,
};

export const ATS_CATEGORY_ORDER: readonly AtsCategory[] = ['required_skills', 'experience', 'qualifications', 'preferred_skills'];

/**
 * Integer weights for the categories a job uses, in ATS_BASE_WEIGHTS
 * proportions, rounded by largest remainder so they always total exactly 100.
 */
export function atsCategoryWeights(categories: readonly AtsCategory[]): Map<AtsCategory, number> {
  const weights = new Map<AtsCategory, number>();
  if (categories.length === 0) return weights;
  const base = categories.reduce((sum, category) => sum + ATS_BASE_WEIGHTS[category], 0);
  const exact = categories.map((category) => ({ category, value: (ATS_BASE_WEIGHTS[category] / base) * 100 }));
  let assigned = 0;
  for (const item of exact) {
    weights.set(item.category, Math.floor(item.value));
    assigned += Math.floor(item.value);
  }
  const byRemainder = [...exact].sort((a, b) =>
    (b.value % 1) - (a.value % 1) || ATS_CATEGORY_ORDER.indexOf(a.category) - ATS_CATEGORY_ORDER.indexOf(b.category));
  for (let i = 0; i < 100 - assigned; i += 1) {
    const item = byRemainder[i % byRemainder.length]!;
    weights.set(item.category, (weights.get(item.category) ?? 0) + 1);
  }
  return weights;
}

export const ATS_CATEGORY_LABELS: Readonly<Record<AtsCategory, string>> = {
  required_skills: 'Required skills',
  preferred_skills: 'Preferred skills',
  experience: 'Experience',
  qualifications: 'Qualifications',
};

export type AtsCheckOutcome = 'matched' | 'not_found' | 'uncertain';

export interface AtsCheck {
  readonly category: AtsCategory;
  readonly criterion: string;
  readonly outcome: AtsCheckOutcome;
  /** The resume line that supports the outcome, when there is one. */
  readonly evidence: string | null;
  /** Why the check landed where it did (alias used, years found, in progress…). */
  readonly note: string | null;
}

export interface AtsBreakdown {
  readonly category: AtsCategory;
  readonly label: string;
  /** Integer weight after redistribution across configured categories; all weights sum to 100. */
  readonly weight: number;
  readonly matchedCount: number;
  readonly uncertainCount: number;
  readonly criteriaCount: number;
  /** Points earned out of `weight`, one decimal place. */
  readonly points: number;
}

export type AtsResumeFormat = 'pdf' | 'docx' | 'doc' | 'txt' | 'unknown';

export interface AtsExtractionSummary {
  readonly format: AtsResumeFormat;
  readonly characters: number;
  readonly pageCount: number | null;
  /** Standard resume sections that were recognised, e.g. experience, education, skills. */
  readonly sections: readonly string[];
  /** Scanned pages read with text recognition (OCR); absent when the file had real text. */
  readonly ocrPages?: number | undefined;
}

export interface AtsEvaluation {
  readonly status: 'completed' | 'needs_review';
  /** 0–100. Null when the resume text is insufficient for a reliable score. */
  readonly score: number | null;
  readonly checks: readonly AtsCheck[];
  readonly breakdown: readonly AtsBreakdown[];
  /** Reading problems and caveats HR should know before relying on the score. */
  readonly warnings: readonly string[];
  readonly extractedExperienceYears: number | null;
  readonly extraction: AtsExtractionSummary;
}

export interface AtsScanReport extends AtsEvaluation {
  readonly id: string;
  readonly submissionId: string;
  readonly requisitionId: string;
  readonly criteria: AtsCriteria;
  readonly criteriaHash: string;
  readonly resumeHash: string;
  readonly engineVersion: string;
  readonly scannedBy: string;
  readonly scannedByName: string | null;
  readonly createdAt: string;
  /** True when the job's criteria or the engine changed after this scan. */
  readonly stale: boolean;
}

export interface AtsCriteriaSettings {
  readonly requisitionId: string;
  readonly criteria: AtsCriteria;
  readonly criteriaHash: string;
  /** Null until HR saves criteria; until then `criteria` is a suggestion drawn from the job post. */
  readonly updatedAt: string | null;
  readonly configured: boolean;
}

export interface AtsSubmissionScanState {
  readonly settings: AtsCriteriaSettings;
  /** Latest first. Historical reports keep the criteria and evidence they were scored with. */
  readonly scans: readonly AtsScanReport[];
}

/** Latest scan of an application, for list views. */
export interface AtsScanSummary {
  readonly scanId: string;
  readonly status: 'completed' | 'needs_review';
  readonly score: number | null;
  readonly missingRequired: number;
  readonly scannedAt: string;
  readonly stale: boolean;
}

/** Required items — skills, experience, qualifications — with no evidence at all. */
export function countAtsMissingRequired(checks: readonly Pick<AtsCheck, 'category' | 'outcome'>[]): number {
  return checks.filter((check) => check.category !== 'preferred_skills' && check.outcome === 'not_found').length;
}

/** The list-view summary of a full report. */
export function atsScanSummary(report: AtsScanReport): AtsScanSummary {
  return {
    scanId: report.id,
    status: report.status,
    score: report.score,
    // An unreadable resume has no evidence either way, so nothing counts as missing.
    missingRequired: report.status === 'needs_review' ? 0 : countAtsMissingRequired(report.checks),
    scannedAt: report.createdAt,
    stale: report.stale,
  };
}

export const ATS_SCORE_BANDS = [
  { min: 80, label: 'Strong match', tone: 'strong' },
  { min: 60, label: 'Good match', tone: 'good' },
  { min: 40, label: 'Partial match', tone: 'partial' },
  { min: 0, label: 'Low match', tone: 'low' },
] as const;

export type AtsScoreTone = (typeof ATS_SCORE_BANDS)[number]['tone'];

/**
 * The label for a score. "Strong match" also needs every must-have to be
 * present: a high score with a missing requirement is shown as a good match.
 */
export function atsScoreBand(score: number, missingRequired = 0): { readonly label: string; readonly tone: AtsScoreTone } {
  const band = ATS_SCORE_BANDS.find((candidate) => score >= candidate.min) ?? ATS_SCORE_BANDS[ATS_SCORE_BANDS.length - 1]!;
  if (band.tone === 'strong' && missingRequired > 0) return ATS_SCORE_BANDS[1];
  return band;
}

/* ------------------------------------------------------------------ *
 * Fair screening rule, shared by the API and the criteria editor
 * ------------------------------------------------------------------ */

/**
 * Screening criteria must describe the work, never the person. Protected or
 * personal characteristics — and close proxies for them — are refused, so a
 * job's criteria cannot screen on who someone is. Kept narrow on purpose so
 * look-alike skills ("React Native", "race conditions", "colour theory") pass.
 */
const PROTECTED_TERMS = new RegExp(
  '\\b(?:'
    + [
      // Age
      'age', 'aged', 'age limit', 'years old', 'date of birth', 'birth\\s*date', 'dob', 'place of birth',
      // Sex, gender and orientation
      'gender', 'sex', 'male', 'female', 'boys?', 'girls?', 'women only', 'men only', 'transgender',
      'sexual orientation', 'gay', 'lesbian',
      // Race, colour, caste, descent and origin
      'racial', 'race/ethnicity', 'skin colou?r', 'complexion', 'ethnicity', 'ethnic', 'caste', 'sub-caste',
      'sc/st', 'obc', 'nationality', 'citizenship', 'national origin', 'mother tongue', 'domicile',
      // Religion and belief
      'religion', 'religious', 'hindu', 'muslim', 'christian', 'sikh', 'jain', 'buddhist', 'parsi', 'jewish',
      'political affiliation', 'political party', 'union member\\w*',
      // Family status
      'marital', 'married', 'unmarried', 'divorced', 'widow(?:ed)?', 'spouse', 'pregnan\\w*', 'maternity',
      // Health and disability
      'disabilit\\w*', 'handicap\\w*', 'medical history', 'health condition', 'genetic information',
      // Appearance
      'good looking', 'handsome', 'pleasing personality',
    ].join('|')
    + ')\\b',
  'i',
);

export const ATS_PROTECTED_CRITERION_MESSAGE =
  'Use job-related skills and qualifications only; personal or protected characteristics cannot be screening criteria.';

/** The protected wording in a criterion, or null when it is job-related. */
export function protectedCriterionTerm(value: string): string | null {
  return PROTECTED_TERMS.exec(value)?.[0] ?? null;
}
