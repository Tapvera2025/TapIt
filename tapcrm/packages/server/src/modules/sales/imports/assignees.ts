/**
 * Matching the "Assigned to" column to employees. Pure: no I/O.
 *
 * People write a colleague's name the way they say it — "Rahul", "rahul v",
 * "Rahul Verma", "rahul.verma@company.com". A value is matched only when it
 * points at exactly one person; anything vaguer is left for the person
 * importing to choose.
 */

export interface AssigneeCandidate {
  readonly id: string;
  readonly fullName: string;
  readonly email: string | null;
}

/** The key a value is stored and looked up under: case, spacing and punctuation folded. */
export function assigneeKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@.+_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(value: string): string[] {
  return assigneeKey(value)
    .replace(/[@.+_-]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

/**
 * The employee a value names, or null when none or several fit. In order:
 * email, email name ("rahul.verma"), full name, a unique first name, then
 * initials or prefixes that fit one person ("Rahul V", "R Verma").
 */
export function matchAssignee<T extends AssigneeCandidate>(value: string, candidates: readonly T[]): T | null {
  const key = assigneeKey(value);
  if (!key) return null;

  const unique = (matches: readonly T[]): T | null => (matches.length === 1 ? matches[0]! : null);

  if (key.includes('@')) return unique(candidates.filter((candidate) => candidate.email !== null && candidate.email.toLowerCase() === key));

  const byFullName = unique(candidates.filter((candidate) => assigneeKey(candidate.fullName) === key));
  if (byFullName) return byFullName;

  const byEmailName = unique(
    candidates.filter((candidate) => candidate.email !== null && candidate.email.toLowerCase().split('@')[0] === key.replace(/\s+/g, '.')),
  );
  if (byEmailName) return byEmailName;

  const tokens = nameTokens(value);
  if (tokens.length === 0) return null;

  if (tokens.length === 1) {
    const [only] = tokens;
    return unique(candidates.filter((candidate) => nameTokens(candidate.fullName)[0] === only));
  }

  // Every word of the value starts a different word of the name, in order.
  return unique(
    candidates.filter((candidate) => {
      const name = nameTokens(candidate.fullName);
      let position = 0;
      for (const token of tokens) {
        while (position < name.length && !name[position]!.startsWith(token)) position++;
        if (position >= name.length) return false;
        position++;
      }
      return true;
    }),
  );
}
