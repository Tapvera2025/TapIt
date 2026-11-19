import { z } from 'zod';
import { toDateOnly } from '../../platform/time.js';
import { VERIFICATION_DOCUMENT_TYPES } from '../verification/facade.js';

/**
 * Bodies for the employee's own profile (`/api/my-profile/...`).
 *
 * Optional text: omitted keeps the stored value, `null` or an empty string
 * clears it. Every section is saved on its own, so an employee can stop and
 * come back later without losing what they already entered.
 */

const date = z.string().transform((value, ctx) => {
  try {
    return toDateOnly(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected a date, YYYY-MM-DD' });
    return z.NEVER;
  }
});

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value === null || value === '' ? null : value));

/** Digits with an optional leading +, spaces and hyphens; 7 to 15 digits in all. */
const phone = z
  .string()
  .trim()
  .max(30)
  .refine(
    (value) => {
      if (value === '') return true;
      if (!/^\+?[0-9\s-]+$/.test(value)) return false;
      const digits = value.replace(/\D/g, '').length;
      return digits >= 7 && digits <= 15;
    },
    { message: 'Enter a valid phone number (7 to 15 digits)' },
  )
  .nullable()
  .optional()
  .transform((value) => (value === undefined ? undefined : value === null || value === '' ? null : value));

export const personalDetailsSchema = z
  .object({
    phone,
    dateOfBirth: date.nullable().optional(),
    gender: optionalText(30),
    addressLine1: optionalText(255),
    addressLine2: optionalText(255),
    city: optionalText(100),
    state: optionalText(100),
    postalCode: z
      .string()
      .trim()
      .max(20)
      .refine((value) => value === '' || /^[A-Za-z0-9 -]{3,20}$/.test(value), {
        message: 'Enter a valid postal code',
      })
      .nullable()
      .optional()
      .transform((value) => (value === undefined ? undefined : value === null || value === '' ? null : value)),
    emergencyContactName: optionalText(160),
    emergencyContactPhone: phone,
    emergencyContactRelation: optionalText(60),
  })
  .strict();

export type PersonalDetailsInput = z.infer<typeof personalDetailsSchema>;

export const qualificationsSchema = z
  .object({
    qualifications: z
      .array(
        z
          .object({
            institution: z.string().trim().min(1).max(255),
            degree: z.string().trim().min(1).max(160),
            fieldOfStudy: optionalText(160),
            passingYear: z.number().int().min(1950).max(2100).nullable().optional(),
            grade: optionalText(50),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

export type QualificationsInput = z.infer<typeof qualificationsSchema>;

export const experienceSchema = z
  .object({
    /** "This is my first job": no previous employer, so no experience entries. */
    noPriorExperience: z.boolean(),
    entries: z
      .array(
        z
          .object({
            companyName: z.string().trim().min(1).max(160),
            jobTitle: z.string().trim().min(1).max(160),
            startDate: date,
            /** Omitted or null: still working there. */
            endDate: date.nullable().optional(),
            description: optionalText(1000),
          })
          .strict()
          .refine((entry) => !entry.endDate || entry.endDate >= entry.startDate, {
            message: 'The end date cannot be before the start date',
            path: ['endDate'],
          }),
      )
      .max(20),
  })
  .strict()
  .refine((value) => !(value.noPriorExperience && value.entries.length > 0), {
    message: 'Remove the experience entries, or untick "This is my first job"',
    path: ['entries'],
  });

export type ExperienceInput = z.infer<typeof experienceSchema>;

export const skillsSchema = z
  .object({
    skills: z
      .array(
        z
          .object({
            skillName: z.string().trim().min(1).max(100),
            proficiency: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).nullable().optional(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export type SkillsInput = z.infer<typeof skillsSchema>;

/** One document at a time keeps each request well under the 15 MB body limit. */
export const ownDocumentUploadSchema = z
  .object({
    documentType: z.enum(VERIFICATION_DOCUMENT_TYPES),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(100),
    fileBase64: z.string().min(1),
  })
  .strict();

export type OwnDocumentUploadInput = z.infer<typeof ownDocumentUploadSchema>;
