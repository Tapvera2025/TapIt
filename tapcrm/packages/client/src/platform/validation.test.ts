import { describe, it, expect } from 'vitest';
import {
  validateField,
  validateStep,
  getStepForField,
  getStepForError,
  hasEmoji,
  hasControlChars,
  isValidEmail,
  isValidUrl,
  type PlatformFormValues,
} from './validation.js';

describe('Validation Helpers', () => {
  it('detects emojis correctly', () => {
    expect(hasEmoji('Acme 🚀 Corp')).toBe(true);
    expect(hasEmoji('TapCRM Inc.')).toBe(false);
  });

  it('detects control characters correctly', () => {
    expect(hasControlChars('Acme\u0000Corp')).toBe(true);
    expect(hasControlChars('Acme\u001fCorp')).toBe(true);
    expect(hasControlChars('Acme Corp')).toBe(false);
  });

  it('validates emails correctly', () => {
    expect(isValidEmail('admin@tapcrm.com')).toBe(true);
    expect(isValidEmail('invalid-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('   user@domain.co.in   ')).toBe(true);
  });

  it('validates URLs correctly', () => {
    expect(isValidUrl('https://tapcrm.com')).toBe(true);
    expect(isValidUrl('http://sub.domain.org/path')).toBe(true);
    expect(isValidUrl('ftp://example.com')).toBe(false);
    expect(isValidUrl('not-a-url')).toBe(false);
  });
});

describe('Field-Level Validations', () => {
  describe('Step 0: Company Information', () => {
    it('validates company name', () => {
      expect(validateField('name', '')).toBe('Company name is required.');
      expect(validateField('name', 'A')).toBe('Company name must be between 2 and 160 characters.');
      expect(validateField('name', 'Acme 🚀 Corp')).toBe('Company name cannot contain emojis.');
      expect(validateField('name', 'Acme\u0007Corp')).toBe('Company name contains invalid control characters.');
      expect(validateField('name', 'Acme Corp')).toBeUndefined();
      expect(validateField('name', 'TapIt! & Co. (Pvt) Ltd - #1')).toBeUndefined();
    });

    it('validates company code', () => {
      expect(validateField('code', '')).toBe('Company code is required.');
      expect(validateField('code', 'A')).toBe('Company code must be between 2 and 32 characters.');
      expect(validateField('code', 'ABC_001-XYZ')).toBeUndefined();
      expect(validateField('code', 'INVALID CODE')).toBe('Company code can contain only letters, numbers, underscores, and hyphens.');
      expect(validateField('code', 'A'.repeat(33))).toBe('Company code must be between 2 and 32 characters.');
    });

    it('validates legal company name (optional)', () => {
      expect(validateField('legalCompanyName', '')).toBeUndefined();
      expect(validateField('legalCompanyName', 'X')).toBe('Legal company name must be between 2 and 160 characters.');
      expect(validateField('legalCompanyName', 'Legal Name 🚀')).toBe('Legal company name cannot contain emojis.');
      expect(validateField('legalCompanyName', 'TapCRM Technologies Pvt Ltd')).toBeUndefined();
    });

    it('validates company type and industry', () => {
      expect(validateField('companyType', 'Private')).toBeUndefined();
      expect(validateField('companyType', 'InvalidType')).toBe('Select a supported company type.');
      expect(validateField('industry', 'IT / Software')).toBeUndefined();
      expect(validateField('industry', 'Magic')).toBe('Select a supported industry.');
    });

    it('validates website (optional)', () => {
      expect(validateField('website', '')).toBeUndefined();
      expect(validateField('website', 'invalid-url')).toBe('Enter a valid website URL (e.g. https://example.com).');
      expect(validateField('website', 'https://example.com')).toBeUndefined();
    });

    it('validates company email', () => {
      expect(validateField('companyEmail', '')).toBe('Company email is required.');
      expect(validateField('companyEmail', 'not-email')).toBe('Enter a valid company email.');
      expect(validateField('companyEmail', 'info@tapcrm.com')).toBeUndefined();
    });
  });

  describe('Step 1: Primary Owner / Admin', () => {
    it('validates owner full name', () => {
      expect(validateField('ownerFullName', '')).toBe('Owner name is required.');
      expect(validateField('ownerFullName', 'J')).toBe('Owner name must be between 2 and 160 characters.');
      expect(validateField('ownerFullName', 'John Doe 🚀')).toBe('Owner name cannot contain emojis.');
      expect(validateField('ownerFullName', 'John Doe 123')).toBe('Owner name cannot contain numbers.');
      expect(validateField('ownerFullName', 'Jane Doe-Smith')).toBeUndefined();
      expect(validateField('ownerFullName', "O'Connor")).toBeUndefined();
    });

    it('validates owner designation (optional)', () => {
      expect(validateField('ownerDesignation', '')).toBeUndefined();
      expect(validateField('ownerDesignation', 'CEO 🚀')).toBe('Designation cannot contain emojis.');
      expect(validateField('ownerDesignation', 'Chief Technology Officer')).toBeUndefined();
      expect(validateField('ownerDesignation', 'A'.repeat(125))).toBe('Designation cannot exceed 120 characters.');
    });

    it('validates admin email', () => {
      expect(validateField('adminEmail', '')).toBe('Owner/admin email is required.');
      expect(validateField('adminEmail', 'bad-email')).toBe('Enter a valid owner/admin email.');
      expect(validateField('adminEmail', 'admin@example.com')).toBeUndefined();
    });

    it('validates owner mobile and alternate mobile', () => {
      expect(validateField('ownerMobile', '')).toBe('Mobile number is required.');
      expect(validateField('ownerMobile', '987654321')).toBe('Mobile number must contain exactly 10 digits.');
      expect(validateField('ownerMobile', '9876543210')).toBeUndefined();
      expect(validateField('ownerAlternateNumber', '')).toBeUndefined();
      expect(validateField('ownerAlternateNumber', '123')).toBe('Alternate mobile number must contain exactly 10 digits.');
      expect(validateField('ownerAlternateNumber', '9876543211')).toBeUndefined();
    });
  });

  describe('Step 2: Company Contact Details', () => {
    it('validates primary phone, alternate phone, and support email', () => {
      expect(validateField('primaryPhone', '')).toBe('Primary phone is required.');
      expect(validateField('primaryPhone', '9876543210')).toBeUndefined();
      expect(validateField('alternatePhone', '')).toBeUndefined();
      expect(validateField('alternatePhone', '123')).toBe('Alternate phone must contain exactly 10 digits.');
      expect(validateField('alternatePhone', '9876543212')).toBeUndefined();
      expect(validateField('supportEmail', '')).toBeUndefined();
      expect(validateField('supportEmail', 'support@tapcrm.com')).toBeUndefined();
      expect(validateField('supportEmail', 'invalid')).toBe('Enter a valid support email.');
    });
  });

  describe('Step 3: Company Address', () => {
    it('validates address line 1 and 2', () => {
      expect(validateField('addressLine1', '')).toBe('Address line 1 is required.');
      expect(validateField('addressLine1', 'A')).toBe('Address line 1 must be between 2 and 240 characters.');
      expect(validateField('addressLine1', '123 Main Street 🚀')).toBe('Address line 1 cannot contain emojis.');
      expect(validateField('addressLine1', '123 Main Street, Suite 400')).toBeUndefined();
      expect(validateField('addressLine2', '')).toBeUndefined();
      expect(validateField('addressLine2', 'Floor 5 🚀')).toBe('Address line 2 cannot contain emojis.');
      expect(validateField('addressLine2', 'Building B')).toBeUndefined();
    });

    it('validates city, state, country', () => {
      for (const field of ['city', 'state', 'country'] as const) {
        expect(validateField(field, '')).toBe(`${field[0]!.toUpperCase() + field.slice(1)} is required.`);
        expect(validateField(field, 'A')).toBe(`${field[0]!.toUpperCase() + field.slice(1)} must be between 2 and 120 characters.`);
        expect(validateField(field, 'City 123')).toBe(`${field[0]!.toUpperCase() + field.slice(1)} cannot contain numbers.`);
        expect(validateField(field, 'City 🚀')).toBe(`${field[0]!.toUpperCase() + field.slice(1)} cannot contain emojis.`);
      }
      expect(validateField('city', 'New York')).toBeUndefined();
      expect(validateField('state', 'California')).toBeUndefined();
      expect(validateField('country', 'United States')).toBeUndefined();
    });

    it('validates postal code', () => {
      expect(validateField('postalCode', '')).toBe('Postal code is required.');
      expect(validateField('postalCode', '12')).toBe('Enter a valid postal code (3–32 letters, numbers, spaces or hyphens).');
      expect(validateField('postalCode', '110001')).toBeUndefined();
      expect(validateField('postalCode', 'EC1A 1BB')).toBeUndefined();
      expect(validateField('postalCode', '90210')).toBeUndefined();
    });
  });

  describe('Step 4: Legal / Business Details', () => {
    it('validates GSTIN / Tax ID (optional, supports international tax IDs)', () => {
      expect(validateField('gstin', '')).toBeUndefined();
      expect(validateField('gstin', 'D')).toBe('GSTIN / Tax ID must be between 2 and 80 characters.');
      expect(validateField('gstin', 'DE@311653556')).toBe(
        'GSTIN / Tax ID can only contain letters, numbers, spaces, hyphens, slashes, and periods.',
      );
      expect(validateField('gstin', 'DE311653556 🚀')).toBe('GSTIN / Tax ID cannot contain emojis.');
      // International and Indian Tax IDs
      expect(validateField('gstin', 'DE311653556')).toBeUndefined();
      expect(validateField('gstin', '22AAAAA0000A1Z5')).toBeUndefined();
      expect(validateField('gstin', '12-3456789')).toBeUndefined();
      expect(validateField('gstin', 'GB123456789')).toBeUndefined();
      expect(validateField('gstin', 'CHE-123.456.789')).toBeUndefined();
    });

    it('validates PAN (optional)', () => {
      expect(validateField('pan', '')).toBeUndefined();
      expect(validateField('pan', 'INVALID')).toBe('Enter a valid 10-character PAN (e.g. ABCDE1234F).');
      expect(validateField('pan', 'ABCDE1234F')).toBeUndefined();
    });

    it('validates registration number (optional)', () => {
      expect(validateField('registrationNumber', '')).toBeUndefined();
      expect(validateField('registrationNumber', 'U72200MH2020PTC123456')).toBeUndefined();
      expect(validateField('registrationNumber', 'REG 🚀')).toBe('Registration number cannot contain emojis.');
    });
  });

  describe('Step 5: Regional Configuration', () => {
    it('validates timezone and currency', () => {
      expect(validateField('timezone', 'Asia/Kolkata')).toBeUndefined();
      expect(validateField('timezone', 'Invalid/Zone')).toBe('Select a supported timezone.');
      expect(validateField('currency', 'INR')).toBeUndefined();
      expect(validateField('currency', 'XYZ')).toBe('Select a supported currency code.');
    });
  });
});

describe('Step-wise Validation and Navigation', () => {
  const validFullForm: PlatformFormValues = {
    name: 'TapCRM Technologies',
    code: 'TAP001',
    legalCompanyName: 'TapCRM Technologies Pvt Ltd',
    companyType: 'Private',
    industry: 'IT / Software',
    website: 'https://tapcrm.com',
    companyEmail: 'contact@tapcrm.com',
    adminEmail: 'admin@tapcrm.com',
    ownerFullName: 'John Doe',
    ownerDesignation: 'Founder & CEO',
    ownerMobile: '9876543210',
    ownerAlternateNumber: '9876543211',
    phoneCountryCode: '+91',
    primaryPhone: '9876543212',
    alternatePhone: '',
    supportEmail: 'support@tapcrm.com',
    addressLine1: '123 Tech Park',
    addressLine2: 'Block A, 4th Floor',
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
    postalCode: '560001',
    gstin: '29AAAAA0000A1Z5',
    pan: 'AAAAA0000A',
    registrationNumber: 'U72200KA2020PTC123456',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
  };

  it('validates step 0 without errors on valid form', () => {
    const errors = validateStep(0, validFullForm);
    expect(errors).toEqual({});
  });

  it('catches step 0 errors immediately', () => {
    const invalidForm = { ...validFullForm, name: 'A', code: 'INVALID CODE', companyEmail: 'bad' };
    const errors = validateStep(0, invalidForm);
    expect(errors['name']).toBeDefined();
    expect(errors['code']).toBeDefined();
    expect(errors['companyEmail']).toBeDefined();
  });

  it('catches step 1 errors immediately', () => {
    const invalidForm = { ...validFullForm, ownerFullName: '123', ownerMobile: '123' };
    const errors = validateStep(1, invalidForm);
    expect(errors['ownerFullName']).toBeDefined();
    expect(errors['ownerMobile']).toBeDefined();
  });

  it('catches step 4 errors immediately when entered', () => {
    const invalidForm = { ...validFullForm, gstin: 'D', pan: 'BAD-PAN' };
    const errors = validateStep(4, invalidForm);
    expect(errors['gstin']).toBe('GSTIN / Tax ID must be between 2 and 80 characters.');
    expect(errors['pan']).toBe('Enter a valid 10-character PAN (e.g. ABCDE1234F).');
  });

  it('finds lowest step index for any errors', () => {
    expect(getStepForField('name')).toBe(0);
    expect(getStepForField('ownerFullName')).toBe(1);
    expect(getStepForField('primaryPhone')).toBe(2);
    expect(getStepForField('city')).toBe(3);
    expect(getStepForField('gstin')).toBe(4);
    expect(getStepForField('currency')).toBe(5);

    expect(getStepForError({ city: 'Error', name: 'Error' }, 'create')).toBe(0);
    expect(getStepForError({ pan: 'Error', primaryPhone: 'Error' }, 'create')).toBe(2);
  });
});
