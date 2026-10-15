import type { AtsScanSummary, ParsedResumeData } from '@tapcrm/contracts';

export type {
  ParsedCandidateData,
  ParsedResumeData,
  ParsedResumeEducation,
  ParsedResumeExperience,
} from '@tapcrm/contracts';

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
  readonly interviewerId?: string | undefined;
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
  readonly joiningEmailSentAt?: string | null | undefined;
  readonly joiningEmailTemplateId?: string | null | undefined;
  readonly acknowledgeToken?: string | null | undefined;
  readonly acknowledgedAt?: string | null | undefined;
  readonly acknowledgeIp?: string | null | undefined;
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
  | 'joining'
  | 'my-interviews'
  | 'email-templates';

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

export interface CandidateResumeSubmission {
  readonly id: string;
  /** Set when the candidate applied through a public application link. */
  readonly applicationLinkId?: string | null | undefined;
  readonly requisitionId: string;
  readonly requisitionTitle?: string | undefined;
  readonly requisitionNumber?: string | undefined;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone?: string | null | undefined;
  readonly resumeFilename: string;
  readonly resumeMimeType: string;
  readonly resumeFileSize: number;
  readonly parsedData?: ParsedResumeData | null | undefined;
  readonly status: ResumeSubmissionStatus;
  readonly rejectionReason?: string | null | undefined;
  readonly candidateId?: string | null | undefined;
  readonly reviewedAt?: string | null | undefined;
  /** Latest ATS screening result. Present on Resume Inbox list rows. */
  readonly ats?: AtsScanSummary | null | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** How the resume reached HR: through a public application link or an HR upload. */
export function submissionSource(submission: Pick<CandidateResumeSubmission, 'applicationLinkId'>): ResumeSubmissionSource {
  return submission.applicationLinkId ? 'application_link' : 'hr_upload';
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

// ---------------------------------------------------------------------
// 11. Pipeline Rounds (new — revamp)
// ---------------------------------------------------------------------

export type PipelineRoundMode = 'online' | 'offline' | 'phone';

export interface PipelineRound {
  readonly id: string;
  readonly requisitionId: string;
  readonly name: string;
  readonly mode: PipelineRoundMode;
  readonly orderIndex: number;
  readonly interviewerNote?: string | null | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreatePipelineRoundInput {
  readonly requisitionId: string;
  readonly name: string;
  readonly mode: PipelineRoundMode;
  readonly orderIndex: number;
  readonly interviewerNote?: string | null | undefined;
}

export interface UpdatePipelineRoundInput {
  readonly name?: string | undefined;
  readonly mode?: PipelineRoundMode | undefined;
  readonly orderIndex?: number | undefined;
  readonly interviewerNote?: string | null | undefined;
}

export interface ReorderPipelineRoundsInput {
  readonly rounds: ReadonlyArray<{ readonly id: string; readonly orderIndex: number }>;
}

// ---------------------------------------------------------------------
// 12. Candidate Rounds (new — revamp)
// ---------------------------------------------------------------------

export type CandidateRoundStatus =
  | 'pending'
  | 'scheduled'
  | 'completed'
  | 'passed'
  | 'failed'
  | 'skipped';

export type RoundRecommendation = 'pass' | 'fail' | 'hold';

export interface CandidateRound {
  readonly id: string;
  readonly candidateId: string;
  readonly pipelineRoundId: string;
  readonly pipelineRoundName?: string | undefined;
  readonly pipelineRoundOrder?: number | undefined;
  readonly assignedTo?: string | null | undefined;
  readonly assignedToName?: string | null | undefined;
  readonly scheduledAt?: string | null | undefined;
  readonly mode?: PipelineRoundMode | null | undefined;
  readonly meetingLink?: string | null | undefined;
  readonly location?: string | null | undefined;
  readonly status: CandidateRoundStatus;
  readonly interviewerNotes?: string | null | undefined;
  readonly rating?: number | null | undefined;
  readonly recommendation?: RoundRecommendation | null | undefined;
  readonly passedAt?: string | null | undefined;
  readonly failedAt?: string | null | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A round on its interviewer's "My Interviews" list: who and what it is for. */
export interface AssignedInterview extends CandidateRound {
  readonly candidateName: string;
  readonly requisitionTitle: string;
  readonly requisitionNumber: string;
  /** The round's brief for interviewers, set on the job's pipeline. */
  readonly interviewerBrief?: string | null | undefined;
  readonly hasResume: boolean;
}

/** A scheduled interview on the "My Interviews" list of someone on its panel. */
export interface AssignedPanelInterview {
  readonly id: string;
  readonly candidateId: string;
  readonly candidateName: string;
  readonly requisitionId: string;
  readonly requisitionTitle: string;
  readonly requisitionNumber: string;
  readonly stage: InterviewStage;
  readonly round: number;
  readonly interviewType: InterviewType;
  readonly scheduledAt: string;
  readonly durationMinutes: number;
  readonly locationOrLink?: string | null | undefined;
  readonly status: InterviewStatus;
  readonly notes?: string | null | undefined;
  /** Everyone on the panel, the signed-in user included. */
  readonly panel: string[];
  readonly hasResume: boolean;
  /** The signed-in user's own feedback, once given. */
  readonly myFeedback: InterviewFeedback | null;
}

/** Pipeline rounds assigned to the signed-in user, and interviews naming them on the panel. */
export interface MyInterviews {
  readonly rounds: AssignedInterview[];
  readonly interviews: AssignedPanelInterview[];
}

/** A panel member's own feedback; the interviewer is always the signed-in user. */
export interface InterviewerFeedbackInput {
  readonly recommendation: InterviewRecommendation;
  readonly rating?: number | null | undefined;
  readonly feedback: string;
  readonly strengths?: string | null | undefined;
  readonly areasForImprovement?: string | null | undefined;
}

export interface AssignRoundInterviewerInput {
  readonly assignedTo: string;
  readonly scheduledAt?: string | null | undefined;
  readonly mode?: PipelineRoundMode | null | undefined;
  readonly meetingLink?: string | null | undefined;
  readonly location?: string | null | undefined;
}

export interface SubmitRoundFeedbackInput {
  readonly interviewerNotes?: string | null | undefined;
  readonly rating?: number | null | undefined;
  readonly recommendation: RoundRecommendation;
}

export interface RoundDecisionInput {
  readonly decision: 'pass' | 'fail' | 'skip';
  readonly notes?: string | null | undefined;
}

// ---------------------------------------------------------------------
// 13. Candidate Events (new — revamp)
// ---------------------------------------------------------------------

export type CandidateEventType =
  | 'applied'
  | 'screening_passed'
  | 'round_passed'
  | 'round_failed'
  | 'round_scheduled'
  | 'interviewer_assigned'
  | 'feedback_submitted'
  | 'selected'
  | 'rejected'
  | 'offer_sent'
  | 'offer_accepted'
  | 'joining_email_sent'
  | 'acknowledged'
  | 'employee_imported';

export interface CandidateEvent {
  readonly id: string;
  readonly candidateId: string;
  readonly eventType: CandidateEventType;
  readonly actorId?: string | null | undefined;
  readonly actorName?: string | null | undefined;
  readonly metadata?: Record<string, unknown> | null | undefined;
  readonly occurredAt: string;
}

// ---------------------------------------------------------------------
// 14. Email Templates (new — revamp)
// ---------------------------------------------------------------------

export interface RecruitmentEmailTemplate {
  readonly id: string;
  readonly name: string;
  readonly subject: string;
  readonly body: string;
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateEmailTemplateInput {
  readonly name: string;
  readonly subject: string;
  readonly body: string;
  readonly isDefault?: boolean | undefined;
}

export interface UpdateEmailTemplateInput {
  readonly name?: string | undefined;
  readonly subject?: string | undefined;
  readonly body?: string | undefined;
  readonly isDefault?: boolean | undefined;
}

export interface SendJoiningEmailInput {
  readonly templateId?: string | null | undefined;
  readonly subject: string;
  readonly body: string;
}
