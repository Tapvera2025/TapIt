import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).default('');
const requiredText = (min: number, max: number) => z.string().trim().min(min).max(max);
const phoneNumber = z.string().trim().regex(/^\+[1-9]\d{0,2} \d{10}$/, 'Use a country code and 10-digit number, for example +91 9876543210');
const optionalPhoneNumber = z.union([phoneNumber, z.literal('')]).default('');

const taxIdRegex = /^[A-Za-z0-9\s/.-]{2,80}$/;
const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i;
const optionalGstin = z
  .union([
    z.string().trim().min(2).max(80).regex(taxIdRegex, 'Enter a valid GSTIN / Tax ID'),
    z.literal(''),
  ])
  .default('');
const optionalPan = z.union([z.string().trim().regex(panRegex, 'Enter a valid 10-character PAN'), z.literal('')]).default('');

const organizationFieldsSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/i),
  legalCompanyName: optionalText(160),
  companyType: z.enum(['Private', 'Public', 'Partnership', 'LLC', 'Other']).default('Private'),
  industry: z.enum(['IT / Software', 'Finance', 'Healthcare', 'Education', 'Retail', 'Manufacturing', 'Other']).default('IT / Software'),
  website: z.union([z.string().trim().url().max(500), z.literal('')]).default(''),
  companyEmail: z.string().trim().email().max(320),
  ownerFullName: requiredText(2, 160),
  ownerDesignation: optionalText(120),
  ownerMobile: phoneNumber,
  ownerAlternateNumber: optionalPhoneNumber,
  primaryPhone: phoneNumber,
  alternatePhone: optionalPhoneNumber,
  supportEmail: z.union([z.string().trim().email().max(320), z.literal('')]).default(''),
  addressLine1: requiredText(2, 240),
  addressLine2: optionalText(240),
  city: requiredText(2, 120),
  state: requiredText(2, 120),
  country: requiredText(2, 120),
  postalCode: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9][A-Za-z0-9 -]{2,31}$/, 'Enter a valid postal code'),
  gstin: optionalGstin,
  pan: optionalPan,
  registrationNumber: optionalText(120),
  timezone: z.string().trim().min(1).max(64).default('Asia/Kolkata'),
  currency: z.string().trim().length(3).default('INR'),
});

export const createOrganizationSchema = organizationFieldsSchema.extend({
  adminEmail: z.string().trim().email().max(320),
  modules: z.array(z.string()).default([]),
});

export const updateOrganizationSchema = organizationFieldsSchema.extend({
  adminEmail: z.string().trim().email().max(320),
});
