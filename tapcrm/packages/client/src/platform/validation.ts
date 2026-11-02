export const COMPANY_TYPES = ['Private', 'Public', 'Partnership', 'LLC', 'Other'] as const;
export const INDUSTRIES = [
  'IT / Software',
  'Finance',
  'Healthcare',
  'Education',
  'Retail',
  'Manufacturing',
  'Other',
] as const;
export const TIMEZONES = [
  'Asia/Kolkata',
  'UTC',
  'America/New_York',
  'Europe/London',
  'Asia/Dubai',
  'Asia/Singapore',
] as const;
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'] as const;

export const COUNTRY_CODES = ['+91', '+1', '+44', '+61', '+65', '+971'] as const;

export const TEN_DIGIT_PHONE = /^\d{10}$/;
export const COMPANY_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const POSTAL_CODE = /^[A-Za-z0-9][A-Za-z0-9 -]{2,31}$/;
export const GSTIN_REGEX = /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}[1-9A-Za-z]{1}[Zz][0-9A-Za-z]{1}$/;
export const TAX_ID_REGEX = /^[A-Za-z0-9\s/.-]{2,80}$/;
export const PAN_REGEX = /^[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}$/;

const EMOJI_REGEX = /\p{Extended_Pictographic}/u;
const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F]/;

