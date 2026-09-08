/**
 * SQL fragments as the authorization engine sees them.
 *
 * TECH.md §6.6: "SqlFragment is a server-only type produced by the DAL/query
 * layer. It is never exported to the browser." The shape below is deliberately
 * the compiled-query shape (text + positional parameters) so that a fragment
 * can never carry an interpolated value — user input reaches the database as a
 * parameter or not at all (T-7, CI-20).
 */

export interface SqlFragment {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

/**
 * AZ-I2 / CI-23 — the deny representation.
 *
 * "`MATCH_NOTHING` must compile to a predicate that is provably false, such as
 *  `FALSE`. NEVER use an empty filter as the deny representation. In SQL, an
 *  omitted WHERE clause means 'match everything', which is the most dangerous
 *  possible failure mode."
 *
 * Frozen so no caller can mutate the one object every denial returns.
 */
export const MATCH_NOTHING: SqlFragment = Object.freeze({
  sql: 'FALSE',
  parameters: Object.freeze([]),
});

export const MATCH_ALL: SqlFragment = Object.freeze({
  sql: 'TRUE',
  parameters: Object.freeze([]),
});

export function isMatchNothing(fragment: SqlFragment): boolean {
  return fragment.sql.trim().toUpperCase() === 'FALSE';
}

/** Combine fragments with AND. An empty list yields MATCH_NOTHING, never MATCH_ALL. */
export function and(...fragments: readonly SqlFragment[]): SqlFragment {
  const parts = fragments.filter((f) => f.sql.trim().toUpperCase() !== 'TRUE');
  if (parts.length === 0) return fragments.length === 0 ? MATCH_NOTHING : MATCH_ALL;
  if (parts.some(isMatchNothing)) return MATCH_NOTHING;

  let text = '';
  const parameters: unknown[] = [];
  parts.forEach((part, index) => {
    // Renumber positional placeholders so combined fragments stay valid.
    const renumbered = part.sql.replace(/\$(\d+)/g, (_m, n: string) =>
      `$${parameters.length + Number(n)}`,
    );
    text += index === 0 ? `(${renumbered})` : ` AND (${renumbered})`;
    parameters.push(...part.parameters);
  });
  return { sql: text, parameters };
}

/** Combine fragments with OR. An empty list yields MATCH_NOTHING. */
export function or(...fragments: readonly SqlFragment[]): SqlFragment {
  const parts = fragments.filter((f) => !isMatchNothing(f));
  if (parts.length === 0) return MATCH_NOTHING;

  let text = '';
  const parameters: unknown[] = [];
  parts.forEach((part, index) => {
    const renumbered = part.sql.replace(/\$(\d+)/g, (_m, n: string) =>
      `$${parameters.length + Number(n)}`,
    );
    text += index === 0 ? `(${renumbered})` : ` OR (${renumbered})`;
    parameters.push(...part.parameters);
  });
  return { sql: text, parameters };
}
