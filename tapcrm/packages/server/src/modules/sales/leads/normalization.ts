export function normalizeLeadEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

/**
 * The duplicate-matching key for a lead's phone: the digits of its E.164 form,
 * the same key website, ad and imported leads store ("+91 98765 43210",
 * "098765 43210" and "9876543210" are all "919876543210"). A number that has
 * no E.164 form keeps its bare digits.
 */
export function normalizeLeadPhone(value: string | null | undefined): string | null {
  const e164 = toContactE164(value);
  if (e164) return e164.slice(1);
  const digits = value?.replace(/\D/g, '');
  return digits || null;
}

/**
 * Best-effort E.164 for the canonical contact.primary_phone column, which
 * is CHECK-constrained to `^\+[1-9][0-9]{1,14}$`. Falls back to null when the
 * input is clearly not a reachable number — the caller may then persist the
 * raw string on `contact.primary_phone_raw` and rely on `primary_email` to
 * satisfy the "phone or email required" constraint.
 */
export function toContactE164(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 0) return null;
  const hadPlus = trimmed.startsWith('+');
  // 10-digit domestic → assume Indian country code; the tenant default
  // timezone is Asia/Kolkata so this matches the dominant intake pattern.
  // "00" is the international dialling prefix ("0091 98765 43210").
  const candidate = hadPlus
    ? `+${digits}`
    : digits.startsWith('00')
      ? `+${digits.slice(2)}`
    : digits.length === 10
      ? `+91${digits}`
      : digits.startsWith('0') && digits.length === 11
        ? `+91${digits.slice(1)}`
        : `+${digits}`;
  return /^\+[1-9][0-9]{1,14}$/.test(candidate) ? candidate : null;
}
