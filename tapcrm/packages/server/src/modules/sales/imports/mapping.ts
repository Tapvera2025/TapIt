/**
 * Column matching and per-row lead fields for imports. Pure: no I/O.
 *
 * A lead list is a sheet someone kept by hand, so headers vary ("Client Name",
 * "Business", "Owner's name", "Mobile No.", "Assigned To"). Each column is
 * matched to a lead field by its header, then by what its values look like,
 * and the person importing can change any match before the import runs.
 */

export const IMPORT_FIELDS = [
  'contactName',
  'firstName',
  'lastName',
  'companyName',
  'ownerName',
  'phone',
  'email',
  'requirement',
  'location',
  'notes',
  'language',
  'assignedTo',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Fields holding names, which a column of phones or emails is not. */
const NAME_FIELDS: ReadonlySet<ImportField> = new Set(['contactName', 'firstName', 'lastName', 'companyName', 'ownerName', 'assignedTo']);

/** Fields that several columns may feed; their values are joined. */
const MULTI_FIELDS: ReadonlySet<ImportField> = new Set(['requirement', 'location', 'notes']);

/** Column index (as a string) → field. */
export type ColumnMapping = Readonly<Record<string, ImportField>>;

const SYNONYMS: Readonly<Record<ImportField, readonly string[]>> = {
  contactName: [
    'name', 'client name', 'client', 'customer name', 'customer', 'contact name', 'contact person', 'contact',
    'full name', 'lead name', 'lead', 'person name', 'party name', 'party', 'prospect', 'prospect name', 'client full name',
  ],
  firstName: ['first name', 'firstname', 'given name', 'fname', 'first'],
  lastName: ['last name', 'lastname', 'surname', 'family name', 'lname', 'last'],
  companyName: [
    'business name', 'business', 'company', 'company name', 'firm', 'firm name', 'organisation', 'organization',
    'organisation name', 'organization name', 'shop name', 'shop', 'store name', 'store', 'brand', 'brand name',
    'account name', 'establishment', 'enterprise',
  ],
  ownerName: ['owner name', 'owner', 'business owner', 'owners name', 'owner s name', 'proprietor', 'proprietor name', 'director', 'director name', 'founder'],
  phone: [
    'number', 'phone', 'phone number', 'mobile', 'mobile number', 'mobile no', 'mob no', 'mob', 'contact number',
    'contact no', 'phone no', 'ph no', 'cell', 'cell number', 'whatsapp', 'whatsapp number', 'whatsapp no', 'tel',
    'telephone', 'telephone number', 'mobile phone', 'primary phone', 'number 1', 'phone 1', 'mobile 1', 'contact',
  ],
  email: ['email', 'e mail', 'email id', 'email address', 'mail', 'mail id', 'e mail id', 'e mail address'],
  requirement: ['requirement', 'requirements', 'service', 'services', 'service required', 'product', 'interest', 'interested in', 'enquiry', 'inquiry', 'need', 'category'],
  location: ['city', 'location', 'address', 'area', 'state', 'region', 'place', 'locality', 'town', 'district', 'pincode', 'pin code', 'zip', 'country'],
  notes: ['notes', 'note', 'remarks', 'remark', 'comments', 'comment', 'message', 'description', 'details', 'feedback'],
  language: ['language', 'preferred language', 'lang'],
  assignedTo: [
    'assigned to', 'assigned', 'assignee', 'assign to', 'sales person', 'salesperson', 'sales executive',
    'executive', 'agent', 'handled by', 'allotted to', 'allocated to', 'allocated', 'allotted', 'rm',
    'relationship manager', 'caller', 'telecaller', 'tele caller', 'employee', 'employee name', 'staff',
    'lead owner', 'account owner', 'sales rep', 'rep', 'bde', 'bdm',
  ],
};

export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const PHONE_VALUE = /^[+(]?[\d\s().-]{7,20}$/;
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Single words that name a field even inside a longer header ("Email ID",
 * "Mobile No 2", "City / Town"). Other single words ("client", "business",
 * "owner") only count as the whole header: "Client ID" or "Business Type" is
 * not a name.
 */
const STRONG_WORDS: ReadonlySet<string> = new Set([
  'email', 'phone', 'mobile', 'whatsapp', 'telephone', 'company', 'organisation', 'organization', 'firm',
  'city', 'location', 'address', 'notes', 'remarks', 'comments', 'requirement', 'assignee', 'salesperson',
  'telecaller', 'proprietor', 'surname', 'language', 'pincode',
]);

/**
 * Suggest a field for each column: an exact header synonym first, then the
 * longest synonym the header contains, then the shape of the values (phones,
 * emails). Single-value fields are given to one column only.
 */
export function suggestMapping(headers: readonly string[], sampleRows: readonly (readonly string[])[]): Record<string, ImportField> {
  const mapping: Record<string, ImportField> = {};
  const taken = new Set<ImportField>();
  const normalized = headers.map(normalizeHeader);
  const available = (field: ImportField): boolean => MULTI_FIELDS.has(field) || !taken.has(field);
  const claim = (column: number, field: ImportField): void => {
    mapping[String(column)] = field;
    if (!MULTI_FIELDS.has(field)) taken.add(field);
  };
  // A header is only believed when the values agree: a "Number" column of
  // serial numbers is not a phone, a "Contact" column of emails is not a name.
  const fits = (field: ImportField, column: number): boolean => {
    const values = columnValues(sampleRows, column);
    if (values.length === 0) return true;
    const emails = values.filter((value) => EMAIL_VALUE.test(value)).length / values.length;
    if (field === 'phone') return looksLikePhones(values, 0.3);
    if (field === 'email') return emails >= 0.3;
    if (NAME_FIELDS.has(field)) return emails < 0.5 && !looksLikePhones(values, 0.5);
    return true;
  };

  // 1. The whole header is a synonym.
  normalized.forEach((header, column) => {
    const field = IMPORT_FIELDS.find((candidate) => SYNONYMS[candidate].includes(header) && available(candidate) && fits(candidate, column));
    if (field) claim(column, field);
  });

  // 2. The header contains a synonym, longest first ("Client Name (as per GST)").
  normalized.forEach((header, column) => {
    if (mapping[String(column)] || !header) return;
    let best: { field: ImportField; length: number } | null = null;
    for (const field of IMPORT_FIELDS) {
      if (!available(field)) continue;
      for (const synonym of SYNONYMS[field]) {
        if (!synonym.includes(' ') && !STRONG_WORDS.has(synonym)) continue;
        if (!` ${header} `.includes(` ${synonym} `)) continue;
        if (!fits(field, column)) continue;
        if (!best || synonym.length > best.length) best = { field, length: synonym.length };
      }
    }
    if (best) claim(column, best.field);
  });

  // 3. Values: a column of phone numbers or emails is one, whatever its header.
  headers.forEach((_header, column) => {
    if (mapping[String(column)]) return;
    const values = columnValues(sampleRows, column);
    if (!taken.has('phone') && looksLikePhones(values, 0.6)) claim(column, 'phone');
    else if (!taken.has('email') && values.length > 0 && values.filter((value) => EMAIL_VALUE.test(value)).length / values.length >= 0.6) claim(column, 'email');
  });
  return mapping;
}

function columnValues(rows: readonly (readonly string[])[], column: number): string[] {
  return rows.map((row) => (row[column] ?? '').trim()).filter((value) => value !== '');
}

function looksLikePhones(values: readonly string[], share: number): boolean {
  if (values.length === 0) return false;
  const phones = values.filter((value) => PHONE_VALUE.test(value) && value.replace(/\D/g, '').length >= 7);
  return phones.length / values.length >= share;
}

/* ------------------------------------------------------------------ *
 * Phones
 * ------------------------------------------------------------------ */

export type PhoneResult =
  | { readonly ok: true; readonly e164: string; readonly others: readonly string[] }
  | { readonly ok: false; readonly reason: 'invalid_phone_format' | 'ambiguous_phone'; readonly others: readonly string[] };

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * A cell can hold one number or several ("98765 43210 / 91234 56789"). The
 * first becomes the lead's phone, in E.164; the rest are kept for the notes.
 * Numbers without a country code take `defaultCountryCode`.
 */
export function normalizeImportPhone(raw: string, defaultCountryCode: string | null): PhoneResult | null {
  const parts = raw
    .split(/\s*(?:[/,;|]|\bor\b|&)\s*/i)
    .map((part) => part.trim())
    .filter((part) => /\d/.test(part));
  if (parts.length === 0) return null;
  const [first, ...rest] = parts;
  const others = rest.filter((part) => part.replace(/\D/g, '').length >= 7);
  const phone = toE164(first!, defaultCountryCode);
  if (phone === 'invalid' || phone === 'ambiguous') {
    return { ok: false, reason: phone === 'invalid' ? 'invalid_phone_format' : 'ambiguous_phone', others };
  }
  return { ok: true, e164: phone, others };
}

function toE164(value: string, defaultCountryCode: string | null): string {
  let text = value.trim();
  // Excel turns long numbers into "9.19876543210E+11" when saved as CSV.
  if (/^\d(?:\.\d+)?e\+\d+$/i.test(text)) {
    const number = Number(text);
    if (Number.isFinite(number) && Number.isInteger(number)) text = number.toFixed(0);
  }
  text = text.replace(/\s*(?:ext|extn|x)\.?\s*\d+$/i, '');
  const hadPlus = text.startsWith('+');
  let digits = text.replace(/\D/g, '');
  if (!digits) return 'invalid';
  if (!hadPlus && digits.startsWith('00')) {
    digits = digits.replace(/^00/, '');
    return finalize(`+${digits}`);
  }
  if (hadPlus) return finalize(`+${digits}`);
  if (digits.length < 7 || digits.length > 15) return 'invalid';
  const code = defaultCountryCode && /^[1-9]\d{0,2}$/.test(defaultCountryCode) ? defaultCountryCode : null;
  if (code) {
    const national = digits.replace(/^0+/, '');
    // "919876543210" already carries the country code.
    if (national.startsWith(code) && national.length - code.length >= 8 && national.length > 10) return finalize(`+${national}`);
    return finalize(`+${code}${national}`);
  }
  // No country to assume: a long number is taken to include its code.
  return digits.length >= 11 ? finalize(`+${digits}`) : 'ambiguous';
}

function finalize(candidate: string): string {
  return E164.test(candidate) ? candidate : 'invalid';
}

/* ------------------------------------------------------------------ *
 * Lead fields from one row
 * ------------------------------------------------------------------ */

export interface LeadFieldOptions {
  readonly defaultCountryCode: string | null;
  /** Add unmapped columns to the lead's notes as "Header: value". */
  readonly extraColumnsToNotes: boolean;
}

export interface RowLeadFields {
  readonly contactName: string | null;
  readonly companyName: string | null;
  readonly ownerName: string | null;
  readonly phoneRaw: string | null;
  readonly phone: PhoneResult | null;
  readonly email: string | null;
  readonly emailRaw: string | null;
  readonly emailValid: boolean;
  readonly requirement: string | null;
  readonly location: string | null;
  readonly language: string | null;
  readonly notes: string | null;
  readonly assignedTo: string | null;
}

export type RowProblem = 'missing_contact' | 'invalid_phone_format' | 'ambiguous_phone' | 'invalid_email_format';

const NOTES_LIMIT = 4000;
const VALUE_LIMIT = 500;

export function buildLeadFields(
  headers: readonly string[],
  cells: readonly string[],
  mapping: ColumnMapping,
  options: LeadFieldOptions,
): RowLeadFields {
  const values = new Map<ImportField, string[]>();
  const extras: string[] = [];
  headers.forEach((header, column) => {
    const value = (cells[column] ?? '').trim();
    if (!value) return;
    const field = mapping[String(column)];
    if (field) {
      const list = values.get(field) ?? [];
      list.push(value);
      values.set(field, list);
    } else if (options.extraColumnsToNotes) {
      extras.push(`${header || `Column ${column + 1}`}: ${value}`);
    }
  });
  const one = (field: ImportField): string | null => truncate(values.get(field)?.[0] ?? null, VALUE_LIMIT);
  const joined = (field: ImportField, separator: string): string | null => truncate(values.get(field)?.join(separator) ?? null, VALUE_LIMIT * 2);

  const ownerName = one('ownerName');
  const companyName = one('companyName');
  const personName = one('contactName') ?? ([one('firstName'), one('lastName')].filter(Boolean).join(' ') || null);
  // A list of businesses often names only the owner: they are the contact.
  const contactName = personName ?? ownerName ?? companyName;

  const phoneRaw = one('phone');
  const phone = phoneRaw ? normalizeImportPhone(phoneRaw, options.defaultCountryCode) : null;
  const emailRaw = one('email');
  const email = emailRaw ? emailRaw.trim().toLowerCase() : null;
  const emailValid = email !== null && EMAIL_VALUE.test(email) && email.length <= 320;

  const noteLines: string[] = [];
  const mappedNotes = values.get('notes');
  if (mappedNotes) noteLines.push(...mappedNotes);
  if (ownerName && personName && ownerName !== personName) noteLines.push(`Business owner: ${ownerName}`);
  if (phone && phone.others.length) noteLines.push(`Other numbers: ${phone.others.join(', ')}`);
  if (email && !emailValid && phone?.ok) noteLines.push(`Email as written in the file: ${emailRaw ?? ''}`);
  if (extras.length) noteLines.push(...extras);

  return {
    contactName,
    companyName,
    ownerName,
    phoneRaw,
    phone,
    email: emailValid ? email : null,
    emailRaw,
    emailValid,
    requirement: joined('requirement', ', '),
    location: joined('location', ', '),
    language: one('language'),
    notes: truncate(noteLines.join('\n') || null, NOTES_LIMIT),
    assignedTo: one('assignedTo'),
  };
}

/**
 * Why a row cannot become a lead, if it cannot: it needs a valid phone or a
 * valid email. A bad email beside a good phone is dropped into the notes; a
 * bad phone with no usable email stops the row.
 */
export function rowProblem(fields: RowLeadFields): RowProblem | null {
  const hasPhone = fields.phone?.ok === true;
  if (hasPhone || fields.emailValid) return null;
  if (fields.phone && !fields.phone.ok) return fields.phone.reason;
  if (fields.emailRaw) return 'invalid_email_format';
  return 'missing_contact';
}

export const PROBLEM_LABELS: Readonly<Record<RowProblem, string>> = {
  missing_contact: 'No phone number or email',
  invalid_phone_format: 'Phone number is not valid',
  ambiguous_phone: 'Phone number has no country code',
  invalid_email_format: 'Email is not valid',
};

function truncate(value: string | null, limit: number): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}
