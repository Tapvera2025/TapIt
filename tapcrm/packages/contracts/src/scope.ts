/**
 * Scope — PRD §4.1.
 *
 * How far a permission reaches. Note what is NOT here: there is deliberately
 * no `all` scope. Organization-wide reach is the protected capability
 * `globalAccess`, derived from account type, never a value an administrator can
 * pick from a dropdown (PRD §4.1, §4.7).
 *
 * A client principal likewise has no scope. Client isolation is absolute
 * constraint A2, evaluated before policy resolution — keeping an outside
 * party's boundary out of this enum means no misconfiguration can select it.
 */
export const SCOPES = [
  /** Resources the principal owns or is the subject of. */
  'own',
  /** Resources on which the principal is a named party — briefs, deliveries, approvals. */
  'participant',
  /** Resources owned by members of the principal's agent pool. */
  'pool',
  /** The principal's organizational team, transitively downward (VIS-1). */
  'team',
  /** The principal's department. */
  'department',
  /** Every employee record — people-domain resources ONLY (PD-1). */
  'all-people',
] as const;

export type Scope = (typeof SCOPES)[number];

const SCOPE_SET: ReadonlySet<string> = new Set(SCOPES);

export function isScope(value: string): value is Scope {
  return SCOPE_SET.has(value);
}

/**
 * Breadth ordering, used ONLY by the delegation ceiling check (PRD §4.6):
 * an actor cannot grant a scope wider than the one they hold.
 *
 * This is not a general "more powerful" ordering and must never be used to
 * decide access. `all-people` is not a superset of `department` for business
 * resources — it is undefined against them (PD-1).
 */
const SCOPE_BREADTH: Readonly<Record<Scope, number>> = {
  own: 1,
  participant: 2,
  pool: 3,
  team: 4,
  department: 5,
  'all-people': 6,
};

export function scopeBreadth(scope: Scope): number {
  return SCOPE_BREADTH[scope];
}

/** True when `candidate` reaches no further than `ceiling`. */
export function isWithinCeiling(candidate: Scope, ceiling: Scope): boolean {
  return SCOPE_BREADTH[candidate] <= SCOPE_BREADTH[ceiling];
}
