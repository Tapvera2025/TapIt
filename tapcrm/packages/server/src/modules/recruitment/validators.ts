import { z } from 'zod';

export const requisitionStatusSchema = z.enum([
  'draft',
  'open',
  'on_hold',
  'filled',
  'closed',
  'cancelled',
]);

export const employmentTypeSchema = z.enum([
  'full_time',
  'part_time',
  'contract',
  'internship',
]);

export const createRequisitionSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(255),
  departmentId: z.string().uuid('Invalid department ID'),
  positionId: z.string().uuid().optional().nullable(),
  openingsCount: z.coerce.number().int().min(1).default(1),
  employmentType: employmentTypeSchema.default('full_time'),
  location: z.string().trim().max(255).optional().nullable(),
  description: z.string().trim().max(10000).optional().nullable(),
  requirements: z.string().trim().max(10000).optional().nullable(),
  targetHireDate: z.string().trim().optional().nullable(),
  status: requisitionStatusSchema.optional().default('draft'),
});

export const updateRequisitionStatusSchema = z.object({
  status: requisitionStatusSchema,
});

export const candidateStatusSchema = z.enum([
  'applied',
  'screening',
  'interview',
  'selected',
  'rejected',
  'withdrawn',
]);

export const candidateSourceSchema = z.enum([
  'direct',
  'referral',
  'career_site',
  'job_board',
  'agency',
  'linkedin',
  'internal',
  'other',
]);

export const createCandidateSchema = z.object({
  requisitionId: z.string().uuid('Invalid requisition ID'),
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  email: z.string().trim().email('Invalid email address').max(255),
  phone: z.string().trim().max(50).optional().nullable(),
  resumeUrl: z.string().trim().max(2048).optional().nullable(),
  resumeObjectKey: z.string().trim().max(1024).optional().nullable(),
  resumeFileName: z.string().trim().max(255).optional().nullable(),
  resumeMimeType: z.string().trim().max(100).optional().nullable(),
  resumeSize: z.coerce.number().int().nonnegative().optional().nullable(),
  resumeUploadedAt: z.string().trim().optional().nullable(),
  source: candidateSourceSchema.default('direct'),
  screeningNotes: z.string().trim().max(5000).optional().nullable(),
});

export const uploadCandidateResumeSchema = z.object({
  filename: z.string().trim().min(1, 'Filename is required').max(255),
  mimeType: z.string().trim().default('application/pdf'),
  fileBase64: z.string().min(1, 'File content is required'),
  requisitionId: z.string().uuid().optional(),
});

export const parseCandidateResumeSchema = z.object({
  resumeObjectKey: z.string().trim().min(1).optional(),
  fileBase64: z.string().min(1).optional(),
  filename: z.string().trim().min(1).max(255).default('resume.pdf'),
  mimeType: z.string().trim().default('application/pdf'),
});

export const updateCandidateStatusSchema = z.object({
  status: candidateStatusSchema,
  rejectionReason: z.string().trim().max(2000).optional().nullable(),
});

export const updateCandidateScreeningSchema = z.object({
  screeningNotes: z.string().trim().max(5000),
});

export const interviewStageSchema = z.enum([
  'screening',
  'technical',
  'managerial',
  'hr',
  'final',
]);

export const interviewTypeSchema = z.enum(['in_person', 'video', 'phone']);

export const interviewStatusSchema = z.enum([
  'scheduled',
  'completed',
  'cancelled',
  'rescheduled',
  'no_show',
]);

export const scheduleInterviewSchema = z.object({
  candidateId: z.string().uuid('Invalid candidate ID'),
  requisitionId: z.string().uuid('Invalid requisition ID'),
  stage: interviewStageSchema,
  round: z.coerce.number().int().min(1).default(1),
  interviewType: interviewTypeSchema.default('video'),
  scheduledAt: z.string().trim().min(1, 'Schedule date/time is required'),
  durationMinutes: z.coerce.number().int().min(5).max(480).default(60),
  locationOrLink: z.string().trim().max(1024).optional().nullable(),
  interviewerIds: z.array(z.string().uuid()).default([]),
  notes: z.string().trim().max(5000).optional().nullable(),
});

export const updateInterviewStatusSchema = z.object({
  status: interviewStatusSchema,
});

export const interviewRecommendationSchema = z.enum([
  'strong_hire',
  'hire',
  'no_hire',
  'strong_no_hire',
  'hold',
]);

