/**
 * Project amounts (0154): project value, upfront paid, and the due amount the
 * database works out from them. Amounts travel as decimal strings (TECH.md
 * PG-5); comparing two of them goes through whole minor units (paise, cents)
 * as a bigint, so it is exact rather than floating point.
 */

/** Up to 16 whole digits and 2 decimals, never negative — what numeric(18, 2) holds. */
export const PROJECT_AMOUNT_PATTERN = /^\d{1,16}(\.\d{1,2})?$/;

/** A validated amount ("50000", "50000.5", "50000.50") as minor units (5000000, 5000050, 5000050). */
export function toMinorUnits(amount: string): bigint {
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

/**
 * Why a project value and upfront amount cannot go together; null when they
 * can. Mirrors the `project_upfront_within_value` constraint so the person
 * gets a plain message instead of a database error.
 */
export function projectAmountProblem(
  projectValue: string | null,
  upfrontAmount: string | null,
): string | null {
  if (upfrontAmount === null) return null;
  if (projectValue === null)
    return 'Enter the project value before the upfront amount paid.';
  if (toMinorUnits(upfrontAmount) > toMinorUnits(projectValue)) {
    return 'Upfront paid cannot be more than the project value.';
  }
  return null;
}
