/**
 * Recruitment module frontend domain and entity types.
 *
 * Models the People / HR Recruitment domain:
 * Job Requisitions -> Candidates -> Screening -> Interviews -> Feedback ->
 * Selection / Rejection -> Offers -> Joining -> Existing Employee Module.
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
  readonly requisitionNumber: string;
  readonly title: string;
  readonly departmentId: string;
  readonly departmentName?: string | undefined;
  readonly positionId?: string | null | undefined;
  readonly positionName?: string | null | undefined;
  readonly openingsCount: number;
  readonly employmentType: EmploymentType;
  readonly location?: string | null | undefined;
  readonly description?: string | null | undefined;
  readonly requirements?: string | null | undefined;
  readonly status: RequisitionStatus;
  readonly targetHireDate?: string | null | undefined;
  readonly closedAt?: string | null | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateRequisitionInput {
  readonly title: string;
  readonly departmentId: string;
  readonly positionId?: string | null | undefined;
  readonly openingsCount: number;
  readonly employmentType: EmploymentType;
  readonly location?: string | null | undefined;
  readonly description?: string | null | undefined;
  readonly requirements?: string | null | undefined;
  readonly targetHireDate?: string | null | undefined;
  readonly status?: RequisitionStatus | undefined;
}

export interface RequisitionFilter {
  readonly search?: string | undefined;
  readonly status?: RequisitionStatus | 'all' | undefined;
  readonly departmentId?: string | undefined;
  readonly employmentType?: EmploymentType | 'all' | undefined;
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
  readonly requisitionId: string;
  readonly requisitionTitle?: string | undefined;
  readonly requisitionNumber?: string | undefined;
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName?: string | undefined;
  readonly email: string;
  readonly phone?: string | null | undefined;
  readonly resumeUrl?: string | null | undefined;
  readonly resumeObjectKey?: string | null | undefined;
  readonly resumeFileName?: string | null | undefined;
  readonly resumeMimeType?: string | null | undefined;
  readonly resumeSize?: number | null | undefined;
  readonly resumeUploadedAt?: string | null | undefined;
  readonly source: CandidateSource;
  readonly status: CandidateStatus;
  readonly screeningNotes?: string | null | undefined;
  readonly rejectionReason?: string | null | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateCandidateInput {
  readonly requisitionId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone?: string | null | undefined;
  readonly resumeUrl?: string | null | undefined;
  readonly resumeObjectKey?: string | null | undefined;
  readonly resumeFileName?: string | null | undefined;
  readonly resumeMimeType?: string | null | undefined;
  readonly resumeSize?: number | null | undefined;
  readonly resumeUploadedAt?: string | null | undefined;
  readonly source: CandidateSource;
  readonly screeningNotes?: string | null | undefined;
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
  readonly education?: Array<{ degree: string; institution?: string; year?: string }> | undefined;
  readonly experience?: Array<{ title: string; company?: string; duration?: string }> | undefined;
  readonly summary?: string | null | undefined;
  readonly rawTextPreview?: string | undefined;
}

export interface UpdateCandidateStatusInput {
  readonly status: CandidateStatus;
  readonly rejectionReason?: string | null | undefined;
}

export interface CandidateFilter {
  readonly search?: string | undefined;
  readonly status?: CandidateStatus | 'all' | undefined;
  readonly requisitionId?: string | undefined;
  readonly source?: CandidateSource | 'all' | undefined;
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
  readonly candidateId: string;
  readonly candidateName?: string | undefined;
  readonly candidateEmail?: string | undefined;
  readonly requisitionId: string;
  readonly requisitionTitle?: string | undefined;
  readonly stage: InterviewStage;
  readonly round: number;
  readonly interviewType: InterviewType;
  readonly scheduledAt: string;
  readonly durationMinutes: number;
  readonly locationOrLink?: string | null | undefined;
  readonly status: InterviewStatus;
  readonly notes?: string | null | undefined;
  readonly interviewerIds?: string[] | undefined;
  readonly interviewerNames?: string[] | undefined;
  readonly feedback?: InterviewFeedback[] | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScheduleInterviewInput {
  readonly candidateId: string;
  readonly requisitionId: string;
  readonly stage: InterviewStage;
  readonly round: number;
  readonly interviewType: InterviewType;
  readonly scheduledAt: string;
  readonly durationMinutes: number;
  readonly locationOrLink?: string | null | undefined;
  readonly interviewerIds: string[];
  readonly notes?: string | null | undefined;
}

export interface InterviewFilter {
  readonly search?: string | undefined;
  readonly status?: InterviewStatus | 'all' | undefined;
  readonly stage?: InterviewStage | 'all' | undefined;
  readonly candidateId?: string | undefined;
  readonly requisitionId?: string | undefined;
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
  readonly interviewId: string;
  readonly interviewerId: string;
  readonly interviewerName?: string | undefined;
  readonly recommendation: InterviewRecommendation;
  readonly rating?: number | null | undefined;
  readonly feedback: string;
  readonly strengths?: string | null | undefined;
  readonly areasForImprovement?: string | null | undefined;
  readonly submittedAt: string;
  readonly createdAt: string;
}

export interface SubmitFeedbackInput {
  readonly interviewerId: string;
  readonly recommendation: InterviewRecommendation;
  readonly rating?: number | null | undefined;
  readonly feedback: string;
  readonly strengths?: string | null | undefined;
  readonly areasForImprovement?: string | null | undefined;
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
  readonly candidateId: string;
  readonly candidateName?: string | undefined;
  readonly candidateEmail?: string | undefined;
  readonly requisitionId: string;
  readonly requisitionTitle?: string | undefined;
  readonly positionId?: string | null | undefined;
  readonly positionName?: string | null | undefined;
  readonly designationId?: string | null | undefined;
  readonly designationName?: string | null | undefined;
  readonly offeredSalary: number | string;
  readonly currency: string;
  readonly offerDate: string;
  readonly validUntil?: string | null | undefined;
  readonly expectedJoiningDate?: string | null | undefined;
  readonly status: OfferStatus;
  readonly notes?: string | null | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateOfferInput {
  readonly candidateId: string;
  readonly requisitionId: string;
  readonly positionId?: string | null | undefined;
  readonly designationId?: string | null | undefined;
  readonly offeredSalary: number | string;
  readonly currency: string;
  readonly offerDate: string;
  readonly validUntil?: string | null | undefined;
  readonly expectedJoiningDate?: string | null | undefined;
  readonly status?: OfferStatus | undefined;
  readonly notes?: string | null | undefined;
}

export interface OfferFilter {
  readonly search?: string | undefined;
  readonly status?: OfferStatus | 'all' | undefined;
  readonly candidateId?: string | undefined;
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
  readonly candidateId: string;
  readonly candidateName?: string | undefined;
  readonly candidateEmail?: string | undefined;
  readonly offerId: string;
  readonly expectedJoiningDate: string;
  readonly actualJoiningDate?: string | null | undefined;
  readonly status: JoiningStatus;
  readonly employeeId?: string | null | undefined;
  readonly notes?: string | null | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpdateJoiningStatusInput {
  readonly status: JoiningStatus;
  readonly actualJoiningDate?: string | null | undefined;
  readonly notes?: string | null | undefined;
}

export interface JoiningFilter {
  readonly search?: string | undefined;
  readonly status?: JoiningStatus | 'all' | undefined;
}

// ---------------------------------------------------------------------
// 7. Navigation Tabs
// ---------------------------------------------------------------------

export type RecruitmentTab =
  | 'overview'
  | 'requisitions'
  | 'resumes'
  | 'candidates'
  | 'interviews'
  | 'offers'
  | 'joining';

export interface RecruitmentMetrics {
  readonly openRequisitions: number;
  readonly activeCandidates: number;
  readonly candidatesInScreening: number;
  readonly upcomingInterviews: number;
  readonly offersPending: number;
  readonly joiningPending: number;
  readonly resumeSubmissionsCount?: number | undefined;
}

// ---------------------------------------------------------------------
// 8. Application Links
// ---------------------------------------------------------------------

export type ApplicationLinkStatus = 'active' | 'disabled' | 'expired';

export interface RecruitmentApplicationLink {
  readonly id: string;
  readonly token: string;
  readonly requisitionId: string;
  readonly requisitionTitle?: string | undefined;
  readonly requisitionNumber?: string | undefined;
  readonly expiresAt?: string | null | undefined;
  readonly status: ApplicationLinkStatus;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateApplicationLinkInput {
  readonly requisitionId: string;
  readonly expiresAt?: string | null | undefined;
  readonly status?: 'active' | 'disabled' | undefined;
}

export interface UpdateApplicationLinkStatusInput {
  readonly status: 'active' | 'disabled';
  readonly expiresAt?: string | null | undefined;
}

// ---------------------------------------------------------------------
// 9. Resume Intake & Parsing
// ---------------------------------------------------------------------

export type ResumeSubmissionStatus =
  | 'submitted'
  | 'reviewed'
  | 'converted'
  | 'rejected';

export type ResumeSubmissionSource = 'application_link' | 'hr_upload';

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

export interface ParsedResumeData {
  readonly name?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly skills: string[];
  readonly education?: ParsedResumeEducation[] | undefined;
  readonly experience?: ParsedResumeExperience[] | undefined;
  readonly summary?: string | null | undefined;
  readonly rawTextPreview?: string | undefined;
}

export interface CandidateResumeSubmission {
  readonly id: string;
  readonly applicationLinkId?: string | null | undefined;
  readonly requisitionId: string;
  readonly requisitionTitle?: string | undefined;
  readonly requisitionNumber?: string | undefined;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone?: string | null | undefined;
  readonly resumeFilePath: string;
  readonly resumeFileName: string;
  readonly resumeMimeType: string;
  readonly resumeFileSize: number;
  readonly parsedData?: ParsedResumeData | null | undefined;
  readonly status: ResumeSubmissionStatus;
  readonly rejectionReason?: string | null | undefined;
  readonly convertedCandidateId?: string | null | undefined;
  readonly convertedAt?: string | null | undefined;
  readonly source: ResumeSubmissionSource;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResumeSubmissionFilter {
  readonly search?: string | undefined;
  readonly status?: ResumeSubmissionStatus | 'all' | undefined;
  readonly requisitionId?: string | undefined;
}

export interface HrManualSubmissionInput {
  readonly requisitionId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone?: string | null | undefined;
  readonly resumeBase64: string;
  readonly resumeFilename: string;
  readonly resumeMimeType?: string | undefined;
  readonly parsedData?: Record<string, unknown> | undefined;
}

export interface ConvertSubmissionInput {
  readonly source?: CandidateSource | undefined;
  readonly screeningNotes?: string | null | undefined;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly email?: string | undefined;
  readonly phone?: string | null | undefined;
}

export interface PublicJobRequisitionDetails {
  readonly id: string;
  readonly requisitionNumber: string;
  readonly title: string;
  readonly departmentName?: string | null | undefined;
  readonly openingsCount: number;
  readonly employmentType: EmploymentType;
  readonly location?: string | null | undefined;
  readonly description?: string | null | undefined;
  readonly requirements?: string | null | undefined;
}

export interface PublicApplyInput {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone?: string | null | undefined;
  readonly resumeBase64: string;
  readonly resumeFilename: string;
  readonly resumeMimeType?: string | undefined;
}

// ---------------------------------------------------------------------
// 10. Reschedule, Decision & Hiring
// ---------------------------------------------------------------------

export interface RescheduleInterviewInput {
  readonly scheduledAt: string;
  readonly durationMinutes?: number | undefined;
  readonly locationOrLink?: string | null | undefined;
  readonly notes?: string | null | undefined;
  readonly interviewerIds?: string[] | undefined;
}

export interface InterviewDecisionInput {
  readonly decision: 'accepted' | 'rejected';
  readonly rejectionReason?: string | null | undefined;
  readonly notes?: string | null | undefined;
}

export interface HireCandidateInput {
  readonly password?: string | undefined;
  readonly teamId?: string | null | undefined;
  readonly reportsTo?: string | null | undefined;
  readonly specialization?: string | null | undefined;
  readonly actualJoiningDate?: string | undefined;
}