export const submitFeedbackSchema = z.object({
  interviewerId: z.string().uuid('Invalid interviewer ID'),
  recommendation: interviewRecommendationSchema,
  rating: z.coerce.number().int().min(1).max(5).optional().nullable(),
  feedback: z.string().trim().min(1, 'Feedback is required').max(10000),
  strengths: z.string().trim().max(5000).optional().nullable(),
  areasForImprovement: z.string().trim().max(5000).optional().nullable(),
});

export const updateFeedbackSchema = z.object({
  interviewerId: z.string().uuid('Invalid interviewer ID').optional(),
  recommendation: interviewRecommendationSchema.optional(),
  rating: z.coerce.number().int().min(1).max(5).optional().nullable(),
  feedback: z.string().trim().min(1, 'Feedback is required').max(10000).optional(),
  strengths: z.string().trim().max(5000).optional().nullable(),
  areasForImprovement: z.string().trim().max(5000).optional().nullable(),
});

export const offerStatusSchema = z.enum([
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'withdrawn',
]);

export const createOfferSchema = z.object({
  candidateId: z.string().uuid('Invalid candidate ID'),
  requisitionId: z.string().uuid('Invalid requisition ID'),
  positionId: z.string().uuid().optional().nullable(),
  designationId: z.string().uuid().optional().nullable(),
  offeredSalary: z.union([z.string().trim().min(1), z.number()]).transform((v) => String(v)),
  currency: z.string().trim().min(3).max(3).default('INR'),
  offerDate: z.string().trim().optional().nullable(),
  validUntil: z.string().trim().optional().nullable(),
  expectedJoiningDate: z.string().trim().optional().nullable(),
  status: offerStatusSchema.optional().default('draft'),
  notes: z.string().trim().max(5000).optional().nullable(),
});

export const updateOfferStatusSchema = z.object({
  status: offerStatusSchema,
});

