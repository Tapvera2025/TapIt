/**
 * Sales v1.1 — pre-claim PII masking (PRD §8.3 R-BID-02, lock L4).
 *
 * Enough signal to decide, not enough to harvest.
 *
 * These functions are pure. The server MUST apply them before serialising
 * a bid-pool card into any response or socket emit — the client never
 * receives the raw PII of an unclaimed lead.
 */

export function maskName(fullName: string | null): string {
  if (!fullName) return '(unknown)';
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '(unknown)';
  const mask = (p: string): string => {
    if (p.length === 0) return '';
    const first = p[0] ?? '';
    const dots = '•'.repeat(Math.max(1, Math.min(p.length - 1, 5)));
    return `${first}${dots}`;
  };
  return parts.map(mask).join(' ');
}

// Longest-first so that '+971' beats '+97'/'+9' and '+91' beats '+9'. Only
// an identification aid for masking; keep in step with the derivation table
// in platform/time.ts.
const CC_PREFIXES = [
  '971', '966', '974', '973', '968', '965', '880', '977', '975', '960',
  '353',
  '94', '92', '93', '91', '86', '81', '82', '65', '60', '66',
  '44', '49', '33', '39', '34', '31', '61', '64',
  '7',
  '1',
];

export function maskPhone(e164OrRaw: string | null): string {
  if (!e164OrRaw) return '';
  const trimmed = e164OrRaw.trim();
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '');
    for (const cc of CC_PREFIXES) {
      if (digits.startsWith(cc)) {
        const national = digits.slice(cc.length);
        if (national.length <= 2) return `+${cc} ${'•'.repeat(national.length)}`;
        const dots = '•'.repeat(national.length - 2);
        return `+${cc} ${dots}${national.slice(-2)}`;
      }
    }
    // Unknown country code: fall back to showing first digit after '+'.
    if (digits.length <= 3) return `+${digits}`;
    const dots = '•'.repeat(digits.length - 3);
    return `+${digits[0]} ${dots}${digits.slice(-2)}`;
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length <= 2) return '•'.repeat(digits.length);
  return `${'•'.repeat(digits.length - 2)}${digits.slice(-2)}`;
}

export function maskEmail(email: string | null): string {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at <= 0) return '•'.repeat(email.length);
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const firstChar = local[0] ?? '';
  const dotCount = Math.min(local.length, 5);
  const localMask = local.length === 1 ? firstChar : `${firstChar}${'•'.repeat(dotCount)}`;
  return `${localMask}@${domain}`;
}

export function truncateMessage(message: string | null, maxChars = 80): string {
  if (!message) return '';
  const compact = message.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars - 1).trimEnd()}…`;
}
