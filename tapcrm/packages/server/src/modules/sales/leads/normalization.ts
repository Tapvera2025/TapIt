export function normalizeLeadEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

export function normalizeLeadPhone(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\D/g, '');
  return normalized || null;
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
  const candidate = hadPlus
    ? `+${digits}`
    : digits.length === 10
      ? `+91${digits}`
      : digits.startsWith('0') && digits.length === 11
        ? `+91${digits.slice(1)}`
        : `+${digits}`;
  return /^\+[1-9][0-9]{1,14}$/.test(candidate) ? candidate : null;
}
