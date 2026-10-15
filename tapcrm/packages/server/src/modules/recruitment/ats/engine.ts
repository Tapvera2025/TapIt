import {
  ATS_BASE_WEIGHTS,
  ATS_CATEGORY_LABELS,
  ATS_CATEGORY_ORDER,
  atsCategoryWeights,
  countAtsMissingRequired,
  type AtsBreakdown,
  type AtsCategory,
  type AtsCheck,
  type AtsCheckOutcome,
  type AtsCriteria,
  type AtsEvaluation,
} from '@tapcrm/contracts';
import type { ResumeTextExtraction } from '../resume-text.js';
import {
  CERTIFICATION_ALIASES,
  DEGREE_TAXONOMY,
  FIELD_SYNONYMS,
  SKILL_TAXONOMY,
  type DegreeEntry,
  type SkillEntry,
} from './taxonomy.js';
import {
  bestHit,
  buildResumeDocument,
  compileTerm,
  estimateExperience,
  findTerm,
  isAcronymForm,
  normalizeTerm,
  snippet,
  type ResumeDocument,
  type ResumeLine,
  type TermHit,
  type TermPattern,
} from './text.js';

/**
 * The ATS scoring engine.
 *
 * Deterministic and explainable by construction: the same resume text and
 * criteria always produce the same report, and every point is tied to a quoted
 * resume line. It reads only what the job asks for — skills, experience and
 * qualifications — never names, photos, age, gender, address or other personal
 * characteristics. It produces a recommendation input, not a decision.
 *
 * Bump ATS_ENGINE_VERSION whenever scoring behaviour changes — including how
 * resume text is read: reports carry the version they were made with, and
 * older reports are shown as stale. 1.1.0 reads PDFs in column order; 1.2.0
 * reads section names set in a left margin and scanned PDFs (OCR).
 */
export const ATS_ENGINE_VERSION = 'tapcrm-ats/1.2.0';

/** Relative importance before redistribution over the categories a job uses. */
export const BASE_WEIGHTS = ATS_BASE_WEIGHTS;
export const CATEGORY_LABELS = ATS_CATEGORY_LABELS;

const CATEGORY_ORDER = ATS_CATEGORY_ORDER;

/** Below this much readable text a score would describe the extractor, not the candidate. */
export const MIN_READABLE_CHARACTERS = 250;
export const MIN_READABLE_WORDS = 40;

export interface EvaluateOptions {
  /** "Present" in employment dates resolves to this date. */
  readonly asOf: Date;
}

interface ScoredCheck {
  readonly check: AtsCheck;
  /** 0..1 share of this criterion's points. */
  readonly credit: number;
}

const OUTCOME_CREDIT: Readonly<Record<AtsCheckOutcome, number>> = { matched: 1, uncertain: 0.5, not_found: 0 };

/* ------------------------------------------------------------------ *
 * Skills
 * ------------------------------------------------------------------ */

function findSkillEntry(criterion: string): SkillEntry | null {
  const key = normalizeTerm(criterion);
  return SKILL_TAXONOMY.find((entry) => entry.canonical === key)
    ?? SKILL_TAXONOMY.find((entry) => entry.aliases.includes(key) || entry.weak?.includes(key))
    ?? null;
}

