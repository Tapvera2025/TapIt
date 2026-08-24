/**
 * Money — TECH.md PG-5 and §8.1.
 *
 *   "Money uses NUMERIC(p,s), never JavaScript `number` for authoritative
 *    monetary values. API responses use string-encoded decimals plus currency
 *    code."
 *
 * The branded type below exists so that CI-21 ("no authoritative money field
 * maps to JavaScript number") is enforceable by the compiler rather than by a
 * reviewer noticing. A `number` cannot be assigned to `Decimal`.
 */

declare const decimalBrand: unique symbol;

/** A string-encoded fixed-point decimal. Never a float. */
export type Decimal = string & { readonly [decimalBrand]: 'Decimal' };

export type CurrencyCode = string;

export interface Money {
  readonly amount: Decimal;
  readonly currency: CurrencyCode;
}

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export function isDecimalString(value: string): boolean {
  return DECIMAL_PATTERN.test(value);
}

/**
 * The only sanctioned way to produce a `Decimal`. Takes a string, because
 * taking a number would be the exact defect this type exists to prevent:
 * `0.1 + 0.2` is not `0.3`, and an invoice built on that does not reconcile.
 */
export function decimal(value: string): Decimal {
  if (!isDecimalString(value)) {
    throw new TypeError(
      `Invalid decimal string: ${JSON.stringify(value)}. ` +
        'Money is string-encoded (TECH.md PG-5); never construct it from a float.',
    );
  }
  return value as Decimal;
}

export function money(amount: string, currency: CurrencyCode): Money {
  return { amount: decimal(amount), currency };
}

export const ZERO = (currency: CurrencyCode): Money => money('0', currency);
