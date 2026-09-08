/**
 * Column naming — TECH.md §5.1.
 *
 *   "SQL uses snake_case; API contracts remain camelCase. THE QUERY LAYER
 *    PERFORMS THE MAPPING."
 *
 * This is not cosmetic. AUTHORIZATION.md §6.4 declares initiator fields in
 * camelCase (`requestedBy`, `subjectId`, `userId`), and A1 resolves them by
 * reading that exact field off the resource. If a raw snake_case row reaches
 * the engine, `requestedBy` is absent, and SD-B correctly DENIES — a
 * segregation control that fails safe but blocks every legitimate approval.
 *
 * Mapping in one place, at the DAL boundary, is what keeps the document's field
 * names and the runtime object's field names the same thing.
 */

const camelCache = new Map<string, string>();

export function toCamel(key: string): string {
  const cached = camelCache.get(key);
  if (cached !== undefined) return cached;
  const converted = key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
  camelCache.set(key, converted);
  return converted;
}

const snakeCache = new Map<string, string>();

export function toSnake(key: string): string {
  const cached = snakeCache.get(key);
  if (cached !== undefined) return cached;
  const converted = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  snakeCache.set(key, converted);
  return converted;
}

/**
 * Maps one row's keys. Values are untouched — a `jsonb` payload keeps whatever
 * shape it was stored with, because it is data the application authored rather
 * than columns the schema named.
 */
export function camelizeRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[toCamel(key)] = value;
  }
  return out as T;
}

export function camelizeRows<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((row) => camelizeRow<T>(row));
}
