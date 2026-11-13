import { describe, expect, it } from 'vitest';
import { assigneeKey, matchAssignee } from './assignees.js';
import { buildLeadFields, normalizeImportPhone, rowProblem, suggestMapping } from './mapping.js';

describe('column matching', () => {
  it('matches the columns lead lists usually have', () => {
    const headers = ['Client Name', 'Business Name', "Owner's Name", 'Number', 'Assigned To', 'City', 'Remarks'];
    const sample = [['Amit', 'Shah Traders', 'Amit Shah', '9876543210', 'Rahul', 'Pune', 'Call after 5']];
    expect(suggestMapping(headers, sample)).toEqual({
      '0': 'contactName',
      '1': 'companyName',
      '2': 'ownerName',
      '3': 'phone',
      '4': 'assignedTo',
      '5': 'location',
      '6': 'notes',
    });
  });

  it('reads longer headers and falls back to what the values look like', () => {
    const headers = ['Sr No', 'Customer Name (as per GST)', 'Mobile No. 1', 'Email ID', 'Lead Source', 'Contact'];
    const sample = [
      ['1', 'Amit', '+91 98765 43210', 'amit@shah.in', 'Expo', 'rk@x.com'],
      ['2', 'Neha', '91234 56789', 'neha@b.in', 'Expo', 'ne@x.com'],
    ];
    const mapping = suggestMapping(headers, sample);
    expect(mapping).toMatchObject({ '1': 'contactName', '2': 'phone', '3': 'email' });
    // "Sr No" holds serial numbers and "Lead Source" is not a name.
    expect(mapping['0']).toBeUndefined();
    expect(mapping['4']).toBeUndefined();
  });

  it('treats a "Number" column of serial numbers as something else', () => {
    expect(suggestMapping(['Number', 'Name', 'Phone'], [['1', 'A', '9876543210'], ['2', 'B', '9123456789']])).toEqual({ '1': 'contactName', '2': 'phone' });
  });

  it('finds an unlabelled phone column by its values', () => {
    expect(suggestMapping(['Column 1', 'Column 2'], [['Amit', '9876543210'], ['Neha', '9123456789']])).toEqual({ '1': 'phone' });
  });
});

describe('phone numbers', () => {
  it('adds the country code to local numbers and keeps international ones', () => {
    expect(normalizeImportPhone('98765 43210', '91')).toEqual({ ok: true, e164: '+919876543210', others: [] });
    expect(normalizeImportPhone('098765-43210', '91')).toEqual({ ok: true, e164: '+919876543210', others: [] });
    expect(normalizeImportPhone('919876543210', '91')).toEqual({ ok: true, e164: '+919876543210', others: [] });
    expect(normalizeImportPhone('+1 (415) 555-0123', '91')).toEqual({ ok: true, e164: '+14155550123', others: [] });
    expect(normalizeImportPhone('0044 20 7946 0958', '91')).toEqual({ ok: true, e164: '+442079460958', others: [] });
    expect(normalizeImportPhone('9.19876543210E+11', '91')).toEqual({ ok: true, e164: '+919876543210', others: [] });
  });

  it('keeps extra numbers for the notes and reports what it cannot use', () => {
    expect(normalizeImportPhone('98765 43210 / 91234 56789', '91')).toEqual({ ok: true, e164: '+919876543210', others: ['91234 56789'] });
    expect(normalizeImportPhone('12345', '91')).toEqual({ ok: false, reason: 'invalid_phone_format', others: [] });
    expect(normalizeImportPhone('9876543210', null)).toEqual({ ok: false, reason: 'ambiguous_phone', others: [] });
    expect(normalizeImportPhone('n/a', '91')).toBeNull();
  });
});

describe('lead fields from a row', () => {
  const headers = ['First', 'Last', 'Business', 'Owner Name', 'Phone', 'Email', 'Budget', 'Notes'];
  const mapping = { '0': 'firstName', '1': 'lastName', '2': 'companyName', '3': 'ownerName', '4': 'phone', '5': 'email', '7': 'notes' } as const;

  it('joins names, keeps the owner and adds unmatched columns to the notes', () => {
    const fields = buildLeadFields(headers, ['Amit', 'Shah', 'Shah Traders', 'Rakesh Shah', '98765 43210', 'AMIT@Shah.in', '5 lakh', 'Hot lead'], mapping, {
      defaultCountryCode: '91',
      extraColumnsToNotes: true,
    });
    expect(fields).toMatchObject({ contactName: 'Amit Shah', companyName: 'Shah Traders', email: 'amit@shah.in' });
    expect(fields.notes).toBe('Hot lead\nBusiness owner: Rakesh Shah\nBudget: 5 lakh');
    expect(rowProblem(fields)).toBeNull();
  });

  it('uses the owner, then the business, as the contact when no name is given', () => {
    const owner = buildLeadFields(headers, ['', '', 'Shah Traders', 'Rakesh Shah', '9876543210', '', '', ''], mapping, { defaultCountryCode: '91', extraColumnsToNotes: false });
    expect(owner.contactName).toBe('Rakesh Shah');
    expect(owner.notes).toBeNull();
    const business = buildLeadFields(headers, ['', '', 'Shah Traders', '', '9876543210', '', '', ''], mapping, { defaultCountryCode: '91', extraColumnsToNotes: false });
    expect(business.contactName).toBe('Shah Traders');
  });

  it('needs a valid phone or email', () => {
    const options = { defaultCountryCode: '91', extraColumnsToNotes: false };
    expect(rowProblem(buildLeadFields(headers, ['A', '', '', '', '', '', '', ''], mapping, options))).toBe('missing_contact');
    expect(rowProblem(buildLeadFields(headers, ['A', '', '', '', '123', '', '', ''], mapping, options))).toBe('invalid_phone_format');
    expect(rowProblem(buildLeadFields(headers, ['A', '', '', '', '', 'not-an-email', '', ''], mapping, options))).toBe('invalid_email_format');
    // A bad email beside a good phone does not stop the row.
    const kept = buildLeadFields(headers, ['A', '', '', '', '9876543210', 'not-an-email', '', ''], mapping, options);
    expect(rowProblem(kept)).toBeNull();
    expect(kept.email).toBeNull();
    expect(kept.notes).toBe('Email as written in the file: not-an-email');
  });
});

describe('assigned-to names', () => {
  const people = [
    { id: '1', fullName: 'Rahul Verma', email: 'rahul.verma@acme.in' },
    { id: '2', fullName: 'Rahul Singh', email: 'rsingh@acme.in' },
    { id: '3', fullName: 'Priya Nair', email: 'priya@acme.in' },
  ];

  it('matches emails, full names, email names and unambiguous short forms', () => {
    expect(matchAssignee('PRIYA@acme.in', people)?.id).toBe('3');
    expect(matchAssignee('  rahul   verma ', people)?.id).toBe('1');
    expect(matchAssignee('rahul.verma', people)?.id).toBe('1');
    expect(matchAssignee('Priya', people)?.id).toBe('3');
    expect(matchAssignee('Rahul V', people)?.id).toBe('1');
    expect(matchAssignee('R Singh', people)?.id).toBe('2');
  });

  it('refuses to guess between two people or an unknown name', () => {
    expect(matchAssignee('Rahul', people)).toBeNull();
    expect(matchAssignee('Sunil', people)).toBeNull();
    expect(matchAssignee('', people)).toBeNull();
  });

  it('folds case, spacing and punctuation into one key', () => {
    expect(assigneeKey('  Rahul   V. ')).toBe('rahul v.');
    expect(assigneeKey('Ráhul')).toBe('rahul');
  });
});
