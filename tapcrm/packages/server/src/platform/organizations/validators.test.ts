import { describe, it, expect } from 'vitest';
import { createOrganizationSchema, updateOrganizationSchema } from './validators.js';

describe('Organization Validators', () => {
  const validPayload = {
    name: 'TapCRM Technologies',
    code: 'TAP001',
    legalCompanyName: 'TapCRM Technologies Pvt Ltd',
    companyType: 'Private' as const,
    industry: 'IT / Software' as const,
    website: 'https://tapcrm.com',
    companyEmail: 'contact@tapcrm.com',
    adminEmail: 'admin@tapcrm.com',
    ownerFullName: 'John Doe',
    ownerDesignation: 'Founder & CEO',
    ownerMobile: '+91 9876543210',
    ownerAlternateNumber: '+91 9876543211',
    primaryPhone: '+91 9876543212',
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
    modules: ['employee-directory'],
  };

  it('validates a correct create organization payload', () => {
    const parsed = createOrganizationSchema.parse(validPayload);
    expect(parsed.name).toBe('TapCRM Technologies');
    expect(parsed.code).toBe('TAP001');
    expect(parsed.gstin).toBe('29AAAAA0000A1Z5');
  });

  it('allows empty optional fields', () => {
    const minimalPayload = {
      ...validPayload,
      legalCompanyName: '',
      website: '',
      ownerDesignation: '',
      ownerAlternateNumber: '',
      alternatePhone: '',
      supportEmail: '',
      addressLine2: '',
      gstin: '',
      pan: '',
      registrationNumber: '',
      modules: [],
    };
    const parsed = createOrganizationSchema.parse(minimalPayload);
    expect(parsed.gstin).toBe('');
    expect(parsed.pan).toBe('');
    expect(parsed.website).toBe('');
  });

  it('accepts international Tax ID and Indian GSTIN', () => {
    const germanPayload = { ...validPayload, gstin: 'DE311653556' };
    const parsed = createOrganizationSchema.parse(germanPayload);
    expect(parsed.gstin).toBe('DE311653556');

    const usPayload = { ...validPayload, gstin: '12-3456789' };
    expect(createOrganizationSchema.parse(usPayload).gstin).toBe('12-3456789');
  });

  it('rejects invalid GSTIN / Tax ID when provided', () => {
    expect(() =>
      createOrganizationSchema.parse({ ...validPayload, gstin: 'D' }),
    ).toThrow();
    expect(() =>
      createOrganizationSchema.parse({ ...validPayload, gstin: 'DE@311653556' }),
    ).toThrow();
  });

  it('rejects invalid PAN when provided', () => {
    expect(() =>
      createOrganizationSchema.parse({ ...validPayload, pan: 'INVALID' }),
    ).toThrow();
  });

  it('rejects invalid company code', () => {
    expect(() =>
      createOrganizationSchema.parse({ ...validPayload, code: 'INVALID CODE' }),
    ).toThrow();
  });

  it('rejects invalid phone numbers', () => {
    expect(() =>
      createOrganizationSchema.parse({ ...validPayload, ownerMobile: '12345' }),
    ).toThrow();
  });

  it('validates update organization payload', () => {
    const { modules: _, ...updatePayload } = validPayload;
    const parsed = updateOrganizationSchema.parse(updatePayload);
    expect(parsed.name).toBe('TapCRM Technologies');
  });
});

