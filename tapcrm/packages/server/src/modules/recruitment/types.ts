import type { Decimal, CurrencyCode, ParsedResumeData } from '@tapcrm/contracts';

export type {
  ParsedCandidateData,
  ParsedResumeData,
  ParsedResumeEducation,
  ParsedResumeExperience,
  ParsedResumeProject,
} from '@tapcrm/contracts';

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
  readonly joiningEmailSentAt: Date | string | null;
  readonly joiningEmailTemplateId: string | null;
  readonly acknowledgeToken: string | null;
  readonly acknowledgedAt: Date | string | null;
  readonly acknowledgeIp: string | null;
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
  readonly openingsCount: number;
  readonly employmentType: EmploymentType;
  readonly departmentName?: string | null | undefined;
  readonly location: string | null;
  readonly description: string | null;
  readonly requirements: string | null;
}

// ---------------------------------------------------------------------
// 11. Pipeline Rounds (new — revamp)
// ---------------------------------------------------------------------

export type PipelineRoundMode = 'online' | 'offline' | 'phone';

export interface PipelineRound {
  readonly id: string;
  readonly organizationId: string;
  readonly requisitionId: string;
  readonly name: string;
  readonly mode: PipelineRoundMode;
  readonly orderIndex: number;
  readonly interviewerNote: string | null;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

// ---------------------------------------------------------------------
// 12. Candidate Round Progress (new — revamp)
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
  readonly organizationId: string;
  readonly candidateId: string;
  readonly pipelineRoundId: string;
  readonly pipelineRoundName?: string;
  readonly pipelineRoundOrder?: number;
  readonly assignedTo: string | null;
  readonly assignedToName?: string | null;
  readonly scheduledAt: Date | string | null;
  readonly mode: PipelineRoundMode | null;
  readonly meetingLink: string | null;
  readonly location: string | null;
  readonly status: CandidateRoundStatus;
  readonly interviewerNotes: string | null;
  readonly rating: number | null;
  readonly recommendation: RoundRecommendation | null;
  readonly passedAt: Date | string | null;
  readonly failedAt: Date | string | null;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

/** A round on its interviewer's "My Interviews" list: who and what it is for. */
export interface AssignedInterview extends CandidateRound {
  readonly candidateName: string;
  readonly requisitionTitle: string;
  readonly requisitionNumber: string;
  /** The round's brief for interviewers, set on the job's pipeline. */
  readonly interviewerBrief: string | null;
  readonly hasResume: boolean;
}

/** A scheduled interview, as a member of its panel sees it in My Interviews. */
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
  readonly scheduledAt: Date | string;
  readonly durationMinutes: number;
  readonly locationOrLink: string | null;
  readonly status: InterviewStatus;
  readonly notes: string | null;
  /** Everyone on the panel, the caller included. */
  readonly panel: string[];
  readonly hasResume: boolean;
  /** The caller's own feedback. Other panel members' feedback is for HR. */
  readonly myFeedback: InterviewFeedback | null;
}

/**
 * Everything the signed-in person interviews for: pipeline rounds HR assigned
 * to them, and scheduled interviews that name them on the panel.
 */
export interface MyInterviews {
  readonly rounds: AssignedInterview[];
  readonly interviews: AssignedPanelInterview[];
}

// ---------------------------------------------------------------------
// 13. Candidate Activity Timeline (new — revamp)
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
  readonly organizationId: string;
  readonly candidateId: string;
  readonly eventType: CandidateEventType;
  readonly actorId: string | null;
  readonly actorName?: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly occurredAt: Date | string;
}

// ---------------------------------------------------------------------
// 14. Email Templates (new — revamp)
// ---------------------------------------------------------------------

export interface RecruitmentEmailTemplate {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly subject: string;
  readonly body: string;
  readonly isDefault: boolean;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}
