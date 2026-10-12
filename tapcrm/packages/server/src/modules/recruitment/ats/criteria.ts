import { createHash } from 'node:crypto';
import type { AtsCriteria } from '@tapcrm/contracts';
import { DEGREE_TAXONOMY, FIELD_SYNONYMS, SKILL_TAXONOMY, type SkillEntry } from './taxonomy.js';
import { compileTerm, normalizeTerm } from './text.js';

export const MAX_CRITERIA_PER_LIST = 30;

function cleanList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const key = normalizeTerm(cleaned);
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out.slice(0, MAX_CRITERIA_PER_LIST);
}

/** Trims, de-duplicates (case-insensitively) and bounds HR's criteria. */
export function normalizeCriteria(input: AtsCriteria): AtsCriteria {
  const requiredSkills = cleanList(input.requiredSkills);
  const required = new Set(requiredSkills.map(normalizeTerm));
  const years = input.minimumExperienceYears;
  return {
    requiredSkills,
    preferredSkills: cleanList(input.preferredSkills).filter((skill) => !required.has(normalizeTerm(skill))),
    minimumExperienceYears: years === null || !Number.isFinite(years) || years <= 0
      ? null
      : Math.min(50, Math.round(years * 2) / 2),
    requiredQualifications: cleanList(input.requiredQualifications),
  };
}

export function hasScreeningRequirement(criteria: AtsCriteria): boolean {
  return criteria.requiredSkills.length > 0
    || criteria.requiredQualifications.length > 0
    || (criteria.minimumExperienceYears ?? 0) > 0;
}

/**
 * Identity of a criteria set for reproducibility: order and letter case do not
 * change a scan's outcome, so they do not change the hash either.
 */
