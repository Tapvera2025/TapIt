import type { SqlFragment } from '@tapcrm/authz';

/**
 * SQL fragment construction.
 *
 * T-7 — "SQL is not forbidden. UNSAFE SQL is forbidden." The tagged template
 * below is how safe SQL is written: every interpolated value becomes a
 * positional parameter, and there is no code path that concatenates a value
 * into the text. CI-20 greps for template literals reaching a query function
 * without going through this tag.
 *
 * Identifiers are a separate problem — they cannot be parameterised — so
 * `ident()` allow-lists rather than escapes.
 */

export interface SqlQuery extends SqlFragment {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

class RawIdentifier {
  constructor(readonly value: string) {}
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * A table or column name. Rejects anything that is not a plain lowercase
 * identifier, because a "safe escaping" routine for identifiers is a thing
 * people get subtly wrong and then trust.
 */
export function ident(name: string): RawIdentifier {
  if (!IDENTIFIER.test(name)) {
    throw new Error(
      `Refusing to use "${name}" as a SQL identifier. Identifiers must match ${IDENTIFIER}. ` +
        'Never build an identifier from user input.',
    );
  }
  return new RawIdentifier(name);
}

/** A nested fragment, spliced with its parameters renumbered. */
function isFragment(value: unknown): value is SqlFragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sql' in value &&
    'parameters' in value &&
    typeof (value as SqlFragment).sql === 'string' &&
    Array.isArray((value as SqlFragment).parameters)
  );
}

/**
 * The tagged template.
 *
 *   sql`SELECT * FROM lead WHERE organization_id = ${orgId} AND status = ${status}`
 *
 * produces `{ sql: 'SELECT ... $1 ... $2', parameters: [orgId, status] }`.
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): SqlQuery {
  let text = '';
  const parameters: unknown[] = [];

  strings.forEach((chunk, index) => {
    text += chunk;
    if (index >= values.length) return;

    const value = values[index];

    if (value instanceof RawIdentifier) {
      text += `"${value.value}"`;
      return;
    }

    if (isFragment(value)) {
      // Renumber the nested fragment's placeholders into this query's sequence.
      text += value.sql.replace(/\$(\d+)/g, (_match, n: string) =>
        `$${parameters.length + Number(n)}`,
      );
      parameters.push(...value.parameters);
      return;
    }

    parameters.push(value);
    text += `$${parameters.length}`;
  });

  return { sql: text, parameters };
}

/** `sql.raw` for static, developer-authored text only. Never for user input. */
sql.raw = (text: string): SqlQuery => ({ sql: text, parameters: [] });

/** Joins fragments with a separator — for IN lists and column lists. */
sql.join = (fragments: readonly SqlFragment[], separator = ', '): SqlQuery => {
  let text = '';
  const parameters: unknown[] = [];
  fragments.forEach((fragment, index) => {
    if (index > 0) text += separator;
    text += fragment.sql.replace(/\$(\d+)/g, (_m, n: string) =>
      `$${parameters.length + Number(n)}`,
    );
    parameters.push(...fragment.parameters);
  });
  return { sql: text, parameters };
};
