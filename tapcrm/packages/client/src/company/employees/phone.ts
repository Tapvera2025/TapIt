/**
 * Phone numbers are stored as "<country code> <number>", e.g. "+91 9876543210",
 * so a number typed for India and one typed for the UAE stay distinguishable.
 * Shared by the Add Employee form and the employee's own profile.
 */

export const PHONE_COUNTRY_OPTIONS = [
  { code: '+91', country: 'IN', label: '+91 (India)' },
  { code: '+1', country: 'US', label: '+1 (US)' },
  { code: '+44', country: 'UK', label: '+44 (UK)' },
  { code: '+971', country: 'UAE', label: '+971 (UAE)' },
  { code: '+65', country: 'SG', label: '+65 (Singapore)' },
  { code: '+61', country: 'AU', label: '+61 (Australia)' },
  { code: '+1', country: 'CA', label: '+1 (Canada)' },
  { code: '+49', country: 'DE', label: '+49 (Germany)' },
  { code: '+33', country: 'FR', label: '+33 (France)' },
  { code: '+966', country: 'SA', label: '+966 (Saudi Arabia)' },
  { code: '+974', country: 'QA', label: '+974 (Qatar)' },
  { code: '+968', country: 'OM', label: '+968 (Oman)' },
  { code: '+965', country: 'KW', label: '+965 (Kuwait)' },
  { code: '+973', country: 'BH', label: '+973 (Bahrain)' },
  { code: '+81', country: 'JP', label: '+81 (Japan)' },
  { code: '+86', country: 'CN', label: '+86 (China)' },
  { code: '+82', country: 'KR', label: '+82 (South Korea)' },
  { code: '+880', country: 'BD', label: '+880 (Bangladesh)' },
  { code: '+92', country: 'PK', label: '+92 (Pakistan)' },
  { code: '+94', country: 'LK', label: '+94 (Sri Lanka)' },
  { code: '+977', country: 'NP', label: '+977 (Nepal)' },
  { code: '+60', country: 'MY', label: '+60 (Malaysia)' },
  { code: '+62', country: 'ID', label: '+62 (Indonesia)' },
  { code: '+63', country: 'PH', label: '+63 (Philippines)' },
  { code: '+27', country: 'ZA', label: '+27 (South Africa)' },
  { code: '+234', country: 'NG', label: '+234 (Nigeria)' },
  { code: '+254', country: 'KE', label: '+254 (Kenya)' },
  { code: '+55', country: 'BR', label: '+55 (Brazil)' },
  { code: '+52', country: 'MX', label: '+52 (Mexico)' },
  { code: '+34', country: 'ES', label: '+34 (Spain)' },
  { code: '+39', country: 'IT', label: '+39 (Italy)' },
  { code: '+31', country: 'NL', label: '+31 (Netherlands)' },
  { code: '+41', country: 'CH', label: '+41 (Switzerland)' },
  { code: '+46', country: 'SE', label: '+46 (Sweden)' },
  { code: '+47', country: 'NO', label: '+47 (Norway)' },
  { code: '+64', country: 'NZ', label: '+64 (New Zealand)' },
  { code: '+353', country: 'IE', label: '+353 (Ireland)' },
] as const;

/** "+91 98765 43210" → { countryCode: '+91', nationalNumber: '98765 43210' }. */
export function splitPhoneAndCountryCode(
  input: string,
  defaultCode = '+91',
): { countryCode: string; nationalNumber: string } {
  const trimmed = input.trim();
  if (trimmed.startsWith('+')) {
    const codes = [...PHONE_COUNTRY_OPTIONS].map((o) => o.code).sort((a, b) => b.length - a.length);
    for (const code of codes) {
      if (trimmed.startsWith(code)) {
        return { countryCode: code, nationalNumber: trimmed.slice(code.length).trim() };
      }
    }
    const match = trimmed.match(/^(\+\d{1,4})\s*(.*)$/);
    if (match) {
      return { countryCode: match[1] ?? defaultCode, nationalNumber: match[2] ?? '' };
    }
  }
  return { countryCode: defaultCode, nationalNumber: trimmed };
}

/** The stored form: country code, a space, the number. Empty when no number. */
export function formatFullPhone(countryCode: string, nationalNumber: string): string {
  const trimmed = nationalNumber.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return trimmed;
  return `${countryCode} ${trimmed}`;
}

/** Keeps digits, spaces and hyphens (and a leading +) as the person types. */
export function sanitizePhoneInput(value: string): string {
  const hasPlus = value.startsWith('+');
  const cleaned = value.replace(/[^0-9\s-]/g, '');
  return hasPlus ? `+${cleaned.replace(/^\+/, '')}` : cleaned;
}

/** Null when valid, else what is wrong. 7 to 15 digits including the country code. */
export function phoneError(fullPhone: string, required: boolean): string | null {
  if (!fullPhone) return required ? 'Phone number is required.' : null;
  if (!/^\+?[0-9\s-]+$/.test(fullPhone)) return 'Use digits only.';
  const digits = fullPhone.replace(/\D/g, '').length;
  if (digits < 7 || digits > 15) return 'Enter a valid phone number (7 to 15 digits).';
  return null;
}