export const updateOfferSchema = z.object({
  candidateId: z.string().uuid('Invalid candidate ID').optional(),
  requisitionId: z.string().uuid('Invalid requisition ID').optional(),
  positionId: z.string().uuid().optional().nullable(),
  designationId: z.string().uuid().optional().nullable(),
  offeredSalary: z.union([z.string().trim().min(1), z.number()]).transform((v) => String(v)).optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  offerDate: z.string().trim().optional().nullable(),
  validUntil: z.string().trim().optional().nullable(),
  expectedJoiningDate: z.string().trim().optional().nullable(),
  status: offerStatusSchema.optional(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

export const joiningStatusSchema = z.enum([
  'pending',
  'confirmed',
  'joined',
  'cancelled',
]);

export const createJoiningSchema = z.object({
  candidateId: z.string().uuid('Invalid candidate ID'),
  offerId: z.string().uuid('Invalid offer ID'),
  expectedJoiningDate: z.string().trim().min(1, 'Expected joining date is required'),
  status: joiningStatusSchema.optional().default('pending'),
  notes: z.string().trim().max(5000).optional().nullable(),
});

export const updateJoiningStatusSchema = z.object({
  status: joiningStatusSchema,
  actualJoiningDate: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

export const updateJoiningSchema = z.object({
  candidateId: z.string().uuid('Invalid candidate ID').optional(),
  offerId: z.string().uuid('Invalid offer ID').optional(),
  expectedJoiningDate: z.string().trim().optional(),
  status: joiningStatusSchema.optional(),
  actualJoiningDate: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

// ---------------------------------------------------------------------
// 6. Application Links & Resumes
// ---------------------------------------------------------------------

export const applicationLinkStatusSchema = z.enum(['active', 'disabled', 'expired']);

export const createApplicationLinkSchema = z.object({
  requisitionId: z.string().uuid('Invalid requisition ID'),
  expiresAt: z.string().trim().datetime().optional().nullable(),
  status: z.enum(['active', 'disabled']).optional().default('active'),
});

export const updateApplicationLinkStatusSchema = z.object({
  status: applicationLinkStatusSchema,
  expiresAt: z.string().trim().datetime().optional().nullable(),
});

export const publicApplySchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  email: z.string().trim().email('Invalid email address').max(255),
  phone: z.string().trim().max(50).optional().nullable(),
  resumeBase64: z.string().min(1, 'Resume file is required'),
  resumeFilename: z.string().trim().min(1, 'Resume filename is required').max(255),
  resumeMimeType: z.string().trim().default('application/pdf'),
});

export const hrManualSubmissionSchema = z.object({
  requisitionId: z.string().uuid('Invalid requisition ID'),
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  email: z.string().trim().email('Invalid email address').max(255),
  phone: z.string().trim().max(50).optional().nullable(),
  resumeBase64: z.string().min(1, 'Resume file is required'),
  resumeFilename: z.string().trim().min(1, 'Resume filename is required').max(255),
  resumeMimeType: z.string().trim().default('application/pdf'),
  parsedData: z.record(z.unknown()).optional(),
});

export const resumeSubmissionStatusSchema = z.enum([
  'submitted',
  'reviewed',
  'converted',
  'rejected',
]);

export const updateSubmissionStatusSchema = z.object({
  status: z.enum(['submitted', 'reviewed', 'rejected']),
  rejectionReason: z.string().trim().max(2000).optional().nullable(),
});

export const convertSubmissionSchema = z.object({
  source: candidateSourceSchema.optional().default('career_site'),
  screeningNotes: z.string().trim().max(5000).optional().nullable(),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().max(255).optional(),
  phone: z.string().trim().max(50).optional().nullable(),
});

// ---------------------------------------------------------------------
// 7. Interview Reschedule & Decision
// ---------------------------------------------------------------------

export const rescheduleInterviewSchema = z.object({
  scheduledAt: z.string().trim().min(1, 'New scheduled date/time is required'),
  durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
  locationOrLink: z.string().trim().max(1024).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  interviewerIds: z.array(z.string().uuid()).optional(),
});

export const interviewDecisionSchema = z.object({
  decision: z.enum(['accepted', 'rejected']),
  rejectionReason: z.string().trim().max(2000).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

// ---------------------------------------------------------------------
// 8. Hiring
// ---------------------------------------------------------------------

export const hireCandidateSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  teamId: z.string().uuid('Invalid team ID').optional().nullable(),
  reportsTo: z.string().uuid('Invalid manager ID').optional().nullable(),
  specialization: z.string().trim().max(100).optional().nullable(),
  actualJoiningDate: z.string().trim().optional(),
});

export type CreateRequisitionInput = z.infer<typeof createRequisitionSchema>;
export type UpdateRequisitionStatusInput = z.infer<typeof updateRequisitionStatusSchema>;
export type CreateCandidateInput = z.infer<typeof createCandidateSchema>;
export type UpdateCandidateStatusInput = z.infer<typeof updateCandidateStatusSchema>;
export type UpdateCandidateScreeningInput = z.infer<typeof updateCandidateScreeningSchema>;
export type ScheduleInterviewInput = z.infer<typeof scheduleInterviewSchema>;
export type UpdateInterviewStatusInput = z.infer<typeof updateInterviewStatusSchema>;
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>;
export type UpdateFeedbackInput = z.infer<typeof updateFeedbackSchema>;
export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type UpdateOfferStatusInput = z.infer<typeof updateOfferStatusSchema>;
export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;
export type CreateJoiningInput = z.infer<typeof createJoiningSchema>;
export type UpdateJoiningStatusInput = z.infer<typeof updateJoiningStatusSchema>;
export type UpdateJoiningInput = z.infer<typeof updateJoiningSchema>;
export type CreateApplicationLinkInput = z.infer<typeof createApplicationLinkSchema>;
export type UpdateApplicationLinkStatusInput = z.infer<typeof updateApplicationLinkStatusSchema>;
export type PublicApplyInput = z.infer<typeof publicApplySchema>;
export type HrManualSubmissionInput = z.infer<typeof hrManualSubmissionSchema>;
export type UpdateSubmissionStatusInput = z.infer<typeof updateSubmissionStatusSchema>;
export type ConvertSubmissionInput = z.infer<typeof convertSubmissionSchema>;
export type RescheduleInterviewInput = z.infer<typeof rescheduleInterviewSchema>;
export type InterviewDecisionInput = z.infer<typeof interviewDecisionSchema>;
export type HireCandidateInput = z.infer<typeof hireCandidateSchema>;
export type UploadCandidateResumeInput = z.infer<typeof uploadCandidateResumeSchema>;
export type ParseCandidateResumeInput = z.infer<typeof parseCandidateResumeSchema>;
