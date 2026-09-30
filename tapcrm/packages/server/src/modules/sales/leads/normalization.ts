export function normalizeLeadEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

export function normalizeLeadPhone(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\D/g, '');
  return normalized || null;
}