export function criteriaHash(criteria: AtsCriteria): string {
  const canonical = {
    requiredSkills: criteria.requiredSkills.map(normalizeTerm).sort(),
    preferredSkills: criteria.preferredSkills.map(normalizeTerm).sort(),
    minimumExperienceYears: criteria.minimumExperienceYears,
    requiredQualifications: criteria.requiredQualifications.map(normalizeTerm).sort(),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/* ------------------------------------------------------------------ *
 * Suggestions from the job post
 * ------------------------------------------------------------------ */

export interface JobPostText {
  readonly title: string;
  readonly description: string | null;
  readonly requirements: string | null;
}

const OPTIONAL_MARKER = /\b(preferred|nice[\s-]to[\s-]have|good[\s-]to[\s-]have|bonus|a plus|is a plus|added advantage|desirable|optional)\b/i;
/** In the requirements, "2+ years in B2B sales" states experience even without the word. */
const REQUIREMENT_YEARS = /(?:minimum\s+(?:of\s+)?)?(\d{1,2}(?:\.\d)?)\s*(?:\+|-\s*\d{1,2}|to\s*\d{1,2})?\s*(?:years?|yrs?)\b(?!\s*(?:old|of\s+age|ago))/i;
const EXPERIENCE_MARKER = /(\d{1,2}(?:\.\d)?)\s*(?:\+|-\s*\d{1,2}|to\s*\d{1,2})?\s*(?:years?|yrs?)'?\s*(?:of\s+)?(?:[a-z/&.+#-]+\s+){0,4}?(?:experience|exp\b)/i;

function firstMention(text: string, terms: readonly string[]): string | null {
  // Earliest-listed term wins; callers order terms from most to least specific.
  for (const term of terms) {
    const pattern = compileTerm(term);
    pattern.regex.lastIndex = 0;
    const match = pattern.regex.exec(text);
    if (match) return match[0];
  }
  return null;
}

/**
 * A starting point for HR, never applied silently: skills from the job post's
 * vocabulary (lines marked "preferred"/"nice to have" become preferred), the
 * smallest "N years" figure, and any degree named with its field.
 */
interface PostLine {
  readonly text: string;
  readonly fromRequirements: boolean;
}

interface SkillMention {
  readonly entry: SkillEntry;
  readonly lineIndex: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Every place a vocabulary skill is named, one per skill per line (longest, earliest wording). */
function skillMentions(lines: readonly PostLine[]): SkillMention[] {
  const found: SkillMention[] = [];
  for (const entry of SKILL_TAXONOMY) {
    const terms = [entry.canonical, ...entry.aliases].filter((term) => !entry.weak?.includes(term));
    lines.forEach((line, lineIndex) => {
      let best: SkillMention | null = null;
      for (const term of terms) {
        const pattern = compileTerm(term);
        pattern.regex.lastIndex = 0;
        const match = pattern.regex.exec(line.text);
        if (!match) continue;
        const candidate = { entry, lineIndex, start: match.index, end: match.index + match[0].length, text: match[0] };
        const covers = best && candidate.start <= best.start && candidate.end >= best.end;
        if (!best || candidate.start < best.start || covers) best = candidate;
      }
      if (best) found.push(best);
    });
  }
  return found.sort((a, b) => a.lineIndex - b.lineIndex || a.start - b.start);
}

/**
 * A starting point for HR, never applied silently: skills from the job post's
 * vocabulary in the order the post names them ("A or B" kept together, lines
 * marked "preferred" / "nice to have" become preferred), the smallest "N years",
 * and the first degree named with its field.
 */
export function suggestCriteria(job: JobPostText): AtsCriteria {
  const split = (text: string | null, fromRequirements: boolean): PostLine[] => (text ?? '')
    .split(/\n|(?<=[.;•])\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ text: line, fromRequirements }));
  const lines = [...split(job.title, false), ...split(job.description, false), ...split(job.requirements, true)];
  const mentions = skillMentions(lines);

  // "B2B sales or inside sales": alternatives named together form one requirement.
  const groupOf = new Map<string, string[]>();
  for (let index = 0; index + 1 < mentions.length; index += 1) {
    const current = mentions[index]!;
    const next = mentions[index + 1]!;
    if (current.lineIndex !== next.lineIndex) continue;
    if (!/^\s*(?:or|\/)\s*$/i.test(lines[current.lineIndex]!.text.slice(current.end, next.start))) continue;
    const group = groupOf.get(current.entry.canonical) ?? [current.entry.canonical];
    if (!group.includes(next.entry.canonical)) group.push(next.entry.canonical);
    for (const member of group) groupOf.set(member, group);
  }

  // Display: the standard name when the post uses it, otherwise its own wording.
  const display = new Map<string, string>();
  const optional = new Map<string, boolean>();
  for (const mention of mentions) {
    const key = mention.entry.canonical;
    const standard = normalizeTerm(mention.text) === key;
    if (!display.has(key) || standard) display.set(key, mention.text);
    if (!optional.has(key)) optional.set(key, OPTIONAL_MARKER.test(lines[mention.lineIndex]!.text));
  }

  const required: string[] = [];
  const preferred: string[] = [];
  const emitted = new Set<string>();
  for (const mention of mentions) {
    const key = mention.entry.canonical;
    if (emitted.has(key)) continue;
    // "CRM (Salesforce or HubSpot)": examples of a skill already asked for add nothing.
    if ([...emitted].some((chosen) => SKILL_TAXONOMY.find((entry) => entry.canonical === chosen)?.aliases.includes(key))) {
      emitted.add(key);
      continue;
    }
    const group = (groupOf.get(key) ?? [key]).filter((member) => !emitted.has(member));
    for (const member of group) emitted.add(member);
    const text = group.map((member) => display.get(member) ?? member).join(' or ');
    (optional.get(key) ? preferred : required).push(text);
  }

  let minimumExperienceYears: number | null = null;
  for (const line of lines) {
    const match = (line.fromRequirements ? REQUIREMENT_YEARS : EXPERIENCE_MARKER).exec(line.text);
    const years = match ? Number(match[1]) : NaN;
    if (Number.isFinite(years) && years > 0 && years <= 30) {
      minimumExperienceYears = minimumExperienceYears === null ? years : Math.min(minimumExperienceYears, years);
    }
  }

  // The first degree the post names is the requirement; later ones are usually alternatives.
  const qualifications: string[] = [];
  let degree: { lineIndex: number; start: number; text: string } | null = null;
  for (const [lineIndex, line] of lines.entries()) {
    if (OPTIONAL_MARKER.test(line.text)) continue;
    for (const entry of DEGREE_TAXONOMY) {
      if (entry.level < 2) continue;
      const aliases = entry.aliases
        .filter((alias) => (alias.length > 3 || alias.includes('.')) && alias !== 'degree' && alias !== 'graduate degree')
        .sort((a, b) => b.length - a.length);
      for (const alias of aliases) {
        const pattern = compileTerm(alias);
        pattern.regex.lastIndex = 0;
        const match = pattern.regex.exec(line.text);
        if (!match) continue;
        const earlier = degree === null || lineIndex < degree.lineIndex
          || (lineIndex === degree.lineIndex && (match.index < degree.start || (match.index === degree.start && match[0].length > degree.text.length)));
        if (earlier) {
          const withDegree = /^\s+degree\b/i.test(line.text.slice(match.index + match[0].length)) ? match[0] + ' degree' : match[0];
          degree = { lineIndex, start: match.index, text: withDegree };
        }
        break;
      }
    }
  }
  if (degree !== null) {
    const degreeLine = lines[degree.lineIndex]!.text;
    const field = Object.entries(FIELD_SYNONYMS).find(([, synonyms]) =>
      firstMention(degreeLine, synonyms.filter((synonym) => synonym.length > 3)) !== null)?.[0];
    qualifications.push(field ? degree.text + ' in ' + titleCase(field) : degree.text);
  }

  return normalizeCriteria({
    requiredSkills: required.slice(0, 12),
    preferredSkills: preferred.slice(0, 8),
    minimumExperienceYears,
    requiredQualifications: qualifications,
  });
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
