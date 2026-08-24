/**
 * Resource domains — PRD §4.5.
 *
 * "There are exactly two domains." A resource declares a fixed domain, or
 * derives it from the record it attaches to. `derived` is a DECLARATION STYLE,
 * not a third domain: every resource *instance* resolves to people or business
 * (PD-0).
 *
 * This distinction is why there are two types below rather than one. Code that
 * makes an access decision takes `Domain`; only the registry takes
 * `DomainDeclaration`.
 */

/** What a resource instance resolves to. Exactly two values. */
export type Domain = 'people' | 'business';

/** What a registry entry may declare. `derived` resolves per instance. */
export type DomainDeclaration = Domain | 'derived';

export const DOMAINS: readonly Domain[] = ['people', 'business'] as const;

export const DOMAIN_DECLARATIONS: readonly DomainDeclaration[] = [
  'people',
  'business',
  'derived',
] as const;

export function isDomain(value: string): value is Domain {
  return value === 'people' || value === 'business';
}

export function isDomainDeclaration(value: string): value is DomainDeclaration {
  return isDomain(value) || value === 'derived';
}

/**
 * PD-0: an unresolvable parent fails closed to the more restrictive domain
 * while logging a data defect. `people` is the more restrictive of the two,
 * because `all-people` is the only scope that can reach it broadly and every
 * sensitive people resource additionally carries a mandatory field policy.
 */
export const FAIL_CLOSED_DOMAIN: Domain = 'people';

/**
 * PD-1: `all-people` is a domain-limited scope, not a narrower form of
 * unrestricted reach. Evaluating it against a business-domain resource is a
 * PROGRAMMING ERROR that fails closed and logs as a defect — not a permission
 * denial. The engine calls this to tell the two apart.
 */
export function isScopeDefinedForDomain(scope: string, domain: Domain): boolean {
  if (scope === 'all-people') return domain === 'people';
  return true;
}
