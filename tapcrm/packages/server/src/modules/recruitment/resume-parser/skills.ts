import { compileTerm, findTerm, isAcronymForm, normalizeTerm, type ResumeDocument, type ResumeLine } from '../ats/text.js';
import { SKILL_TAXONOMY } from '../ats/taxonomy.js';
import { isBullet, isProse } from './entries.js';

/**
 * Skills: what the resume's skills section lists, as the candidate wrote it,
 * then known skills (from the screening vocabulary) that the resume describes
 * using elsewhere — in its summary, project and job descriptions. Company
 * names and job titles are not mentions ("Zoho Corporation" is not the Zoho
 * CRM skill), and a broader term is never inferred from a narrower one
 * ("MongoDB" does not add "NoSQL").
 */

const MAX_SKILLS = 40;

/** How known skills are written. Anything not listed is title-cased, and three letters or fewer are capitals. */
const DISPLAY: Readonly<Record<string, string>> = {
  javascript: 'JavaScript', typescript: 'TypeScript', 'objective-c': 'Objective-C', golang: 'Go', 'c++': 'C++',
  'c#': 'C#', c: 'C', r: 'R', 'react native': 'React Native', vue: 'Vue.js', 'next.js': 'Next.js', jquery: 'jQuery',
  ios: 'iOS', 'node.js': 'Node.js', 'express.js': 'Express.js', nestjs: 'NestJS', fastapi: 'FastAPI', '.net': '.NET',
  'ruby on rails': 'Ruby on Rails', graphql: 'GraphQL', 'rest api': 'REST APIs', grpc: 'gRPC', postgresql: 'PostgreSQL',
  mysql: 'MySQL', mongodb: 'MongoDB', dynamodb: 'DynamoDB', 'sql server': 'SQL Server', rabbitmq: 'RabbitMQ',
  nosql: 'NoSQL', 'github actions': 'GitHub Actions', 'ci/cd': 'CI/CD', devops: 'DevOps', git: 'Git',
  'tailwind css': 'Tailwind CSS', 'scikit-learn': 'scikit-learn', tensorflow: 'TensorFlow', pytorch: 'PyTorch',
  numpy: 'NumPy', pandas: 'pandas', 'power bi': 'Power BI', 'adobe xd': 'Adobe XD', 'ui/ux': 'UI/UX',
  hubspot: 'HubSpot', 'b2b sales': 'B2B Sales', 'generative ai': 'Generative AI', hrms: 'HRMS', 'google ads': 'Google Ads',
};

/** Ordinary words that are also skill names: a mention counts only when capitalised ("React", not "react to"). */
const PLAIN_WORDS = new Set([
  'excel', 'spring', 'swift', 'rust', 'ruby', 'dart', 'flask', 'react', 'express.js', 'angular', 'golang', 'git',
  'payroll', 'recruitment', 'onboarding', 'accounting', 'taxation', 'agile', 'scrum', 'communication', 'leadership',
]);
/** Soft skills and spoken languages are listed only when the resume itself lists them. */
const LISTED_ONLY = new Set(['communication', 'leadership', 'teamwork', 'problem solving', 'english', 'hindi', 'negotiation']);

export function displaySkill(canonical: string): string {
  const known = DISPLAY[canonical];
  if (known) return known;
  if (canonical.length <= 3) return canonical.toUpperCase();
  return canonical.replace(/(^|[\s/-])(\p{L})/gu, (_, separator: string, letter: string) => separator + letter.toUpperCase());
}

interface TaxonomyMatcher {
  readonly canonical: string;
  readonly patterns: readonly ReturnType<typeof compileTerm>[];
}

let matchers: TaxonomyMatcher[] | null = null;

/**
 * Each skill's own names: the canonical name and true synonyms. Aliases that
 * are another skill's name ("mongodb" under NoSQL) or a fragment of this one's
 * ("b2b" under B2B Sales) are left to the screening engine.
 */
function taxonomyMatchers(): TaxonomyMatcher[] {
  if (matchers) return matchers;
  const canonicals = new Set(SKILL_TAXONOMY.map((entry) => normalizeTerm(entry.canonical)));
  matchers = SKILL_TAXONOMY.map((entry) => {
    const canonical = normalizeTerm(entry.canonical);
    const weak = new Set((entry.weak ?? []).map(normalizeTerm));
    const canonicalWords = new Set(canonical.split(/[\s/-]+/));
    const own = [canonical, ...entry.aliases.map(normalizeTerm)].filter((term) => {
      if (weak.has(term)) return false;
      if (term === canonical) return true;
      if (canonicals.has(term)) return false;
      const words = term.split(/[\s/-]+/);
      return !(words.length < canonicalWords.size && words.every((word) => canonicalWords.has(word)));
    });
    return {
      canonical: entry.canonical,
      patterns: own.map((term) => compileTerm(term, { acronym: isAcronymForm(term) })),
    };
  });
  return matchers;
}

/** "Languages: Java, Python" → ["Java", "Python"]; sentences and fragments are dropped. */
function listedItems(text: string): string[] {
  const body = text.replace(/^[-*>]\s+/, '').replace(/^[A-Za-z][A-Za-z &/]{1,30}:\s*/, '');
  return body
    .split(/[,;|•·\t]|\s\/\s|\s-\s(?=\p{Lu})/u)
    .map((item) => item.replace(/^[-*\s]+|[\s.]+$/g, '').replace(/\s+/g, ' ').trim())
    .filter((item) => item.length >= 1 && item.length <= 40 && item.split(' ').length <= 5 && /\p{L}/u.test(item)
      && !/^(?:and|or|etc|others?)$/i.test(item));
}

/** Where a mention means the candidate used the skill: descriptions, not titles or company names. */
function describesWork(line: ResumeLine): boolean {
  if (line.heading) return false;
  switch (line.section) {
    case 'summary':
    case 'certifications':
    case 'projects':
      return true;
    case 'experience':
      return isBullet(line.text) || isProse(line.text);
    default:
      return false;
  }
}

function mentions(pattern: ReturnType<typeof compileTerm>, item: string): boolean {
  pattern.regex.lastIndex = 0;
  return pattern.regex.test(item);
}

export function extractSkills(document: ResumeDocument): string[] {
  const out: string[] = [];
  /** Display names already listed, lower-cased. */
  const seen = new Set<string>();
  /** Taxonomy skills already represented by a listed item. */
  const known = new Set<string>();
  const add = (value: string) => {
    const key = value.toLowerCase();
    if (seen.has(key) || out.length >= MAX_SKILLS) return;
    seen.add(key);
    out.push(value);
  };

  // Listed skills keep the candidate's wording ("SAP FICO", "ReactJS"); the
  // known skills they contain are noted so they are not added again.
  for (const line of document.lines) {
    if (line.section !== 'skills' || line.heading) continue;
    for (const item of listedItems(line.text)) {
      for (const matcher of taxonomyMatchers()) {
        if (matcher.patterns.some((pattern) => mentions(pattern, item))) known.add(matcher.canonical);
      }
      add(item.length <= 3 && item === item.toLowerCase() ? item.toUpperCase() : item);
    }
  }

  for (const matcher of taxonomyMatchers()) {
    if (known.has(matcher.canonical) || LISTED_ONLY.has(matcher.canonical)) continue;
    const found = matcher.patterns.some((pattern) => findTerm(document, pattern).some((hit) => {
      if (!describesWork(hit.line)) return false;
      return !PLAIN_WORDS.has(matcher.canonical) || /\p{Lu}/u.test(hit.line.text.slice(hit.start, hit.end));
    }));
    if (found) add(displaySkill(matcher.canonical));
  }
  return out;
}
