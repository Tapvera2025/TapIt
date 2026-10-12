/**
 * Sales v1.1 — intake payload validation (PRD §6, §7.1).
 *
 * Pure functions: no DB, no I/O. The service layer uses them before
 * opening a transaction so a quarantine or reject decision is cheap.
 *
 * Phone validation here is deliberately conservative:
 *   - a value already in E.164 (`+<cc><number>`) is accepted
 *   - otherwise we need a default country from the connector to coerce
 *   - without either, we quarantine with `ambiguous_phone` rather than
 *     guess and later discover a wrong lead
 *
 * Real country-aware parsing (libphonenumber) is a R1.2 hardening task.
 * The current logic is enough for the pilot (phones already have '+91'
 * from Meta forms; website forms can enforce E.164 client-side).
 */

import type { IntakeMappedFields, QuarantineReason } from './types.js';

const E164 = /^\+[1-9]\d{1,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NormalizedContact {
  readonly fullName: string | null;
  readonly phoneRaw: string | null;
  readonly phoneE164: string | null;
  readonly email: string | null;
}

export interface ValidationOk {
  readonly ok: true;
  readonly contact: NormalizedContact;
}

export interface ValidationQuarantine {
  readonly ok: false;
  readonly reason: QuarantineReason;
  readonly detail?: string;
}

export type ValidationResult = ValidationOk | ValidationQuarantine;

export interface ValidateOptions {
  /**
   * Country code (without leading '+') to prepend when a phone value is
   * digits-only or lacks a prefix. Comes from the connector config,
   * e.g. '91' for an India-only website form. Null disables coercion
   * and forces ambiguous phones to quarantine.
   */
  readonly defaultCountryCode?: string | null;
  /**
   * Required canonical fields. For a connector where service is known
   * at form level (Meta ad about one service), `requireService` can be
   * false; for a generic website form, it is true.
   */
  readonly requireService?: boolean;
}

export function validateIntake(fields: IntakeMappedFields, opts: ValidateOptions = {}): ValidationResult {
  const requireService = opts.requireService ?? false;

  const email = normalizeEmail(fields.emailRaw);
  if (fields.emailRaw && !email) {
    return { ok: false, reason: 'invalid_email_format', detail: fields.emailRaw };
  }

  const phoneRaw = typeof fields.phoneRaw === 'string' ? fields.phoneRaw.trim() || null : null;
  let phoneE164: string | null = null;
  if (phoneRaw) {
    const promoted = toE164(phoneRaw, opts.defaultCountryCode ?? null);
    if (promoted === 'invalid') {
      return { ok: false, reason: 'invalid_phone_format', detail: phoneRaw };
    }
    if (promoted === 'ambiguous') {
      return { ok: false, reason: 'ambiguous_phone', detail: phoneRaw };
    }
    phoneE164 = promoted;
  }

  if (!phoneE164 && !email) {
    return { ok: false, reason: 'missing_contact' };
  }

  if (requireService && !fields.serviceRequested) {
    return { ok: false, reason: 'missing_service' };
  }

  const fullName = typeof fields.contactName === 'string' ? fields.contactName.trim() || null : null;

  return {
    ok: true,
    contact: { fullName, phoneRaw, phoneE164, email },
  };
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return EMAIL.test(trimmed) ? trimmed : null;
}

/**
 * Returns:
 *   - the E.164 string if parseable (either already valid, or coerced via
 *     a default country code)
 *   - 'ambiguous' when digits exist but no country context is available
 *   - 'invalid' when the format is clearly not a phone number
 */
function toE164(raw: string, defaultCountryCode: string | null): string | 'ambiguous' | 'invalid' {
  const compact = raw.replace(/[\s\-()]/g, '');
  if (E164.test(compact)) return compact;
  const digits = compact.replace(/\D/g, '');
  if (!digits) return 'invalid';
  if (digits.length < 7 || digits.length > 15) return 'invalid';
  if (defaultCountryCode !== null && /^\d{1,3}$/.test(defaultCountryCode)) {
    const candidate = `+${defaultCountryCode}${digits}`;
    return E164.test(candidate) ? candidate : 'invalid';
  }
  return 'ambiguous';
}
