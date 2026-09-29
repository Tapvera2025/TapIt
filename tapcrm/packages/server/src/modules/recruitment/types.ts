import type { Decimal, CurrencyCode } from '@tapcrm/contracts';

/**
 * Recruitment module domain and entity types.
 *
 * Defines the core database entity and lifecycle types for the People / HR
 * Recruitment domain: Job Requisitions, Candidates, Interviews, Panels,
 * Feedback, Job Offers, and Joining.
 */

// ---------------------------------------------------------------------
// 1. Requisitions
// ---------------------------------------------------------------------

export type RequisitionStatus =
  | 'draft'
  | 'open'
  | 'on_hold'
  | 'filled'
  | 'closed'
  | 'cancelled';

export type EmploymentType =
  | 'full_time'
  | 'part_time'
  | 'contract'
  | 'internship';

export interface JobRequisition {
  readonly id: string;
  readonly organizationId: string;
  readonly requisitionNumber: string;
  readonly title: string;
  readonly departmentId: string;
  readonly departmentName?: string;
  readonly positionId: string | null;
  readonly positionName?: string | null;
  readonly openingsCount: number;
  readonly employmentType: EmploymentType;
  readonly location: string | null;
  readonly description: string | null;
  readonly requirements: string | null;
  readonly status: RequisitionStatus;
  readonly targetHireDate: Date | string | null;
  readonly closedAt: Date | string | null;
  readonly createdBy: string;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

// ---------------------------------------------------------------------
// 2. Candidates
// ---------------------------------------------------------------------

export type CandidateStatus =
  | 'applied'
  | 'screening'
  | 'interview'
  | 'selected'
  | 'rejected'
  | 'withdrawn';

export type CandidateSource =
  | 'direct'
  | 'referral'
  | 'career_site'
  | 'job_board'
  | 'agency'
  | 'linkedin'
  | 'internal'
  | 'other';

export interface Candidate {
  readonly id: string;
  readonly organizationId: string;
  readonly requisitionId: string;
  readonly requisitionTitle?: string;
  readonly requisitionNumber?: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName?: string;
  readonly email: string;
  readonly phone: string | null;
  readonly resumeUrl: string | null;
  readonly resumeObjectKey?: string | null;
  readonly resumeFileName?: string | null;
  readonly resumeMimeType?: string | null;
  readonly resumeSize?: number | null;
  readonly resumeUploadedAt?: Date | string | null;
  readonly source: CandidateSource;
  readonly status: CandidateStatus;
  readonly screeningNotes: string | null;
  readonly rejectionReason: string | null;
  readonly createdBy: string | null;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

export interface UploadCandidateResumeResult {
  readonly resumeObjectKey: string;
  readonly resumeFileName: string;
  readonly resumeMimeType: string;
  readonly resumeSize: number;
  readonly resumeUploadedAt: string;
  readonly previewUrl: string;
}

export interface ParsedCandidateData {
  readonly name: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly skills: string[];
  readonly education?: ParsedResumeEducation[] | undefined;
  readonly experience?: ParsedResumeExperience[] | undefined;
  readonly summary?: string | null | undefined;
  readonly rawTextPreview?: string | undefined;
}

// ---------------------------------------------------------------------
// 3. Interviews & Panel
// ---------------------------------------------------------------------

export type InterviewStage =
  | 'screening'
  | 'technical'
  | 'managerial'
  | 'hr'
  | 'final';

export type InterviewType = 'in_person' | 'video' | 'phone';

export type InterviewStatus =
  | 'scheduled'
  | 'completed'
  | 'cancelled'
  | 'rescheduled'
  | 'no_show';

export interface Interview {
  readonly id: string;
  readonly organizationId: string;
  readonly candidateId: string;
  readonly candidateName?: string;
  readonly candidateEmail?: string;
  readonly requisitionId: string;
  readonly requisitionTitle?: string;
  readonly stage: InterviewStage;
  readonly round: number;
  readonly interviewType: InterviewType;
  readonly scheduledAt: Date | string;
  readonly durationMinutes: number;
  readonly locationOrLink: string | null;
  readonly status: InterviewStatus;
  readonly notes: string | null;
  readonly interviewerIds?: string[];
  readonly interviewerNames?: string[];
  readonly feedback?: InterviewFeedback[];
  readonly createdBy: string;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

export interface InterviewInterviewer {
  readonly organizationId: string;
  readonly interviewId: string;
  readonly userId: string;
  readonly assignedAt: Date | string;
  readonly assignedBy: string;
}

// ---------------------------------------------------------------------
// 4. Feedback
// ---------------------------------------------------------------------

export type InterviewRecommendation =
  | 'strong_hire'
  | 'hire'
  | 'no_hire'
  | 'strong_no_hire'
  | 'hold';

export interface InterviewFeedback {
  readonly id: string;
  readonly organizationId: string;
  readonly interviewId: string;
  readonly interviewerId: string;
  readonly interviewerName?: string;
  readonly recommendation: InterviewRecommendation;
  readonly rating: number | null;
  readonly feedback: string;
  readonly strengths: string | null;
  readonly areasForImprovement: string | null;
  readonly submittedAt: Date | string;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

// ---------------------------------------------------------------------
// 5. Offers
// ---------------------------------------------------------------------

export type OfferStatus =
  | 'draft'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'withdrawn';

export interface JobOffer {
  readonly id: string;
  readonly organizationId: string;
  readonly candidateId: string;
  readonly candidateName?: string;
  readonly candidateEmail?: string;
  readonly requisitionId: string;
  readonly requisitionTitle?: string;
  readonly positionId: string | null;
  readonly positionName?: string | null;
  readonly designationId: string | null;
  readonly designationName?: string | null;
  readonly offeredSalary: Decimal | string;
  readonly currency: CurrencyCode;
  readonly offerDate: Date | string;
  readonly validUntil: Date | string | null;
  readonly expectedJoiningDate: Date | string | null;
  readonly status: OfferStatus;
  readonly notes: string | null;
  readonly createdBy: string;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

// ---------------------------------------------------------------------
// 6. Joining
// ---------------------------------------------------------------------

export type JoiningStatus =
  | 'pending'
  | 'confirmed'
  | 'joined'
  | 'cancelled';

export interface CandidateJoining {
  readonly id: string;
  readonly organizationId: string;
  readonly candidateId: string;
  readonly candidateName?: string;
  readonly candidateEmail?: string;
  readonly offerId: string;
  readonly expectedJoiningDate: Date | string;
  readonly actualJoiningDate: Date | string | null;
  readonly status: JoiningStatus;
  readonly employeeId: string | null;
  readonly notes: string | null;
  readonly createdBy: string;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

// ---------------------------------------------------------------------
// 7. Metrics
// ---------------------------------------------------------------------

export interface RecruitmentMetrics {
  readonly openRequisitions: number;
  readonly activeCandidates: number;
  readonly candidatesInScreening: number;
  readonly upcomingInterviews: number;
  readonly offersPending: number;
  readonly joiningPending: number;
}

// ---------------------------------------------------------------------
// 8. Application Links
// ---------------------------------------------------------------------

export type ApplicationLinkStatus = 'active' | 'disabled' | 'expired';

export interface RecruitmentApplicationLink {
  readonly id: string;
  readonly organizationId: string;
  readonly requisitionId: string;
  readonly requisitionTitle?: string;
  readonly requisitionNumber?: string;
  readonly token: string;
  readonly status: ApplicationLinkStatus;
  readonly expiresAt: Date | string | null;
  readonly createdBy: string;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

// ---------------------------------------------------------------------
// 9. Resume Submissions & Parsed Data
// ---------------------------------------------------------------------

export type ResumeSubmissionStatus =
  | 'submitted'
  | 'reviewed'
  | 'converted'
  | 'rejected';

export interface ParsedResumeEducation {
  readonly degree?: string | undefined;
  readonly institution?: string | undefined;
  readonly year?: string | undefined;
}

export interface ParsedResumeExperience {
  readonly title?: string | undefined;
  readonly company?: string | undefined;
  readonly duration?: string | undefined;
}

export interface ParsedResumeProject {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
}

export interface ParsedResumeData {
  readonly name?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly skills?: string[] | undefined;
  readonly education?: ParsedResumeEducation[] | undefined;
  readonly experience?: ParsedResumeExperience[] | undefined;
  readonly projects?: ParsedResumeProject[] | undefined;
  readonly summary?: string | null | undefined;
  readonly rawTextPreview?: string | undefined;
}

export interface CandidateResumeSubmission {
  readonly id: string;
  readonly organizationId: string;
  readonly requisitionId: string;
  readonly requisitionTitle?: string | undefined;
  readonly requisitionNumber?: string | undefined;
  readonly applicationLinkId: string | null;
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName?: string | undefined;
  readonly email: string;
  readonly phone: string | null;
  readonly resumeObjectKey: string;
  readonly resumeFilename: string;
  readonly resumeMimeType: string;
  readonly resumeFileSize: number;
  readonly parsedData: ParsedResumeData;
  readonly status: ResumeSubmissionStatus;
  readonly candidateId: string | null;
  readonly rejectionReason: string | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: Date | string | null;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

// ---------------------------------------------------------------------
// 10. Public Application Form Info
// ---------------------------------------------------------------------

export interface PublicJobRequisitionDetails {
  readonly title: string;
  readonly requisitionNumber: string;
  readonly employmentType: EmploymentType;
  readonly departmentName?: string | null | undefined;
  readonly location: string | null;
  readonly description: string | null;
  readonly requirements: string | null;
}

