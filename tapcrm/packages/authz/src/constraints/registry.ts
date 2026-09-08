import type { Action } from '@tapcrm/contracts';
import type { AuthzContext, Resource } from '../ports.js';
import { AuthorizationError, AuthorizationConfigError } from '../errors.js';

/**
 * The constraint registry — TECH.md §6.7.
 *
 * NF-24: "protected constraints, segregation of duties and field policies ARE
 * authorization decisions. They live in the engine's constraint registry, not
 * in handlers. A rule that is 'business policy, not a permission' is exactly
 * the rule that ends up duplicated in three controllers and enforced in two of
 * them."
 *
 * AZ-I10: adding a protected constraint means adding a registry entry and a
 * test. There is no handler-level alternative.
 */

export type ConstraintKind = 'absolute' | 'privileged';

export type ConstraintResult = { pass: true } | { pass: false; message: string };

export const PASS: ConstraintResult = { pass: true };
export const DENY = (message: string): ConstraintResult => ({ pass: false, message });

export interface Constraint {
  /** A1..A4 for absolute, P1..P8 for privileged. */
  readonly id: string;
  /**
   * AZ-I8 — "The `kind` decides the step; nothing else does."
   *   absolute  → step 3, BEFORE the Super Admin bypass. Binds everyone.
   *   privileged → step 5, AFTER it. Binds everyone except Super Admin.
   */
  readonly kind: ConstraintKind;
  /** Actions this constraint governs. `'*'` applies it to every action. */
  readonly appliesTo: readonly (Action | '*')[];
  readonly describe: string;
  evaluate(
    ctx: AuthzContext,
    action: Action,
    resource: Resource | undefined,
  ): ConstraintResult | Promise<ConstraintResult>;
}

const byId = new Map<string, Constraint>();
const byAction = new Map<string, Constraint[]>();
const wildcard: Constraint[] = [];

export function registerConstraint(constraint: Constraint): void {
  if (byId.has(constraint.id)) {
    throw new AuthorizationConfigError(`Duplicate constraint id "${constraint.id}"`);
  }
  byId.set(constraint.id, constraint);

  for (const action of constraint.appliesTo) {
    if (action === '*') {
      wildcard.push(constraint);
      continue;
    }
    const list = byAction.get(action) ?? [];
    list.push(constraint);
    byAction.set(action, list);
  }
}

export function constraintsFor(action: Action, kind: ConstraintKind): readonly Constraint[] {
  const specific = byAction.get(action) ?? [];
  return [...wildcard, ...specific].filter((c) => c.kind === kind);
}

export function registeredConstraints(): readonly Constraint[] {
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Test-only. */
export function __resetConstraints(): void {
  byId.clear();
  byAction.clear();
  wildcard.length = 0;
}

/**
 * Evaluate every constraint of one kind for one action.
 *
 * AZ-I9: "A constraint that THROWS is a DENY, logged as a defect. A constraint
 * engine that fails open is not a constraint engine." The try/catch below is
 * that rule, and it is the reason this loop does not simply `await` each
 * evaluate and let exceptions propagate as 500s.
 */
export async function assertConstraints(
  ctx: AuthzContext,
  action: Action,
  resource: Resource | undefined,
  kind: ConstraintKind,
): Promise<void> {
  for (const constraint of constraintsFor(action, kind)) {
    let result: ConstraintResult;
    try {
      result = await constraint.evaluate(ctx, action, resource);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AuthorizationError(
        action,
        kind === 'absolute' ? 'absolute_constraint' : 'privileged_constraint',
        `${constraint.id} failed to evaluate and therefore denied: ${reason}`,
        constraint.id,
      );
    }

    if (!result.pass) {
      throw new AuthorizationError(
        action,
        kind === 'absolute' ? 'absolute_constraint' : 'privileged_constraint',
        result.message,
        constraint.id,
      );
    }
  }
}
