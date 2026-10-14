/**
 * Pure helpers for the Add-Lead drawer (R1 plan step 1.12). Split out
 * of the component so they are unit-testable without React.
 */

export interface DuplicateQuery {
  readonly phone: string | null;
  readonly email: string | null;
}

/**
 * E.164-only. The server treats bare 10-digit numbers as
 * `ambiguous_phone`, so the UI only triggers a lookup for `+<digits>`.
 */
export function normalizePhoneForLookup(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('+')) return null;
  const digits = trimmed.slice(1).replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normalizeEmailForLookup(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  return EMAIL_RE.test(trimmed) ? trimmed : null;
}

export function buildDuplicateQuery(phoneInput: string, emailInput: string): DuplicateQuery {
  return {
    phone: normalizePhoneForLookup(phoneInput),
    email: normalizeEmailForLookup(emailInput),
  };
}

export function hasEnoughInputForLookup(query: DuplicateQuery): boolean {
  return query.phone !== null || query.email !== null;
}

/** Client-side idempotency key. Falls back to a Math.random form if crypto is absent. */
export function generateIdempotencyKey(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // Non-cryptographic fallback — fine for an idempotency hint that the
  // server still validates. Matches the UUIDv4 shape so logs stay uniform.
  const bytes = new Array(16).fill(0).map(() => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

export type DuplicateDecision = 'open_existing' | 'add_enquiry' | 'create_separate';

export interface DuplicateChoiceOffer {
  readonly hasDuplicates: boolean;
  readonly options: readonly DuplicateDecision[];
}

/**
 * Given the duplicate-check response, decide which three-way choice we
 * surface to the receptionist. No duplicates → nothing to prompt.
 */
export function offerDuplicateChoices(duplicateCount: number): DuplicateChoiceOffer {
  if (duplicateCount === 0) return { hasDuplicates: false, options: [] };
  return { hasDuplicates: true, options: ['open_existing', 'add_enquiry', 'create_separate'] };
}