function literalVariants(term: string): string[] {
  const variants = new Set([normalizeTerm(term)]);
  for (const value of [...variants]) {
    if (/[.]/.test(value) && !value.startsWith('.')) {
      variants.add(value.replace(/\./g, ''));
      variants.add(value.replace(/\./g, ' '));
    }
    if (/[/]/.test(value)) {
      variants.add(value.replace(/\//g, ' '));
      variants.add(value.replace(/\//g, ''));
    }
  }
  return [...variants].map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function compileWeak(term: string): TermPattern {
  return compileTerm(term, { acronym: isAcronymForm(term) });
}

const STOPWORDS = new Set([
  'and', 'or', 'the', 'a', 'an', 'of', 'in', 'on', 'for', 'with', 'to', 'at', 'by', 'from', 'using',
  'skills', 'skill', 'knowledge', 'experience', 'good', 'strong', 'basic', 'advanced', 'working', 'hands',
]);

function significantTokens(value: string): string[] {
  return normalizeTerm(value)
    .split(/[^\p{L}\p{N}+#.]+/u)
    .map((token) => token.replace(/^\.+|\.+$/g, ''))
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

/** "Salesforce or HubSpot": any one alternative satisfies the criterion. */
function splitAlternatives(criterion: string): string[] {
  return criterion.split(/\s+or\s+/i).map((part) => part.trim()).filter(Boolean);
}

function evaluateSkill(document: ResumeDocument, category: AtsCategory, criterion: string): ScoredCheck {
  const alternatives = splitAlternatives(criterion);
  if (alternatives.length > 1) {
    const results = alternatives.map((alternative) => ({ alternative, scored: evaluateSkill(document, category, alternative) }));
    const best = results.reduce((winner, item) => (item.scored.credit > winner.scored.credit ? item : winner));
    const found = best.scored.check.outcome !== 'not_found';
    return {
      check: {
        ...best.scored.check,
        criterion,
        note: found
          ? [`Met by "${best.alternative}"`, best.scored.check.note].filter(Boolean).join('; ')
          : null,
      },
      credit: best.scored.credit,
    };
  }

  const entry = findSkillEntry(criterion);
  // A one-letter name ("C", "R") is ambiguous even as the standard name.
  const strongTerms = entry
    ? [entry.canonical, ...entry.aliases].filter((term) => !entry.weak?.includes(term))
    : literalVariants(criterion);
  const weakTerms = entry?.weak ?? [];
  const typed = normalizeTerm(criterion);

  const strongHits: TermHit[] = [];
  for (const term of new Set(strongTerms)) strongHits.push(...findTerm(document, compileTerm(term)));
  const strong = bestHit(strongHits);
  if (strong) {
    const via = strong.term !== typed && strong.term !== normalizeTerm(entry?.canonical ?? typed)
      ? `Matched as "${strong.line.text.slice(strong.start, strong.end)}"`
      : null;
    return {
      check: { category, criterion, outcome: 'matched', evidence: snippet(strong.line.text, strong.start, strong.end), note: via },
      credit: 1,
    };
  }

  const weakHits: TermHit[] = [];
  for (const term of weakTerms) weakHits.push(...findTerm(document, compileWeak(term)));
  const weak = bestHit(weakHits);
  if (weak) {
    return {
      check: {
        category,
        criterion,
        outcome: 'uncertain',
        evidence: snippet(weak.line.text, weak.start, weak.end),
        note: `"${weak.line.text.slice(weak.start, weak.end)}" is ambiguous on its own — confirm in the resume`,
      },
      credit: OUTCOME_CREDIT.uncertain,
    };
  }

  // Unknown multi-word criteria: all of their words on one line is weaker evidence.
  if (!entry) {
    const tokens = significantTokens(criterion);
    if (tokens.length >= 2) {
      // Singular and plural forms count alike ("payment" / "payments").
      const patterns = tokens.map((token) => {
        const stem = token.length > 4 ? token.replace(/(?:es|s)$/, '') : token;
        return new RegExp(`(?<![\\p{L}\\p{N}])${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es)?(?![\\p{L}\\p{N}])`, 'iu');
      });
      const line = document.lines.find((candidate) => !candidate.heading
        && patterns.every((pattern) => pattern.test(candidate.text)));
      if (line) {
        return {
          check: { category, criterion, outcome: 'uncertain', evidence: snippet(line.text), note: 'The words appear together, but not as this exact phrase' },
          credit: OUTCOME_CREDIT.uncertain,
        };
      }
    }
  }

  return { check: { category, criterion, outcome: 'not_found', evidence: null, note: null }, credit: 0 };
}

/* ------------------------------------------------------------------ *
 * Experience
 * ------------------------------------------------------------------ */

function formatYears(years: number): string {
  const rounded = Math.round(years * 10) / 10;
  return `${rounded} ${rounded === 1 ? 'year' : 'years'}`;
}

function monthLabel(index: number): string {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[index % 12]} ${Math.floor(index / 12)}`;
}

function evaluateExperience(
  document: ResumeDocument,
  required: number,
  asOf: Date,
  warnings: string[],
): { scored: ScoredCheck; years: number | null } {
  const estimate = estimateExperience(document, asOf);
  const criterion = `At least ${formatYears(required)} of experience`;
  const internships = estimate.internshipMonths > 0
    ? `${estimate.internshipMonths} month${estimate.internshipMonths === 1 ? '' : 's'} of internships not counted`
    : null;

  if (estimate.datedYears !== null) {
    const years = estimate.datedYears;
    const parts = [
      `≈${formatYears(years)} across ${estimate.roles} dated role${estimate.roles === 1 ? '' : 's'}`
        + (estimate.firstStart !== null ? ` since ${monthLabel(estimate.firstStart)}` : ''),
      estimate.approximate ? 'some dates give only the year' : null,
      internships,
      estimate.statedYears !== null && estimate.statedYears > years + 0.5
        ? `resume states ${formatYears(estimate.statedYears)}` : null,
    ].filter(Boolean);
    return {
      years,
      scored: {
        check: {
          category: 'experience',
          criterion,
          outcome: years >= required ? 'matched' : 'not_found',
          evidence: estimate.datedEvidence,
          note: parts.join('; '),
        },
        credit: Math.min(1, years / required),
      },
    };
  }

  if (estimate.statedYears !== null) {
    const years = estimate.statedYears;
    return {
      years,
      scored: {
        check: {
          category: 'experience',
          criterion,
          outcome: 'uncertain',
          evidence: estimate.statedEvidence,
          note: `Resume states ${formatYears(years)}, but has no employment dates to confirm it`,
        },
        credit: Math.min(1, years / required),
      },
    };
  }

  if (estimate.internshipMonths > 0) {
    return {
      years: 0,
      scored: {
        check: {
          category: 'experience',
          criterion,
          outcome: 'not_found',
          evidence: null,
          note: `Only internships found (${estimate.internshipMonths} month${estimate.internshipMonths === 1 ? '' : 's'}), which are not counted`,
        },
        credit: 0,
      },
    };
  }

  warnings.push('No employment dates or stated years of experience were found, so experience could not be measured.');
  return {
    years: null,
    scored: {
      check: { category: 'experience', criterion, outcome: 'not_found', evidence: null, note: 'No employment dates found' },
      credit: 0,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Qualifications
 * ------------------------------------------------------------------ */

const IN_PROGRESS = /\b(pursuing|expected|ongoing|currently\s+(?:studying|enrolled|pursuing)|appearing|final\s+year|in\s+progress|persuing)\b/i;

function degreePatterns(degree: DegreeEntry): { strong: TermPattern[]; weak: TermPattern[] } {
  return {
    strong: degree.aliases.map((alias) => compileTerm(alias)),
    weak: (degree.weak ?? []).map((alias) => compileWeak(alias)),
  };
}

const DEGREE_PATTERNS = new Map(DEGREE_TAXONOMY.map((degree) => [degree.id, degreePatterns(degree)]));

/** Words that name "a degree" only when nothing more specific is named. */
const FALLBACK_DEGREE_WORDS = new Set(['degree', 'graduate degree']);

function degreesNamedIn(text: string): { degrees: DegreeEntry[]; remainder: string } {
  let remainder = text;
  const degrees: DegreeEntry[] = [];
  for (const degree of DEGREE_TAXONOMY) {
    const patterns = DEGREE_PATTERNS.get(degree.id)!;
    let found = false;
    for (const pattern of [...patterns.strong, ...patterns.weak]) {
      if (FALLBACK_DEGREE_WORDS.has(pattern.term)) continue;
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(remainder)) {
        found = true;
        pattern.regex.lastIndex = 0;
        remainder = remainder.replace(pattern.regex, ' ');
      }
    }
    if (found) degrees.push(degree);
  }
  if (degrees.length === 0) {
    const generic = DEGREE_TAXONOMY.find((degree) => degree.id === 'bachelor')!;
    for (const word of FALLBACK_DEGREE_WORDS) {
      const pattern = compileTerm(word);
      if (pattern.regex.test(remainder)) {
        degrees.push(generic);
        remainder = remainder.replace(new RegExp(pattern.regex.source, 'giu'), ' ');
        break;
      }
    }
  }
  return { degrees, remainder };
}

const FIELD_STOPWORDS = new Set([
  'in', 'of', 'or', 'and', 'any', 'with', 'from', 'a', 'an', 'the', 'relevant', 'related', 'field', 'fields',
  'stream', 'streams', 'degree', 'degrees', 'equivalent', 'preferred', 'required', 'mandatory', 'similar',
  'discipline', 'disciplines', 'background', 'recognised', 'recognized', 'university', 'full', 'time', 'regular',
]);

function fieldTermsFor(remainder: string): string[] {
  const lower = normalizeTerm(remainder);
  const terms: string[] = [];
  for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS)) {
    const named = synonyms.some((synonym) => {
      const pattern = compileTerm(synonym, { acronym: isAcronymForm(synonym) });
      pattern.regex.lastIndex = 0;
      return pattern.regex.test(remainder) || (synonym.length > 3 && lower.includes(synonym));
    });
    if (named) terms.push(...synonyms, field);
  }
  if (terms.length > 0) return [...new Set(terms)];
  // An unfamiliar field ("Biotechnology"): use its own words.
  return lower.split(/[^\p{L}\p{N}&]+/u).filter((word) => word.length >= 4 && !FIELD_STOPWORDS.has(word));
}

function mentionsDegree(line: ResumeLine): boolean {
  for (const patterns of DEGREE_PATTERNS.values()) {
    for (const pattern of patterns.strong) {
      if (FALLBACK_DEGREE_WORDS.has(pattern.term)) continue;
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(line.text)) return true;
    }
  }
  return false;
}

/**
 * The degree's own entry: its line plus up to two following lines (a table
 * cell, the institution, the years) until the next degree or heading starts.
 */
function degreeEntryText(document: ResumeDocument, line: ResumeLine): string {
  const parts = [line.text];
  for (let index = line.index + 1; index <= line.index + 2; index += 1) {
    const next = document.lines[index];
    if (!next || next.heading || next.section !== line.section || mentionsDegree(next)) break;
    parts.push(next.text);
  }
  return parts.join('\n');
}

function satisfies(found: DegreeEntry, wanted: DegreeEntry): boolean {
  if (wanted.generic) return found.level >= wanted.level;
  if (found.id === wanted.id) return true;
  return found.family === wanted.family && found.level > wanted.level;
}

function evaluateQualification(document: ResumeDocument, criterion: string, asOf: Date): ScoredCheck {
  const key = normalizeTerm(criterion);
  const { degrees: wanted, remainder } = degreesNamedIn(criterion);

  if (wanted.length === 0) {
    // Professional certifications known by more than one name (PMP, CFA, …).
    const certification = Object.entries(CERTIFICATION_ALIASES)
      .find(([name, aliases]) => key === name || aliases.includes(key));
    if (certification) {
      const hit = bestHit(certification[1].flatMap((alias) => findTerm(document, compileTerm(alias))));
      return hit
        ? {
            check: {
              category: 'qualifications', criterion, outcome: 'matched',
              evidence: snippet(hit.line.text, hit.start, hit.end),
              note: normalizeTerm(hit.line.text.slice(hit.start, hit.end)) === key ? null : `Matched as "${hit.line.text.slice(hit.start, hit.end)}"`,
            },
            credit: 1,
          }
        : { check: { category: 'qualifications', criterion, outcome: 'not_found', evidence: null, note: null }, credit: 0 };
    }
    // Anything else (a licence, a language test…) is matched as a phrase.
    return evaluateSkill(document, 'qualifications', criterion);
  }

  const fieldTerms = fieldTermsFor(remainder);
  // With an Education section, degrees are read only there: "Scrum Master" in a
  // certification list or "hired MBA graduates" in a job are not degrees.
  const educationOnly = document.sections.has('education');
  type Candidate = { hit: TermHit; degree: DegreeEntry; weak: boolean };
  const candidates: Candidate[] = [];
  for (const degree of DEGREE_TAXONOMY) {
    if (!wanted.some((target) => satisfies(degree, target))) continue;
    const patterns = DEGREE_PATTERNS.get(degree.id)!;
    for (const [list, weak] of [[patterns.strong, false], [patterns.weak, true]] as const) {
      for (const pattern of list) {
        for (const hit of findTerm(document, pattern)) {
          if (hit.line.heading) continue;
          if (educationOnly ? hit.line.section !== 'education' : hit.line.section === 'experience') continue;
          candidates.push({ hit, degree, weak });
        }
      }
    }
  }

  if (candidates.length === 0) {
    return { check: { category: 'qualifications', criterion, outcome: 'not_found', evidence: null, note: null }, credit: 0 };
  }

  let best: ScoredCheck | null = null;
  for (const candidate of candidates) {
    const entry = degreeEntryText(document, candidate.hit.line);
    const notes: string[] = [];
    let outcome: AtsCheckOutcome = 'matched';
    const shown = candidate.hit.line.text.slice(candidate.hit.start, candidate.hit.end);

    if (candidate.weak) {
      outcome = 'uncertain';
      notes.push(`"${shown}" is an abbreviation — confirm the degree`);
    }
    if (!candidate.degree.generic && !wanted.some((target) => target.id === candidate.degree.id)) {
      notes.push(`${candidate.degree.label} meets this requirement`);
    }
    if (fieldTerms.length > 0) {
      const fieldFound = fieldTerms.some((term) => {
        const pattern = compileTerm(term, { acronym: isAcronymForm(term) });
        pattern.regex.lastIndex = 0;
        return pattern.regex.test(entry);
      });
      if (!fieldFound) {
        outcome = 'uncertain';
        notes.push('Degree found, but the field of study is not confirmed');
      }
    }
    const futureYear = [...entry.matchAll(/\b(20\d{2})\b/g)].some((match) => Number(match[1]) > asOf.getUTCFullYear());
    if (IN_PROGRESS.test(entry) || futureYear) {
      outcome = 'uncertain';
      notes.push('Appears to be in progress');
    }

    const scored: ScoredCheck = {
      check: {
        category: 'qualifications',
        criterion,
        outcome,
        evidence: snippet(candidate.hit.line.text, candidate.hit.start, candidate.hit.end),
        note: notes.length > 0 ? notes.join('; ') : null,
      },
      credit: OUTCOME_CREDIT[outcome],
    };
    if (!best || scored.credit > best.credit) best = scored;
    if (best.credit === 1) break;
  }
  return best!;
}

/* ------------------------------------------------------------------ *
 * Weights and score
 * ------------------------------------------------------------------ */

/** Largest-remainder rounding, so the integer weights always sum to exactly 100. */
export function redistributeWeights(categories: readonly AtsCategory[]): Map<AtsCategory, number> {
  return atsCategoryWeights(categories);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function evaluateResume(
  extraction: ResumeTextExtraction,
  criteria: AtsCriteria,
  options: EvaluateOptions,
): AtsEvaluation {
  const document = buildResumeDocument(extraction.text);
  const warnings: string[] = [...extraction.issues];
  const byCategory = new Map<AtsCategory, ScoredCheck[]>();
  let extractedExperienceYears: number | null = null;

  const add = (category: AtsCategory, scored: ScoredCheck) => {
    const list = byCategory.get(category) ?? [];
    list.push(scored);
    byCategory.set(category, list);
  };

  for (const skill of criteria.requiredSkills) add('required_skills', evaluateSkill(document, 'required_skills', skill));
  const minimum = criteria.minimumExperienceYears ?? 0;
  if (minimum > 0) {
    const experience = evaluateExperience(document, minimum, options.asOf, warnings);
    extractedExperienceYears = experience.years;
    add('experience', experience.scored);
  } else {
    const estimate = estimateExperience(document, options.asOf);
    extractedExperienceYears = estimate.datedYears ?? estimate.statedYears;
  }
  for (const qualification of criteria.requiredQualifications) {
    add('qualifications', evaluateQualification(document, qualification, options.asOf));
  }
  for (const skill of criteria.preferredSkills) add('preferred_skills', evaluateSkill(document, 'preferred_skills', skill));

  const configured = CATEGORY_ORDER.filter((category) => (byCategory.get(category)?.length ?? 0) > 0);
  const weights = redistributeWeights(configured);
  const breakdown: AtsBreakdown[] = [];
  let total = 0;
  for (const category of configured) {
    const scored = byCategory.get(category)!;
    const weight = weights.get(category) ?? 0;
    const credit = scored.reduce((sum, item) => sum + item.credit, 0) / scored.length;
    const points = weight * credit;
    total += points;
    breakdown.push({
      category,
      label: CATEGORY_LABELS[category],
      weight,
      matchedCount: scored.filter((item) => item.check.outcome === 'matched').length,
      uncertainCount: scored.filter((item) => item.check.outcome === 'uncertain').length,
      criteriaCount: scored.length,
      points: round1(points),
    });
  }

  if (document.lines.length > 0 && document.sections.size === 0) {
    warnings.push('No standard section headings (Experience, Education, Skills) were recognised, so dates and qualifications may have been missed.');
  }

  const readable = document.characters >= MIN_READABLE_CHARACTERS && document.words >= MIN_READABLE_WORDS;
  const finalWarnings = readable
    ? warnings
    : [
        document.characters === 0
          ? 'No text could be read from this resume, so it cannot be scored. Review the resume manually.'
          : `Only ${document.characters} characters of text could be read from this resume, which is too little for a reliable score. Review the resume manually.`,
        ...extraction.issues,
      ];

  return {
    status: readable && configured.length > 0 ? 'completed' : 'needs_review',
    score: readable && configured.length > 0 ? Math.max(0, Math.min(100, Math.round(total))) : null,
    checks: CATEGORY_ORDER.flatMap((category) => (byCategory.get(category) ?? []).map((item) => item.check)),
    breakdown,
    warnings: [...new Set(finalWarnings)],
    extractedExperienceYears,
    extraction: {
      format: extraction.format,
      characters: document.characters,
      pageCount: extraction.pageCount,
      sections: [...document.sections].filter((section) => section !== 'other' && section !== 'header').sort(),
      ...(extraction.ocr ? { ocrPages: extraction.ocr.pages } : {}),
    },
  };
}

/** Required items (skills, experience, qualifications) with no evidence at all. */
export function countMissingRequired(evaluation: Pick<AtsEvaluation, 'checks'>): number {
  return countAtsMissingRequired(evaluation.checks);
}