const COMPANY_NAME_CHARS_REGEX = /^[\p{L}\p{N}\s&.,'"()/@_#+!-]+$/u;
const HUMAN_NAME_CHARS_REGEX = /^[\p{L}\s.'-]+$/u;
const LOCATION_CHARS_REGEX = /^[\p{L}\s.'-]+$/u;
const DESIGNATION_CHARS_REGEX = /^[\p{L}\p{N}\s&.,'()/-]+$/u;
const REGISTRATION_NUMBER_CHARS_REGEX = /^[A-Za-z0-9\s/.-]+$/;

export function hasEmoji(value: string): boolean {
  return EMOJI_REGEX.test(value);
}

export function hasControlChars(value: string): boolean {
  return CONTROL_CHARS_REGEX.test(value);
}

export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function isValidUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export type PlatformFormValues = {
  name: string;
  code: string;
  legalCompanyName: string;
  companyType: string;
  industry: string;
  website: string;
  companyEmail: string;
  adminEmail: string;
  ownerFullName: string;
  ownerDesignation: string;
  ownerMobile: string;
  ownerAlternateNumber: string;
  phoneCountryCode: string;
  primaryPhone: string;
  alternatePhone: string;
  supportEmail: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  gstin: string;
  pan: string;
  registrationNumber: string;
  timezone: string;
  currency: string;
  [key: string]: string;
};

export const STEP_FIELDS: readonly (readonly string[])[] = [
  // Step 0: Company Information
  ['name', 'code', 'legalCompanyName', 'companyType', 'industry', 'website', 'companyEmail'],
  // Step 1: Primary Owner / Admin
  ['ownerFullName', 'ownerDesignation', 'adminEmail', 'ownerMobile', 'ownerAlternateNumber'],
  // Step 2: Company Contact Details
  ['primaryPhone', 'alternatePhone', 'supportEmail'],
  // Step 3: Company Address
  ['addressLine1', 'addressLine2', 'city', 'state', 'country', 'postalCode'],
  // Step 4: Legal / Business
  ['gstin', 'pan', 'registrationNumber'],
  // Step 5: CRM Regional Configuration
  ['timezone', 'currency'],
  // Step 6: Module Entitlements
  [],
] as const;

export function getFieldsForStep(step: number): readonly string[] {
  return STEP_FIELDS[step] ?? [];
}

export function getStepForField(field: string): number {
  for (let step = 0; step < STEP_FIELDS.length; step++) {
    const fields = STEP_FIELDS[step];
    if (fields?.includes(field)) {
      return step;
    }
  }
  return 0;
}

export function getStepForError(
  errors: Record<string, string | undefined>,
  formMode: 'create' | 'edit',
): number {
  const errorKeys = Object.keys(errors).filter((k) => Boolean(errors[k]));
  if (errorKeys.length === 0) return 0;
  let lowestStep = formMode === 'edit' ? 5 : 6;
  for (const key of errorKeys) {
    const step = getStepForField(key);
    if (step < lowestStep) lowestStep = step;
  }
  return lowestStep;
}

export function validateField(
  field: string,
  value: string,
  _form?: Partial<PlatformFormValues>,
): string | undefined {
  const trimmed = (value ?? '').trim();

  switch (field) {
    // ----------------- Step 0: Company Information -----------------
    case 'name': {
      if (!trimmed) return 'Company name is required.';
      if (hasControlChars(trimmed)) return 'Company name contains invalid control characters.';
      if (hasEmoji(trimmed)) return 'Company name cannot contain emojis.';
      if (trimmed.length < 2 || trimmed.length > 160) {
        return 'Company name must be between 2 and 160 characters.';
      }
      if (!COMPANY_NAME_CHARS_REGEX.test(trimmed)) {
        return 'Company name contains unsupported characters.';
      }
      return undefined;
    }

    case 'code': {
      if (!trimmed) return 'Company code is required.';
      if (trimmed.length < 2 || trimmed.length > 32) {
        return 'Company code must be between 2 and 32 characters.';
      }
      if (!COMPANY_CODE.test(trimmed)) {
        return 'Company code can contain only letters, numbers, underscores, and hyphens.';
      }
      return undefined;
    }

    case 'legalCompanyName': {
      if (!trimmed) return undefined;
      if (hasControlChars(trimmed)) return 'Legal company name contains invalid control characters.';
      if (hasEmoji(trimmed)) return 'Legal company name cannot contain emojis.';
      if (trimmed.length < 2 || trimmed.length > 160) {
        return 'Legal company name must be between 2 and 160 characters.';
      }
      if (!COMPANY_NAME_CHARS_REGEX.test(trimmed)) {
        return 'Legal company name contains unsupported characters.';
      }
      return undefined;
    }

    case 'companyType': {
      if (!trimmed) return 'Company type is required.';
      if (!COMPANY_TYPES.includes(trimmed as (typeof COMPANY_TYPES)[number])) {
        return 'Select a supported company type.';
      }
      return undefined;
    }

    case 'industry': {
      if (!trimmed) return 'Industry is required.';
      if (!INDUSTRIES.includes(trimmed as (typeof INDUSTRIES)[number])) {
        return 'Select a supported industry.';
      }
      return undefined;
    }

    case 'website': {
      if (!trimmed) return undefined;
      if (trimmed.length > 500) return 'Website URL cannot exceed 500 characters.';
      if (!isValidUrl(trimmed)) return 'Enter a valid website URL (e.g. https://example.com).';
      return undefined;
    }

    case 'companyEmail': {
      if (!trimmed) return 'Company email is required.';
      if (trimmed.length > 320 || !isValidEmail(trimmed)) {
        return 'Enter a valid company email.';
      }
      return undefined;
    }

    // ----------------- Step 1: Primary Owner / Admin -----------------
    case 'ownerFullName': {
      if (!trimmed) return 'Owner name is required.';
      if (hasControlChars(trimmed)) return 'Owner name contains invalid control characters.';
      if (hasEmoji(trimmed)) return 'Owner name cannot contain emojis.';
      if (/\d/.test(trimmed)) return 'Owner name cannot contain numbers.';
      if (trimmed.length < 2 || trimmed.length > 160) {
        return 'Owner name must be between 2 and 160 characters.';
      }
      if (!HUMAN_NAME_CHARS_REGEX.test(trimmed)) {
        return 'Owner name can only contain letters, spaces, hyphens, periods, and apostrophes.';
      }
      return undefined;
    }

    case 'ownerDesignation': {
      if (!trimmed) return undefined;
      if (hasControlChars(trimmed)) return 'Designation contains invalid control characters.';
      if (hasEmoji(trimmed)) return 'Designation cannot contain emojis.';
      if (trimmed.length > 120) return 'Designation cannot exceed 120 characters.';
      if (!DESIGNATION_CHARS_REGEX.test(trimmed)) {
        return 'Designation contains unsupported characters.';
      }
      return undefined;
    }

    case 'adminEmail': {
      if (!trimmed) return 'Owner/admin email is required.';
      if (trimmed.length > 320 || !isValidEmail(trimmed)) {
        return 'Enter a valid owner/admin email.';
      }
      return undefined;
    }

    case 'ownerMobile': {
      if (!trimmed) return 'Mobile number is required.';
      if (!TEN_DIGIT_PHONE.test(trimmed)) {
        return 'Mobile number must contain exactly 10 digits.';
      }
      return undefined;
    }

    case 'ownerAlternateNumber': {
      if (!trimmed) return undefined;
      if (!TEN_DIGIT_PHONE.test(trimmed)) {
        return 'Alternate mobile number must contain exactly 10 digits.';
      }
      return undefined;
    }

    // ----------------- Step 2: Company Contact Details -----------------
    case 'primaryPhone': {
      if (!trimmed) return 'Primary phone is required.';
      if (!TEN_DIGIT_PHONE.test(trimmed)) {
        return 'Primary phone must contain exactly 10 digits.';
      }
      return undefined;
    }

    case 'alternatePhone': {
      if (!trimmed) return undefined;
      if (!TEN_DIGIT_PHONE.test(trimmed)) {
        return 'Alternate phone must contain exactly 10 digits.';
      }
      return undefined;
    }

    case 'supportEmail': {
      if (!trimmed) return undefined;
      if (trimmed.length > 320 || !isValidEmail(trimmed)) {
        return 'Enter a valid support email.';
      }
      return undefined;
    }

    // ----------------- Step 3: Company Address -----------------
    case 'addressLine1': {
      if (!trimmed) return 'Address line 1 is required.';
      if (hasControlChars(trimmed)) return 'Address line 1 contains invalid control characters.';
      if (hasEmoji(trimmed)) return 'Address line 1 cannot contain emojis.';
      if (trimmed.length < 2 || trimmed.length > 240) {
        return 'Address line 1 must be between 2 and 240 characters.';
      }
      return undefined;
    }

    case 'addressLine2': {
      if (!trimmed) return undefined;
      if (hasControlChars(trimmed)) return 'Address line 2 contains invalid control characters.';
      if (hasEmoji(trimmed)) return 'Address line 2 cannot contain emojis.';
      if (trimmed.length > 240) return 'Address line 2 cannot exceed 240 characters.';
      return undefined;
    }

    case 'city': {
      if (!trimmed) return 'City is required.';
      if (hasControlChars(trimmed)) return 'City contains invalid control characters.';
      if (hasEmoji(trimmed)) return 'City cannot contain emojis.';
      if (/\d/.test(trimmed)) return 'City cannot contain numbers.';
      if (trimmed.length < 2 || trimmed.length > 120) {
        return 'City must be between 2 and 120 characters.';
      }
      if (!LOCATION_CHARS_REGEX.test(trimmed)) {
        return 'City can only contain letters, spaces, hyphens, periods, and apostrophes.';
      }
      return undefined;
    }

    case 'state': {
      if (!trimmed) return 'State is required.';
      if (hasControlChars(trimmed)) return 'State contains invalid control characters.';
      if (hasEmoji(trimmed)) return 'State cannot contain emojis.';
      if (/\d/.test(trimmed)) return 'State cannot contain numbers.';
      if (trimmed.length < 2 || trimmed.length > 120) {
        return 'State must be between 2 and 120 characters.';
      }
      if (!LOCATION_CHARS_REGEX.test(trimmed)) {
        return 'State can only contain letters, spaces, hyphens, periods, and apostrophes.';
      }
      return undefined;
    }

    case 'country': {
      if (!trimmed) return 'Country is required.';
      if (hasControlChars(trimmed)) return 'Country contains invalid control characters.';
      if (hasEmoji(trimmed)) return 'Country cannot contain emojis.';
      if (/\d/.test(trimmed)) return 'Country cannot contain numbers.';
      if (trimmed.length < 2 || trimmed.length > 120) {
        return 'Country must be between 2 and 120 characters.';
      }
      if (!LOCATION_CHARS_REGEX.test(trimmed)) {
        return 'Country can only contain letters, spaces, hyphens, periods, and apostrophes.';
      }
      return undefined;
    }

    case 'postalCode': {
      if (!trimmed) return 'Postal code is required.';
      if (trimmed.length < 3 || trimmed.length > 32 || !POSTAL_CODE.test(trimmed)) {
        return 'Enter a valid postal code (3–32 letters, numbers, spaces or hyphens).';
      }
      return undefined;
    }

    // ----------------- Step 4: Legal / Business -----------------
    case 'gstin': {
      if (!trimmed) return undefined;
      if (hasControlChars(trimmed)) return 'GSTIN / Tax ID contains invalid control characters.';
      if (hasEmoji(trimmed)) return 'GSTIN / Tax ID cannot contain emojis.';
      if (trimmed.length < 2 || trimmed.length > 80) {
        return 'GSTIN / Tax ID must be between 2 and 80 characters.';
      }
      if (!TAX_ID_REGEX.test(trimmed)) {
        return 'GSTIN / Tax ID can only contain letters, numbers, spaces, hyphens, slashes, and periods.';
      }
      return undefined;
    }

    case 'pan': {
      if (!trimmed) return undefined;
      if (!PAN_REGEX.test(trimmed)) {
        return 'Enter a valid 10-character PAN (e.g. ABCDE1234F).';
      }
      return undefined;
    }

    case 'registrationNumber': {
      if (!trimmed) return undefined;
      if (hasControlChars(trimmed)) return 'Registration number contains invalid control characters.';
      if (hasEmoji(trimmed)) return 'Registration number cannot contain emojis.';
      if (trimmed.length < 2 || trimmed.length > 120) {
        return 'Registration number must be between 2 and 120 characters.';
      }
      if (!REGISTRATION_NUMBER_CHARS_REGEX.test(trimmed)) {
        return 'Registration number can only contain letters, numbers, spaces, hyphens, slashes, and periods.';
      }
      return undefined;
    }

    // ----------------- Step 5: CRM Regional Configuration -----------------
    case 'timezone': {
      if (!trimmed) return 'Timezone is required.';
      if (!TIMEZONES.includes(trimmed as (typeof TIMEZONES)[number])) {
        return 'Select a supported timezone.';
      }
      return undefined;
    }

    case 'currency': {
      if (!trimmed) return 'Currency is required.';
      if (!CURRENCIES.includes(trimmed as (typeof CURRENCIES)[number])) {
        return 'Select a supported currency code.';
      }
      return undefined;
    }

    default:
      return undefined;
  }
}

export function validateStep(
  step: number,
  form: Partial<PlatformFormValues>,
): Record<string, string> {
  const fields = getFieldsForStep(step);
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const error = validateField(field, form[field] ?? '', form);
    if (error) {
      errors[field] = error;
    }
  }
  return errors;
}

