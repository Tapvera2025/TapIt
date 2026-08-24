import type { Action } from '@tapcrm/contracts';

/**
 * Field projection — AZ-5, AZ-I3, PD-3.
 *
 *   "Field-level policies are applied by PROJECTION. A field the caller cannot
 *    see is OMITTED from the response, not nulled."
 *
 * PD-3 is the reason a resource's mandatory field policy is separate from the
 * caller's optional field narrowing: `all-people` grants "breadth of subject,
 * not depth of field", so holding it on payroll never implies reading every
 * field of every payslip. PD-4 adds that mandatory field policies cannot be
 * widened by delegation — only Super Admin changes them.
 */

export interface ProjectionOptions {
  /**
   * The resource's MANDATORY field policy: field name → the action required to
   * read it. Declared on the ResourcePolicy, changeable by Super Admin only.
   */
  readonly fieldPolicy?: Readonly<Record<string, Action>> | undefined;
  /**
   * Optional narrowing carried on the caller's own policy or override. When
   * present, it is an ALLOW-LIST intersected with whatever the field policy
   * already permits — narrowing only, never widening.
   */
  readonly allowedFields?: readonly string[] | undefined;
  readonly heldActions: ReadonlySet<Action>;
}

export function projectRecord<T extends Record<string, unknown>>(
  record: T,
  options: ProjectionOptions,
): Partial<T> {
  const { fieldPolicy, allowedFields, heldActions } = options;

  // Build a fresh object rather than deleting from the input: mutating the
  // record would corrupt anything else holding a reference to it, and a cached
  // row projected for one caller must not stay projected for the next.
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    // Internal evaluation hints (see the constraint predicates) never leave
    // the server, whatever the field policy says.
    if (key.startsWith('__')) continue;

    if (fieldPolicy !== undefined) {
      const required = fieldPolicy[key];
      if (required !== undefined && !heldActions.has(required)) {
        continue; // omitted, not nulled
      }
    }

    if (allowedFields !== undefined && !allowedFields.includes(key)) {
      continue;
    }

    output[key] = value;
  }

  return output as Partial<T>;
}

/** Projects a list. Same rules, applied per record. */
export function projectRecords<T extends Record<string, unknown>>(
  records: readonly T[],
  options: ProjectionOptions,
): Partial<T>[] {
  return records.map((record) => projectRecord(record, options));
}
