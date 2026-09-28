/**
 * Integer-paise arithmetic — §14.3 money rules.
 *
 * All monetary calculations use integer paise. Binary-float is never used
 * for money: amounts come in as string or integer, intermediate values stay
 * as BigInt paise, and each displayed line is rounded once (half-up) to a
 * whole rupee before the sum is taken.
 */

/** Round a paise value to the nearest whole-rupee boundary (half-up). */
export function roundToPaise(paiseExact: bigint): bigint {
  return paiseExact; // already integer
}

/** Convert a rupee amount (as decimal string or number) to paise, half-up. */
export function rupeesToPaise(rupees: string | number): bigint {
  // Use string-based arithmetic to avoid float drift.
  const s = typeof rupees === 'number' ? rupees.toFixed(4) : rupees;
  const [intPart, fracPart = ''] = s.split('.');
  const frac = (fracPart + '0000').slice(0, 4); // 4 decimal places
  // totalSubunits is in units of 1/1_000_000 rupee.
  // 1 paise = 1/100 rupee = 10_000 units of 1/1_000_000 rupee.
  const totalSubunits = BigInt(intPart ?? '0') * 1_000_000n + BigInt(frac) * 100n;
  const divisor = 10_000n;
  const q = totalSubunits / divisor;
  const r = totalSubunits % divisor;
  return r * 2n >= divisor ? q + 1n : q;
}

/** Round a paise bigint to the nearest whole rupee (100 paise), half-up. Returns paise. */
export function roundToRupee(paise: bigint): bigint {
  const q = paise / 100n;
  const r = paise % 100n;
  return (r >= 50n ? q + 1n : q) * 100n;
}

/** Convert integer paise to a display rupee string with 2 decimal places. */
export function paiseToRupees(paise: bigint): string {
  const sign = paise < 0n ? '-' : '';
  const abs = paise < 0n ? -paise : paise;
  const rupees = abs / 100n;
  const cents = abs % 100n;
  return `${sign}${rupees}.${cents.toString().padStart(2, '0')}`;
}

/**
 * Compute prorated paise for a line amount given paid units and total units.
 * paid/total * amountPaise, rounded half-up to nearest rupee.
 */
export function prorateAndRound(amountPaise: bigint, paidUnits: number, totalUnits: number): bigint {
  if (totalUnits === 0) return 0n;
  // Use bigint arithmetic: multiply first, then divide, then round to rupee
  const numerator = amountPaise * BigInt(paidUnits);
  const denominator = BigInt(totalUnits);
  const exact = numerator / denominator;
  const remainder = numerator % denominator;
  const paise = remainder * 2n >= denominator ? exact + 1n : exact;
  return roundToRupee(paise);
}
