/**
 * Project value, upfront paid and due amount, as the project forms work them
 * out while typing. Amounts are decimal strings; the arithmetic goes through
 * whole minor units (paise, cents) as a bigint so it is exact. The server
 * checks the same rules and stores the due amount itself.
 */

/** Up to 16 whole digits and 2 decimals, never negative — what the database holds. */
const AMOUNT_PATTERN = /^\d{1,16}(\.\d{1,2})?$/;

export function isProjectAmount(value: string): boolean {
  return AMOUNT_PATTERN.test(value.trim());
}

function toMinorUnits(amount: string): bigint {
  const [whole = '0', fraction = ''] = amount.trim().split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function fromMinorUnits(value: bigint): string {
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}

/** Why the amounts typed cannot be saved; null when they can (or are left empty). */
export function projectAmountProblem(
  projectValue: string,
  upfrontAmount: string,
): string | null {
  const value = projectValue.trim();
  const upfront = upfrontAmount.trim();
  if (value && !isProjectAmount(value))
    return 'Enter the project value like 50000 or 50000.50, with no commas.';
  if (!upfront) return null;
  if (!isProjectAmount(upfront))
    return 'Enter the upfront amount like 20000 or 20000.50, with no commas.';
  if (!value) return 'Enter the project value before the upfront amount paid.';
  if (toMinorUnits(upfront) > toMinorUnits(value))
    return 'Upfront paid cannot be more than the project value.';
  return null;
}

/** Project value minus upfront paid (empty upfront counts as nothing paid); null until both make sense. */
export function dueAmount(projectValue: string, upfrontAmount: string): string | null {
  if (!projectValue.trim() || projectAmountProblem(projectValue, upfrontAmount))
    return null;
  const upfront = upfrontAmount.trim() ? toMinorUnits(upfrontAmount) : 0n;
  return fromMinorUnits(toMinorUnits(projectValue) - upfront);
}

/** "₹50,000.00" — for showing an amount, never for working with it. */
export function formatProjectAmount(amount: string | null, currency: string): string {
  if (amount === null || amount.trim() === '') return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
      Number(amount),
    );
  } catch {
    return `${currency} ${amount}`;
  }
}
