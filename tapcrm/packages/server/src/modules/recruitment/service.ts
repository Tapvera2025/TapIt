import crypto from 'node:crypto';
import type { Resource } from '@tapcrm/authz';
import { splitPersonName, type AtsScanSummary } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import {
  ConflictError,
  NotEligibleError,
  NotFoundError,
} from '../../platform/http/error-handler.js';
import { PlatformValidationError } from '../../platform/errors.js';
import { provisionEmployee } from '../employee/facade.js';
import { NOTIFICATION_TYPES, notify } from '../notifications/facade.js';
import {
  notifyCandidateRejection,
  notifyInterviewRescheduled,
  notifyInterviewScheduled,
  notifyOnboardingWelcome,
} from './notifications.js';
import { parseResume } from './parser.js';
import * as atsService from './ats/service.js';
import * as repo from './repository.js';
import * as pipelineRoundsRepo from './pipeline-rounds/repository.js';
import * as candidateRoundsRepo from './candidate-rounds/repository.js';
import * as emailTemplatesRepo from './email-templates/repository.js';
import * as candidateEventsRepo from './candidate-events/repository.js';
import {
  generateResumeObjectKey,
  getStorageService,
  validateResumeUpload,
} from './storage.js';
import { sendEmail } from '../identity/facade.js';
import type {
  Candidate,
  CandidateEvent,
  CandidateJoining,
  CandidateResumeSubmission,
  CandidateRound,
  CandidateStatus,
  Interview,
  InterviewFeedback,
  InterviewStatus,
  JobOffer,
  JobRequisition,
  MyInterviews,
  OfferStatus,
  ParsedCandidateData,
  PipelineRound,
  PublicJobRequisitionDetails,
  RecruitmentApplicationLink,
  RecruitmentEmailTemplate,
  RecruitmentMetrics,
  RequisitionStatus,
  UploadCandidateResumeResult,
} from './types.js';
import {
  assertValidInterviewTransition,
  assertValidCandidateTransition,
  assertValidRequisitionTransition,
  assertValidOfferTransition,
  assertValidJoiningTransition,
  assertInterviewDecisionEligible,
} from './state-machine.js';
import type {
  AssignRoundInterviewerInput,
  ConvertSubmissionInput,
  CreateApplicationLinkInput,
  CreateCandidateInput,
  CreateCandidateRoundInput,
  CreateEmailTemplateInput,
  CreateJoiningInput,
  CreateOfferInput,
  CreatePipelineRoundInput,
  CreateRequisitionInput,
  HireCandidateInput,
  HrManualSubmissionInput,
  InterviewDecisionInput,
  InterviewerFeedbackInput,
  PublicApplyInput,
  ReorderPipelineRoundsInput,
  RescheduleInterviewInput,
  RoundDecisionInput,
  ScheduleInterviewInput,
  SendJoiningEmailInput,
  SubmitFeedbackInput,
  SubmitRoundFeedbackInput,
  UpdateEmailTemplateInput,
  UpdateFeedbackInput,
  UpdateApplicationLinkStatusInput,
  UpdateCandidateStatusInput,
  UpdateJoiningInput,
  UpdateJoiningStatusInput,
  UpdateOfferInput,
  UpdatePipelineRoundInput,
  UpdateSubmissionStatusInput,
  UploadCandidateResumeInput,
  ParseCandidateResumeInput,
} from './validators.js';

// ---------------------------------------------------------------------
// 1. Requisitions
// ---------------------------------------------------------------------

export async function listRequisitions(
  ctx: RequestContext,
  filter?: repo.RequisitionFilter,
): Promise<JobRequisition[]> {
  return repo.listRequisitions(ctx, filter);
}

export async function getRequisition(
  ctx: RequestContext,
  id: string,
): Promise<JobRequisition> {
  const req = await repo.findRequisitionById(ctx, id);
  if (!req) throw new NotFoundError('Job requisition');
  return req;
}

export async function createRequisition(
  ctx: RequestContext,
  input: CreateRequisitionInput,
): Promise<JobRequisition> {
  return repo.createRequisition(ctx, input);
}

export async function updateRequisitionStatus(
  ctx: RequestContext,
  id: string,
  status: string,
): Promise<JobRequisition> {
  const existing = await repo.findRequisitionById(ctx, id);
  if (!existing) throw new NotFoundError('Job requisition');

  assertValidRequisitionTransition(existing.status, status as RequisitionStatus);

  const updated = await repo.updateRequisitionStatus(ctx, id, status);
  if (!updated) throw new NotFoundError('Job requisition');
  return updated;
}

// ---------------------------------------------------------------------
// 2. Candidates
// ---------------------------------------------------------------------

export async function listCandidates(
  ctx: RequestContext,
  filter?: repo.CandidateFilter,
): Promise<Candidate[]> {
  return repo.listCandidates(ctx, filter);
}

export async function getCandidate(
  ctx: RequestContext,
  id: string,
): Promise<Candidate> {
  const cand = await repo.findCandidateById(ctx, id);
  if (!cand) throw new NotFoundError('Candidate');
  return cand;
}

export async function createCandidate(
  ctx: RequestContext,
  input: CreateCandidateInput,
): Promise<Candidate> {
  const exists = await repo.candidateExistsForRequisition(ctx, input.requisitionId, input.email);
  if (exists) {
    throw new ConflictError(
      'A candidate with this email is already registered for this job requisition',
      'email',
    );
  }
  return repo.createCandidate(ctx, input);
}

export async function updateCandidateStatus(
  ctx: RequestContext,
  id: string,
  input: UpdateCandidateStatusInput,
): Promise<Candidate> {
  const candidate = await repo.findCandidateById(ctx, id);
  if (!candidate) throw new NotFoundError('Candidate');

  assertValidCandidateTransition(candidate.status, input.status);

  const updated = await repo.updateCandidateStatus(ctx, id, input.status, input.rejectionReason);
  if (!updated) throw new NotFoundError('Candidate');
  return updated;
}

export async function updateCandidateScreening(
  ctx: RequestContext,
  id: string,
  screeningNotes: string,
): Promise<Candidate> {
  const updated = await repo.updateCandidateScreening(ctx, id, screeningNotes);
  if (!updated) throw new NotFoundError('Candidate');
  return updated;
}

export async function softDeleteCandidate(
  ctx: RequestContext,
  id: string,
): Promise<void> {
  const candidate = await repo.findCandidateById(ctx, id);
  if (!candidate) throw new NotFoundError('Candidate');
  await repo.softDeleteCandidate(ctx, id);
}

export async function uploadCandidateResume(
  ctx: RequestContext,
  input: UploadCandidateResumeInput,
): Promise<UploadCandidateResumeResult> {
  const cleanBase64 = input.fileBase64.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');

  const validation = validateResumeUpload(buffer, input.filename, input.mimeType);
  if (!validation.valid) {
    const error = new Error(validation.error || 'Invalid resume file');
    (error as Error & { code?: string }).code = 'INVALID_FILE_UPLOAD';
    throw error;
  }

  const uploadId = crypto.randomUUID();
  const objectKey = generateResumeObjectKey(ctx.organizationId, uploadId, input.filename);

  const storage = getStorageService();
  await storage.putObject(objectKey, buffer, input.mimeType);

  return {
    resumeObjectKey: objectKey,
    resumeFileName: input.filename.trim(),
    resumeMimeType: input.mimeType,
    resumeSize: buffer.length,
    resumeUploadedAt: new Date().toISOString(),
    previewUrl: `/api/recruitment/candidates/resume/preview?key=${encodeURIComponent(objectKey)}`,
  };
}

/**
 * Reads a resume to pre-fill the candidate form. Parsing is local and
 * rule-based (no external service sees the file); each contact field carries a
 * confidence so the form can fill what is certain and only suggest the rest.
 */
export async function parseCandidateResume(
  ctx: RequestContext,
  input: ParseCandidateResumeInput,
): Promise<{ parsed: ParsedCandidateData }> {
  let buffer: Buffer;
  const filename = input.filename || 'resume.pdf';
  let mimeType = input.mimeType || 'application/pdf';

  if (input.resumeObjectKey) {
    const expectedPrefix = `recruitment/resumes/${ctx.organizationId}/`;
    if (!input.resumeObjectKey.startsWith(expectedPrefix)) {
      throw new NotFoundError('Resume');
    }
    try {
      const obj = await getStorageService().getObject(input.resumeObjectKey);
      buffer = obj.buffer;
      if (obj.mimeType) mimeType = obj.mimeType;
    } catch {
      throw new NotFoundError('Resume');
    }
  } else if (input.fileBase64) {
    const cleanBase64 = input.fileBase64.replace(/^data:[^;]+;base64,/, '');
    buffer = Buffer.from(cleanBase64, 'base64');
    const validation = validateResumeUpload(buffer, filename, mimeType);
    if (!validation.valid) throw new PlatformValidationError(validation.error ?? 'Invalid resume file');
  } else {
    throw new PlatformValidationError('Attach a resume file to read.');
  }

  const parsed = await parseResume(buffer, filename, mimeType);
  const split = parsed.name ? splitPersonName(parsed.name) : null;

  return {
    parsed: {
      ...parsed,
      name: parsed.name ?? null,
      firstName: split?.firstName || null,
      lastName: split ? split.lastName : null,
      email: parsed.email ?? null,
      phone: parsed.phone ?? null,
      skills: parsed.skills ?? [],
    },
  };
}

export async function getCandidateResumeFile(
  ctx: RequestContext,
  candidateId: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const candidate = await repo.findCandidateById(ctx, candidateId);
  if (!candidate) throw new NotFoundError('Candidate');

  if (!candidate.resumeObjectKey) {
    throw new NotFoundError('Candidate resume');
  }

  const storage = getStorageService();
  const file = await storage.getObject(candidate.resumeObjectKey);
  return {
    buffer: file.buffer,
    mimeType: candidate.resumeMimeType || file.mimeType || 'application/pdf',
    filename: candidate.resumeFileName || 'resume.pdf',
  };
}

export async function getResumePreviewFile(
  ctx: RequestContext,
  key: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const expectedPrefix = `recruitment/resumes/${ctx.organizationId}/`;
  if (!key.startsWith(expectedPrefix)) {
    throw new NotFoundError('Resume');
  }

  const storage = getStorageService();
  const file = await storage.getObject(key);
  const filename = key.split('/').pop() || 'resume.pdf';
  return {
    buffer: file.buffer,
    mimeType: file.mimeType || 'application/pdf',
    filename,
  };
}


// ---------------------------------------------------------------------
// 3. Interviews
// ---------------------------------------------------------------------

export async function listInterviews(
  ctx: RequestContext,
  filter?: repo.InterviewFilter,
): Promise<Interview[]> {
  return repo.listInterviews(ctx, filter);
}

export async function getInterview(
  ctx: RequestContext,
  id: string,
): Promise<Interview> {
  const int = await repo.findInterviewById(ctx, id);
  if (!int) throw new NotFoundError('Interview');
  return int;
}

export async function scheduleInterview(
  ctx: RequestContext,
  input: ScheduleInterviewInput,
): Promise<Interview> {
  const candidate = await repo.findCandidateById(ctx, input.candidateId);
  if (!candidate) throw new NotFoundError('Candidate');

  const requisition = await repo.findRequisitionById(ctx, input.requisitionId);
  if (!requisition) throw new NotFoundError('Job requisition');

  if (candidate.requisitionId !== input.requisitionId) {
    throw new PlatformValidationError('Candidate does not belong to the specified job requisition');
  }

  const interview = await repo.createInterview(ctx, input);
  await notifyInterviewPanel(ctx, interview, 'You are on an interview panel');

  // Send candidate interview invitation email (non-blocking)
  notifyInterviewScheduled({
    to: candidate.email,
    candidateName: candidate.fullName || `${candidate.firstName} ${candidate.lastName}`,
    requisitionTitle: requisition.title,
    stage: input.stage,
    round: input.round ?? 1,
    scheduledAt: input.scheduledAt,
    durationMinutes: input.durationMinutes ?? 60,
    locationOrLink: input.locationOrLink ?? null,
    notes: input.notes ?? null,
  }).catch(() => undefined);

  return interview;
}

export async function updateInterviewStatus(
  ctx: RequestContext,
  id: string,
  status: string,
): Promise<Interview> {
  const interview = await repo.findInterviewById(ctx, id);
  if (!interview) throw new NotFoundError('Interview');

  assertValidInterviewTransition(interview.status, status as InterviewStatus);

  const updated = await repo.updateInterviewStatus(ctx, id, status);
  if (!updated) throw new NotFoundError('Interview');
  return updated;
}

export async function rescheduleInterview(
  ctx: RequestContext,
  id: string,
  input: RescheduleInterviewInput,
): Promise<Interview> {
  const result = await repo.rescheduleInterview(ctx, id, input);
  await notifyInterviewPanel(ctx, result.newInterview, 'An interview you are on was rescheduled');

  const candidate = await repo.findCandidateById(ctx, result.newInterview.candidateId);
  const requisition = await repo.findRequisitionById(ctx, result.newInterview.requisitionId);

  if (candidate && requisition) {
    notifyInterviewRescheduled({
      to: candidate.email,
      candidateName: candidate.fullName || `${candidate.firstName} ${candidate.lastName}`,
      requisitionTitle: requisition.title,
      stage: result.newInterview.stage,
      round: result.newInterview.round,
      newScheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes ?? result.newInterview.durationMinutes,
      locationOrLink: input.locationOrLink ?? result.newInterview.locationOrLink,
      notes: input.notes ?? null,
    }).catch(() => undefined);
  }

  return result.newInterview;
}

export async function recordInterviewDecision(
  ctx: RequestContext,
  interviewId: string,
  input: InterviewDecisionInput,
): Promise<Candidate> {
  const interview = await repo.findInterviewById(ctx, interviewId);
  if (!interview) throw new NotFoundError('Interview');

  const candidate = await repo.findCandidateById(ctx, interview.candidateId);
  if (!candidate) throw new NotFoundError('Candidate');

  const requisition = await repo.findRequisitionById(ctx, interview.requisitionId);

  // Validate decision is valid enum value
  const decisionVal = String(input.decision);
  if (decisionVal !== 'accepted' && decisionVal !== 'rejected') {
    throw new PlatformValidationError(
      `Invalid interview decision: '${decisionVal}'. Must be 'accepted' or 'rejected'.`,
    );
  }

  // Workflow eligibility check (interview must be in eligible state e.g. completed, not repeated)
  assertInterviewDecisionEligible(interview, candidate);

  // Validate candidate target status transition
  const targetCandidateStatus: CandidateStatus = input.decision === 'accepted' ? 'selected' : 'rejected';
  assertValidCandidateTransition(candidate.status, targetCandidateStatus);

  const updatedCandidate = await repo.recordInterviewDecision(ctx, interviewId, input);

  if (input.decision === 'rejected' && candidate && requisition) {
    notifyCandidateRejection({
      to: candidate.email,
      candidateName: candidate.fullName || `${candidate.firstName} ${candidate.lastName}`,
      requisitionTitle: requisition.title,
      reason: input.rejectionReason ?? null,
    }).catch(() => undefined);
  }

  return updatedCandidate;
}

export async function submitInterviewFeedback(
  ctx: RequestContext,
  interviewId: string,
  input: SubmitFeedbackInput,
): Promise<InterviewFeedback> {
  const interview = await repo.findInterviewById(ctx, interviewId);
  if (!interview) throw new NotFoundError('Interview');

  const interviewer = await repo.findUserById(ctx, input.interviewerId);
  if (!interviewer) throw new NotFoundError('Interviewer');

  const assignedInterviewers = interview.interviewerIds ?? (await repo.getAssignedInterviewerIds(ctx, interviewId));
  if (!assignedInterviewers.includes(input.interviewerId)) {
    throw new PlatformValidationError('Interviewer is not assigned to this interview');
  }

  return repo.createInterviewFeedback(ctx, interviewId, input);
}

export async function updateInterviewFeedback(
  ctx: RequestContext,
  id: string,
  input: UpdateFeedbackInput,
): Promise<InterviewFeedback> {
  const existing = await repo.findInterviewFeedbackById(ctx, id);
  if (!existing) throw new NotFoundError('Interview feedback');

  const targetInterviewerId = input.interviewerId ?? existing.interviewerId;

  const interview = await repo.findInterviewById(ctx, existing.interviewId);
  if (!interview) throw new NotFoundError('Interview');

  const interviewer = await repo.findUserById(ctx, targetInterviewerId);
  if (!interviewer) throw new NotFoundError('Interviewer');

  const assignedInterviewers = interview.interviewerIds ?? (await repo.getAssignedInterviewerIds(ctx, existing.interviewId));
  if (!assignedInterviewers.includes(targetInterviewerId)) {
    throw new PlatformValidationError('Interviewer is not assigned to this interview');
  }

  const updated = await repo.updateInterviewFeedback(ctx, id, input);
  if (!updated) throw new NotFoundError('Interview feedback');
  return updated;
}

export async function getInterviewFeedback(
  ctx: RequestContext,
  id: string,
): Promise<InterviewFeedback> {
  const fb = await repo.findInterviewFeedbackById(ctx, id);
  if (!fb) throw new NotFoundError('Interview feedback');
  return fb;
}

// ---------------------------------------------------------------------
// 4. Offers
// ---------------------------------------------------------------------

export async function listOffers(
  ctx: RequestContext,
  filter?: repo.OfferFilter,
): Promise<JobOffer[]> {
  return repo.listOffers(ctx, filter);
}

export async function getOffer(
  ctx: RequestContext,
  id: string,
): Promise<JobOffer> {
  const off = await repo.findOfferById(ctx, id);
  if (!off) throw new NotFoundError('Job offer');
  return off;
}

export async function createOffer(
  ctx: RequestContext,
  input: CreateOfferInput,
): Promise<JobOffer> {
  const candidate = await repo.findCandidateById(ctx, input.candidateId);
  if (!candidate) throw new NotFoundError('Candidate');

  const requisition = await repo.findRequisitionById(ctx, input.requisitionId);
  if (!requisition) throw new NotFoundError('Job requisition');

  if (candidate.requisitionId !== input.requisitionId) {
    throw new PlatformValidationError('Candidate does not belong to the specified job requisition');
  }

  return repo.createOffer(ctx, input);
}

export async function updateOffer(
  ctx: RequestContext,
  id: string,
  input: UpdateOfferInput,
): Promise<JobOffer> {
  const offer = await repo.findOfferById(ctx, id);
  if (!offer) throw new NotFoundError('Job offer');

  const targetCandidateId = input.candidateId ?? offer.candidateId;
  const targetRequisitionId = input.requisitionId ?? offer.requisitionId;

  const candidate = await repo.findCandidateById(ctx, targetCandidateId);
  if (!candidate) throw new NotFoundError('Candidate');

  const requisition = await repo.findRequisitionById(ctx, targetRequisitionId);
  if (!requisition) throw new NotFoundError('Job requisition');

  if (candidate.requisitionId !== targetRequisitionId) {
    throw new PlatformValidationError('Candidate does not belong to the specified job requisition');
  }

  const updated = await repo.updateOffer(ctx, id, input);
  if (!updated) throw new NotFoundError('Job offer');
  return updated;
}

export async function updateOfferStatus(
  ctx: RequestContext,
  id: string,
  status: string,
): Promise<JobOffer> {
  const offer = await repo.findOfferById(ctx, id);
  if (!offer) throw new NotFoundError('Job offer');

  const candidate = await repo.findCandidateById(ctx, offer.candidateId);
  if (!candidate) throw new NotFoundError('Candidate');

  const requisition = await repo.findRequisitionById(ctx, offer.requisitionId);
  if (!requisition) throw new NotFoundError('Job requisition');

  if (candidate.requisitionId !== offer.requisitionId) {
    throw new PlatformValidationError('Candidate does not belong to the specified job requisition');
  }

  assertValidOfferTransition(offer.status, status as OfferStatus);

  const updated = await repo.updateOfferStatus(ctx, id, status);
  if (!updated) throw new NotFoundError('Job offer');
  return updated;
}

// ---------------------------------------------------------------------
// 5. Joining
// ---------------------------------------------------------------------

export async function listJoinings(
  ctx: RequestContext,
  filter?: repo.JoiningFilter,
): Promise<CandidateJoining[]> {
  return repo.listJoinings(ctx, filter);
}

export async function getJoining(
  ctx: RequestContext,
  id: string,
): Promise<CandidateJoining> {
  const j = await repo.findJoiningById(ctx, id);
  if (!j) throw new NotFoundError('Candidate joining');
  return j;
}

export async function createJoining(
  ctx: RequestContext,
  input: CreateJoiningInput,
): Promise<CandidateJoining> {
  const candidate = await repo.findCandidateById(ctx, input.candidateId);
  if (!candidate) throw new NotFoundError('Candidate');

  const offer = await repo.findOfferById(ctx, input.offerId);
  if (!offer) throw new NotFoundError('Job offer');

  if (offer.candidateId !== input.candidateId) {
    throw new PlatformValidationError('Offer does not belong to the specified candidate');
  }

  return repo.createJoining(ctx, input);
}

export async function updateJoining(
  ctx: RequestContext,
  id: string,
  input: UpdateJoiningInput,
): Promise<CandidateJoining> {
  const joining = await repo.findJoiningById(ctx, id);
  if (!joining) throw new NotFoundError('Candidate joining');

  const targetCandidateId = input.candidateId ?? joining.candidateId;
  const targetOfferId = input.offerId ?? joining.offerId;

  const candidate = await repo.findCandidateById(ctx, targetCandidateId);
  if (!candidate) throw new NotFoundError('Candidate');

  const offer = await repo.findOfferById(ctx, targetOfferId);
  if (!offer) throw new NotFoundError('Job offer');

  if (offer.candidateId !== targetCandidateId) {
    throw new PlatformValidationError('Offer does not belong to the specified candidate');
  }

  const updated = await repo.updateJoining(ctx, id, input);
  if (!updated) throw new NotFoundError('Candidate joining');
  return updated;
}

export async function updateJoiningStatus(
  ctx: RequestContext,
  id: string,
  input: UpdateJoiningStatusInput,
): Promise<CandidateJoining> {
  const joining = await repo.findJoiningById(ctx, id);
  if (!joining) throw new NotFoundError('Candidate joining');

  const candidate = await repo.findCandidateById(ctx, joining.candidateId);
  if (!candidate) throw new NotFoundError('Candidate');

  const offer = await repo.findOfferById(ctx, joining.offerId);
  if (!offer) throw new NotFoundError('Job offer');

  if (offer.candidateId !== joining.candidateId) {
    throw new PlatformValidationError('Offer does not belong to the specified candidate');
  }

  assertValidJoiningTransition(joining.status, input.status);

  const updated = await repo.updateJoiningStatus(
    ctx,
    id,
    input.status,
    input.actualJoiningDate,
    input.notes,
  );
  if (!updated) throw new NotFoundError('Candidate joining');
  return updated;
}

// ---------------------------------------------------------------------
// 6. Application Links
// ---------------------------------------------------------------------

export async function createApplicationLink(
  ctx: RequestContext,
  input: CreateApplicationLinkInput,
): Promise<RecruitmentApplicationLink> {
  const requisition = await repo.findRequisitionById(ctx, input.requisitionId);
  if (!requisition) throw new NotFoundError('Job requisition');

  if (requisition.status !== 'open') {
    throw new PlatformValidationError('Cannot create application link for a requisition that is not open');
  }

  const token = crypto.randomBytes(32).toString('hex');
  return repo.createApplicationLink(ctx, input, token);
}

export async function listApplicationLinks(
  ctx: RequestContext,
  requisitionId?: string,
): Promise<RecruitmentApplicationLink[]> {
  return repo.listApplicationLinks(ctx, requisitionId);
}

export async function getApplicationLink(
  ctx: RequestContext,
  id: string,
): Promise<RecruitmentApplicationLink> {
  const link = await repo.findApplicationLinkById(ctx, id);
  if (!link) throw new NotFoundError('Application link');
  return link;
}

export async function updateApplicationLinkStatus(
  ctx: RequestContext,
  id: string,
  input: UpdateApplicationLinkStatusInput,
): Promise<RecruitmentApplicationLink> {
  const link = await repo.findApplicationLinkById(ctx, id);
  if (!link) throw new NotFoundError('Application link');

  const updated = await repo.updateApplicationLinkStatus(ctx, id, input.status, input.expiresAt);
  if (!updated) throw new NotFoundError('Application link');
  return updated;
}

export function assertPublicApplicationLinkValid(
  link: RecruitmentApplicationLink | null | undefined,
  requisition: JobRequisition | null | undefined,
): asserts link is RecruitmentApplicationLink {
  if (!link || link.status !== 'active') {
    throw new NotFoundError('Application link is invalid, expired, or disabled');
  }

  if (link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now()) {
    throw new NotFoundError('Application link is invalid, expired, or disabled');
  }

  if (
    !requisition ||
    requisition.organizationId !== link.organizationId ||
    requisition.id !== link.requisitionId
  ) {
    throw new NotFoundError('Application link is invalid, expired, or disabled');
  }

  if (requisition.status !== 'open') {
    throw new NotFoundError('Application link is invalid, expired, or disabled');
  }
}

export async function resolvePublicApplicationLink(token: string): Promise<{
  token: string;
  requisition: PublicJobRequisitionDetails;
}> {
  const resolved = await repo.resolvePublicApplicationLink(token);
  if (!resolved) {
    throw new NotFoundError('Application link is invalid, expired, or disabled');
  }

  const { link, requisition } = resolved;
  assertPublicApplicationLinkValid(link, requisition);

  return {
    token,
    requisition: {
      title: requisition.title,
      requisitionNumber: requisition.requisitionNumber,
      openingsCount: requisition.openingsCount,
      employmentType: requisition.employmentType,
      departmentName: requisition.departmentName ?? null,
      location: requisition.location,
      description: requisition.description,
      requirements: requisition.requirements,
    },
  };
}

// ---------------------------------------------------------------------
// 7. Resume Intake & Submissions
// ---------------------------------------------------------------------

export async function submitPublicApplication(
  token: string,
  input: PublicApplyInput,
): Promise<{
  submissionId: string;
  status: string;
  message: string;
}> {
  const resolved = await repo.resolvePublicApplicationLink(token);
  if (!resolved) {
    throw new NotFoundError('Application link is invalid, expired, or disabled');
  }

  const { link, requisition } = resolved;
  assertPublicApplicationLinkValid(link, requisition);

  // Decode base64 resume buffer
  const cleanBase64 = input.resumeBase64.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');

  const validation = validateResumeUpload(buffer, input.resumeFilename, input.resumeMimeType);
  if (!validation.valid) {
    const error = new Error(validation.error || 'Invalid resume file');
    (error as Error & { code?: string }).code = 'INVALID_FILE_UPLOAD';
    throw error;
  }

  const submissionId = crypto.randomUUID();
  const objectKey = generateResumeObjectKey(link.organizationId, submissionId, input.resumeFilename);

  // Store resume in object storage
  const storage = getStorageService();
  await storage.putObject(objectKey, buffer, input.resumeMimeType);

  const parsedData = await parseResume(buffer, input.resumeFilename, input.resumeMimeType);

  const submission = await repo.createResumeSubmissionPreAuth({
    organizationId: link.organizationId,
    requisitionId: requisition.id,
    applicationLinkId: link.id,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone?.trim() ?? null,
    resumeObjectKey: objectKey,
    resumeFilename: input.resumeFilename.trim(),
    resumeMimeType: input.resumeMimeType,
    resumeFileSize: buffer.length,
    parsedData,
  });

  return {
    submissionId: submission.id,
    status: submission.status,
    message: 'Application submitted successfully',
  };
}

export async function createManualSubmission(
  ctx: RequestContext,
  input: HrManualSubmissionInput,
): Promise<CandidateResumeSubmission> {
  const requisition = await repo.findRequisitionById(ctx, input.requisitionId);
  if (!requisition) throw new NotFoundError('Job requisition');

  const cleanBase64 = input.resumeBase64.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');

  const validation = validateResumeUpload(buffer, input.resumeFilename, input.resumeMimeType);
  if (!validation.valid) {
    const error = new Error(validation.error || 'Invalid resume file');
    (error as Error & { code?: string }).code = 'INVALID_FILE_UPLOAD';
    throw error;
  }

  const submissionId = crypto.randomUUID();
  const objectKey = generateResumeObjectKey(ctx.organizationId, submissionId, input.resumeFilename);

  const storage = getStorageService();
  await storage.putObject(objectKey, buffer, input.resumeMimeType);

  const parsedData = input.parsedData ?? await parseResume(buffer, input.resumeFilename, input.resumeMimeType);

  return repo.createResumeSubmission(ctx, {
    organizationId: ctx.organizationId,
    requisitionId: input.requisitionId,
    applicationLinkId: null,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone?.trim() ?? null,
    resumeObjectKey: objectKey,
    resumeFilename: input.resumeFilename.trim(),
    resumeMimeType: input.resumeMimeType,
    resumeFileSize: buffer.length,
    parsedData,
  });
}

export async function listResumeSubmissions(
  ctx: RequestContext,
  filter?: repo.SubmissionFilter,
): Promise<(CandidateResumeSubmission & { ats: AtsScanSummary | null })[]> {
  const submissions = await repo.listResumeSubmissions(ctx, filter);
  // Each row carries its latest ATS result so HR can sort and triage the inbox.
  return atsService.attachScanSummaries(ctx, submissions);
}

export async function getResumeSubmission(
  ctx: RequestContext,
  id: string,
): Promise<CandidateResumeSubmission> {
  const sub = await repo.findResumeSubmissionById(ctx, id);
  if (!sub) throw new NotFoundError('Resume submission');
  return sub;
}

export async function getResumeFile(
  ctx: RequestContext,
  id: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const sub = await repo.findResumeSubmissionById(ctx, id);
  if (!sub) throw new NotFoundError('Resume submission');

  const storage = getStorageService();
  const file = await storage.getObject(sub.resumeObjectKey);
  return {
    buffer: file.buffer,
    mimeType: sub.resumeMimeType || file.mimeType,
    filename: sub.resumeFilename,
  };
}

export async function getResumeSignedUrl(
  ctx: RequestContext,
  id: string,
): Promise<{ url: string; filename: string }> {
  const sub = await repo.findResumeSubmissionById(ctx, id);
  if (!sub) throw new NotFoundError('Resume submission');
  // Return a server-proxied URL instead of a direct MinIO URL so the browser
  // never needs to reach the internal storage hostname.
  return {
    url: `/api/recruitment/resume-submissions/${encodeURIComponent(id)}/resume`,
    filename: sub.resumeFilename,
  };
}

export async function updateResumeSubmissionStatus(
  ctx: RequestContext,
  id: string,
  input: UpdateSubmissionStatusInput,
): Promise<CandidateResumeSubmission> {
  const updated = await repo.updateResumeSubmissionStatus(ctx, id, input.status, input.rejectionReason);
  if (!updated) throw new NotFoundError('Resume submission');
  return updated;
}

export async function convertResumeSubmissionToCandidate(
  ctx: RequestContext,
  id: string,
  input?: ConvertSubmissionInput,
): Promise<{ candidate: Candidate; candidateId: string; submission: CandidateResumeSubmission }> {
  try {
    const result = await repo.convertSubmissionToCandidate(ctx, id, input);
    return {
      candidate: result.candidate,
      candidateId: result.candidate.id,
      submission: result.submission,
    };
  } catch (error) {
    if ((error as Error & { code?: string }).code === 'DUPLICATE_CANDIDATE') {
      throw new ConflictError(
        (error as Error).message,
        'email',
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------------
// 8. Candidate Hiring
// ---------------------------------------------------------------------

export async function hireCandidateAsEmployee(
  ctx: RequestContext,
  candidateId: string,
  input: HireCandidateInput,
) {
  let eligibility;
  try {
    eligibility = await repo.getCandidateHiringEligibility(ctx, candidateId);
  } catch (err) {
    const error = err as Error & { code?: string };
    if (error.code === 'INVALID_CANDIDATE_STATE') {
      throw new NotEligibleError('CANDIDATE_NOT_SELECTED', error.message, {
        unmet: ['candidate.status === selected'],
        required: ['selected'],
      });
    }
    if (error.code === 'NO_ACCEPTED_OFFER') {
      throw new NotEligibleError('NO_ACCEPTED_OFFER', error.message, {
        unmet: ['job_offer.status === accepted'],
        required: ['accepted'],
      });
    }
    if (error.code === 'NO_JOINING_RECORD') {
      throw new NotEligibleError('NO_JOINING_RECORD', error.message, {
        unmet: ['candidate_joining.status IN (pending, confirmed)'],
        required: ['pending', 'confirmed'],
      });
    }
    throw err;
  }

  const { candidate, requisition, offer, joining } = eligibility;

  const positionId = offer.positionId || requisition.positionId;
  if (!positionId) {
    throw new NotEligibleError(
      'MISSING_POSITION',
      'A position must be assigned on the offer or job requisition to hire as employee',
      { unmet: ['offer.positionId OR requisition.positionId'], required: ['positionId'] },
    );
  }

  // Generate a random temporary password (min 12 chars) if none provided by HR
  const password =
    input.password ||
    'TempPass1234!' + crypto.randomBytes(4).toString('hex');

  const fullName = (candidate.fullName || `${candidate.firstName} ${candidate.lastName}`).trim();

  // Reuses the shared employee provisioning service
  const provisionResult = await provisionEmployee(ctx, {
    email: candidate.email,
    password,
    confirmPassword: password,
    fullName,
    departmentId: requisition.departmentId,
    positionId,
    ...(input.teamId ? { teamId: input.teamId } : {}),
    ...(offer.designationId ? { designationId: offer.designationId } : {}),
    ...(input.specialization ? { specialization: input.specialization } : {}),
    reportsTo: input.reportsTo ?? null,
  });

  // Finalize candidate joining record
  const finalizedJoining = await repo.finalizeCandidateJoining(
    ctx,
    joining.id,
    provisionResult.employee.id,
    input.actualJoiningDate,
  );

  // Send onboarding welcome email (non-blocking)
  notifyOnboardingWelcome({
    to: candidate.email,
    employeeName: fullName,
    jobTitle: requisition.title,
    departmentName: requisition.departmentName ?? null,
    joiningDate: (input.actualJoiningDate || joining.expectedJoiningDate) as string,
  }).catch(() => undefined);

  return {
    employee: provisionResult.employee,
    joining: finalizedJoining,
    credentials: provisionResult.credentials,
  };
}

// ---------------------------------------------------------------------
// 9. Metrics Aggregate
// ---------------------------------------------------------------------

export async function getRecruitmentMetrics(
  ctx: RequestContext,
): Promise<RecruitmentMetrics> {
  return repo.getRecruitmentMetrics(ctx);
}

// ---------------------------------------------------------------------
// Resource loaders — used by the centralized authorization framework
// (platform/http/router.ts) to perform object-level checks before the
// handler runs.  These follow the Resource interface from @tapcrm/authz,
// which requires a 'type' discriminator field (see ports.ts).
// ---------------------------------------------------------------------

export async function loadRequisitionResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const record = await repo.findRequisitionById(ctx, id);
  if (!record) return null;
  return { type: 'jobRequisition', ...record };
}

export async function loadCandidateResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const record = await repo.findCandidateById(ctx, id);
  if (!record) return null;
  return { type: 'candidate', ...record };
}

export async function loadInterviewResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const record = await repo.findInterviewById(ctx, id);
  if (!record) return null;
  return { type: 'interview', ...record };
}

export async function loadOfferResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const record = await repo.findOfferById(ctx, id);
  if (!record) return null;
  return { type: 'jobOffer', ...record };
}

export async function loadJoiningResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const record = await repo.findJoiningById(ctx, id);
  if (!record) return null;
  return { type: 'candidateJoining', ...record };
}

export async function loadApplicationLinkResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const record = await repo.findApplicationLinkById(ctx, id);
  if (!record) return null;
  return { type: 'recruitmentApplicationLink', ...record };
}

export async function loadResumeSubmissionResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const record = await repo.findResumeSubmissionById(ctx, id);
  if (!record) return null;
  return { type: 'candidateResumeSubmission', ...record };
}

/**
 * Loads the parent Interview for a given InterviewFeedback ID.
 *
 * Used by PATCH /api/recruitment/interview-feedback/:id, where `:id` is a
 * feedback ID.  The interviewPolicy governs access to feedback records, so
 * the authorization check must operate on the parent Interview resource.
 */
export async function loadInterviewFeedbackAsInterviewResource(
  ctx: RequestContext,
  feedbackId: string,
): Promise<Resource | null> {
  const feedback = await repo.findInterviewFeedbackById(ctx, feedbackId);
  if (!feedback) return null;
  const interview = await repo.findInterviewById(ctx, feedback.interviewId);
  if (!interview) return null;
  return { type: 'interview', ...interview };
}

// ---------------------------------------------------------------------
// 10. Pipeline Rounds (new — revamp)
// ---------------------------------------------------------------------

export async function listPipelineRounds(
  ctx: RequestContext,
  requisitionId: string,
): Promise<PipelineRound[]> {
  return pipelineRoundsRepo.listPipelineRounds(ctx, requisitionId);
}

export async function createPipelineRound(
  ctx: RequestContext,
  input: CreatePipelineRoundInput,
): Promise<PipelineRound> {
  const requisition = await repo.findRequisitionById(ctx, input.requisitionId);
  if (!requisition) throw new NotFoundError('Requisition not found');
  return pipelineRoundsRepo.createPipelineRound(ctx, input);
}

export async function updatePipelineRound(
  ctx: RequestContext,
  id: string,
  input: UpdatePipelineRoundInput,
): Promise<PipelineRound> {
  const round = await pipelineRoundsRepo.findPipelineRoundById(ctx, id);
  if (!round) throw new NotFoundError('Pipeline round not found');
  const updated = await pipelineRoundsRepo.updatePipelineRound(ctx, id, input);
  if (!updated) throw new NotFoundError('Pipeline round not found');
  return updated;
}

export async function deletePipelineRound(
  ctx: RequestContext,
  id: string,
): Promise<{ message: string }> {
  const round = await pipelineRoundsRepo.findPipelineRoundById(ctx, id);
  if (!round) throw new NotFoundError('Pipeline round not found');
  await pipelineRoundsRepo.deletePipelineRound(ctx, id);
  return { message: 'Pipeline round deleted' };
}

export async function reorderPipelineRounds(
  ctx: RequestContext,
  input: ReorderPipelineRoundsInput,
): Promise<{ message: string }> {
  await pipelineRoundsRepo.reorderPipelineRounds(ctx, input);
  return { message: 'Pipeline rounds reordered' };
}

export async function loadPipelineRoundResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const record = await pipelineRoundsRepo.findPipelineRoundById(ctx, id);
  if (!record) return null;
  return { type: 'jobRequisition', organizationId: record.organizationId, id: record.requisitionId };
}

// ---------------------------------------------------------------------
// 11. Candidate Rounds (new — revamp)
// ---------------------------------------------------------------------

export async function listCandidateRounds(
  ctx: RequestContext,
  candidateId: string,
): Promise<CandidateRound[]> {
  return candidateRoundsRepo.listCandidateRounds(ctx, candidateId);
}

export async function createCandidateRound(
  ctx: RequestContext,
  input: CreateCandidateRoundInput,
): Promise<CandidateRound> {
  return candidateRoundsRepo.createCandidateRound(ctx, input);
}

export async function assignRoundInterviewer(
  ctx: RequestContext,
  candidateRoundId: string,
  input: AssignRoundInterviewerInput,
): Promise<CandidateRound> {
  const round = await candidateRoundsRepo.findCandidateRoundById(ctx, candidateRoundId);
  if (!round) throw new NotFoundError('Candidate round not found');

  const updated = await db.transaction(ctx, async (tx) => {
    const result = await candidateRoundsRepo.updateCandidateRound(ctx, candidateRoundId, {
      assignedTo: input.assignedTo,
      scheduledAt: input.scheduledAt ?? null,
      mode: input.mode ?? null,
      meetingLink: input.meetingLink ?? null,
      location: input.location ?? null,
      status: 'scheduled',
    });

    if (input.assignedTo && input.assignedTo !== ctx.principal.id) {
      try {
        await notify(tx, ctx, {
          type: NOTIFICATION_TYPES.RECRUITMENT_INTERVIEW_ASSIGNED,
          priority: 'operational',
          audience: { users: [input.assignedTo] },
          title: 'Interview round assigned to you',
          body: round.pipelineRoundName
            ? `You have been assigned to conduct ${round.pipelineRoundName}`
            : 'You have been assigned to conduct an interview',
          link: '/company/my-interviews',
          metadata: { candidateRoundId, pipelineRoundId: round.pipelineRoundId },
        });
      } catch {
        // notification failure must not abort the assignment
      }
    }

    return result;
  });

  if (!updated) throw new NotFoundError('Candidate round not found after update');
  return updated;
}

export async function submitRoundFeedback(
  ctx: RequestContext,
  candidateRoundId: string,
  input: SubmitRoundFeedbackInput,
): Promise<CandidateRound> {
  const round = await candidateRoundsRepo.findCandidateRoundById(ctx, candidateRoundId);
  if (!round) throw new NotFoundError('Candidate round not found');

  const updated = await candidateRoundsRepo.updateCandidateRound(ctx, candidateRoundId, {
    interviewerNotes: input.interviewerNotes ?? null,
    rating: input.rating ?? null,
    recommendation: input.recommendation,
    status: 'completed',
  });

  if (round.candidateId) {
    await candidateEventsRepo.createCandidateEvent(
      ctx,
      round.candidateId,
      'feedback_submitted',
      ctx.principal.id,
      {
        roundName: round.pipelineRoundName ?? null,
        recommendation: input.recommendation,
      },
    );
  }

  if (!updated) throw new NotFoundError('Candidate round not found after update');
  return updated;
}

export async function recordRoundDecision(
  ctx: RequestContext,
  candidateRoundId: string,
  input: RoundDecisionInput,
): Promise<CandidateRound> {
  const round = await candidateRoundsRepo.findCandidateRoundById(ctx, candidateRoundId);
  if (!round) throw new NotFoundError('Candidate round not found');

  const now = new Date().toISOString();
  const isPassing = input.decision === 'pass';
  const isFailing = input.decision === 'fail';
  const isSkipping = input.decision === 'skip';

  const updated = await candidateRoundsRepo.updateCandidateRound(ctx, candidateRoundId, {
    status: isPassing ? 'passed' : isFailing ? 'failed' : 'skipped',
    passedAt: isPassing ? now : null,
    failedAt: isFailing ? now : null,
  });

  if (round.candidateId) {
    await candidateEventsRepo.createCandidateEvent(
      ctx,
      round.candidateId,
      isPassing ? 'round_passed' : isSkipping ? 'round_passed' : 'round_failed',
      ctx.principal.id,
      {
        roundName: round.pipelineRoundName ?? null,
        notes: input.notes ?? null,
      },
    );
  }

  if (!updated) throw new NotFoundError('Candidate round not found after update');
  return updated;
}

/**
 * What the caller interviews for, with who and what each interview is for:
 * pipeline rounds HR assigned to them, and scheduled interviews that name them
 * on the panel.
 */
export async function listMyInterviews(ctx: RequestContext): Promise<MyInterviews> {
  const [rounds, interviews] = await Promise.all([
    candidateRoundsRepo.listMyInterviews(ctx),
    repo.listMyPanelInterviews(ctx),
  ]);
  return { rounds, interviews };
}

/**
 * A scheduled interview, authorized as its candidate with the panel named as
 * its interviewers — the same rule as a round (INTERVIEWER_ACTIONS in
 * policy.ts), so whoever HR puts on the panel can read the resume and give
 * feedback whatever their position, and nothing more.
 */
export async function loadPanelInterviewResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const interview = await repo.findInterviewById(ctx, id);
  if (!interview) return null;
  const candidate = await repo.findCandidateById(ctx, interview.candidateId);
  if (!candidate) return null;
  return {
    type: 'candidate',
    ...candidate,
    organizationId: interview.organizationId,
    id: interview.candidateId,
    interviewerIds: interview.interviewerIds ?? [],
  };
}

/** The interview, if the caller is on its panel; My Interviews serves nothing else. */
async function findMyPanelInterview(ctx: RequestContext, interviewId: string): Promise<Interview> {
  const interview = await repo.findInterviewById(ctx, interviewId);
  if (!interview || !(interview.interviewerIds ?? []).includes(ctx.principal.id)) {
    throw new NotFoundError('Interview');
  }
  return interview;
}

/** The candidate's resume, for a member of the interview's panel. */
export async function getPanelInterviewResumeFile(
  ctx: RequestContext,
  interviewId: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const interview = await findMyPanelInterview(ctx, interviewId);
  return readResumeForInterviewer(ctx, interview.candidateId);
}

/** Interviews still open for feedback: not called off and not a no-show. */
const FEEDBACK_OPEN: ReadonlySet<InterviewStatus> = new Set<InterviewStatus>(['scheduled', 'completed']);

/** A panel member saves their own feedback (first save or a later change). */
export async function saveMyInterviewFeedback(
  ctx: RequestContext,
  interviewId: string,
  input: InterviewerFeedbackInput,
): Promise<InterviewFeedback> {
  const interview = await findMyPanelInterview(ctx, interviewId);
  if (!FEEDBACK_OPEN.has(interview.status)) {
    throw new PlatformValidationError(
      interview.status === 'no_show'
        ? 'The candidate did not attend this interview, so it takes no feedback.'
        : 'This interview was called off, so it takes no feedback.',
    );
  }
  return repo.saveInterviewerFeedback(ctx, interviewId, ctx.principal.id, input);
}

const STAGE_LABEL: Readonly<Record<string, string>> = {
  screening: 'Screening',
  technical: 'Technical',
  managerial: 'Managerial',
  hr: 'HR',
  final: 'Final',
};

/**
 * Tells the panel (not whoever scheduled it) about an interview they are on,
 * linking to My Interviews. A failed notification never undoes the scheduling.
 */
async function notifyInterviewPanel(ctx: RequestContext, interview: Interview, title: string): Promise<void> {
  const users = (interview.interviewerIds ?? []).filter((id) => id !== ctx.principal.id);
  if (users.length === 0) return;
  const stage = STAGE_LABEL[interview.stage] ?? interview.stage;
  try {
    await db.transaction(ctx, (tx) => notify(tx, ctx, {
      type: NOTIFICATION_TYPES.RECRUITMENT_INTERVIEW_ASSIGNED,
      priority: 'operational',
      audience: { users },
      title,
      body: `${interview.candidateName?.trim() || 'A candidate'} · ${interview.requisitionTitle ?? 'Open position'} — ${stage} round ${interview.round}`,
      link: '/company/my-interviews',
      metadata: { interviewId: interview.id },
    }));
  } catch {
    // The interview stands; the panel still sees it in My Interviews.
  }
}

/**
 * A round, authorized as its candidate: the candidate's own fields decide
 * `own` scope, and the round's interviewer is named as a party to it, so the
 * person HR assigned can submit feedback and read the resume whatever their
 * position (see INTERVIEWER_ACTIONS in policy.ts).
 */
export async function loadCandidateRoundResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const round = await candidateRoundsRepo.findCandidateRoundById(ctx, id);
  if (!round) return null;
  const candidate = await repo.findCandidateById(ctx, round.candidateId);
  if (!candidate) return null;
  return {
    type: 'candidate',
    ...candidate,
    organizationId: round.organizationId,
    id: round.candidateId,
    interviewerIds: round.assignedTo ? [round.assignedTo] : [],
  };
}

/** The resume of the candidate a round is for — for its interviewer, through the round. */
export async function getInterviewResumeFile(
  ctx: RequestContext,
  candidateRoundId: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const round = await candidateRoundsRepo.findCandidateRoundById(ctx, candidateRoundId);
  // My Interviews serves the caller's own rounds only.
  if (!round || round.assignedTo !== ctx.principal.id) throw new NotFoundError('Candidate round');
  return readResumeForInterviewer(ctx, round.candidateId);
}

async function readResumeForInterviewer(
  ctx: RequestContext,
  candidateId: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  try {
    return await getCandidateResumeFile(ctx, candidateId);
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    // A file missing from storage is "no resume", not a server fault.
    throw new NotFoundError('Candidate resume');
  }
}

// ---------------------------------------------------------------------
// 12. Candidate Events (new — revamp)
// ---------------------------------------------------------------------

export async function listCandidateEvents(
  ctx: RequestContext,
  candidateId: string,
): Promise<CandidateEvent[]> {
  return candidateEventsRepo.listCandidateEvents(ctx, candidateId);
}

// ---------------------------------------------------------------------
// 13. Email Templates (new — revamp)
// ---------------------------------------------------------------------

export async function listEmailTemplates(
  ctx: RequestContext,
): Promise<RecruitmentEmailTemplate[]> {
  return emailTemplatesRepo.listEmailTemplates(ctx);
}

export async function getEmailTemplate(
  ctx: RequestContext,
  id: string,
): Promise<RecruitmentEmailTemplate> {
  const template = await emailTemplatesRepo.findEmailTemplateById(ctx, id);
  if (!template) throw new NotFoundError('Email template not found');
  return template;
}

export async function createEmailTemplate(
  ctx: RequestContext,
  input: CreateEmailTemplateInput,
): Promise<RecruitmentEmailTemplate> {
  return emailTemplatesRepo.createEmailTemplate(ctx, input);
}

export async function updateEmailTemplate(
  ctx: RequestContext,
  id: string,
  input: UpdateEmailTemplateInput,
): Promise<RecruitmentEmailTemplate> {
  const template = await emailTemplatesRepo.findEmailTemplateById(ctx, id);
  if (!template) throw new NotFoundError('Email template not found');
  const updated = await emailTemplatesRepo.updateEmailTemplate(ctx, id, input);
  if (!updated) throw new NotFoundError('Email template not found after update');
  return updated;
}

export async function deleteEmailTemplate(
  ctx: RequestContext,
  id: string,
): Promise<{ message: string }> {
  const template = await emailTemplatesRepo.findEmailTemplateById(ctx, id);
  if (!template) throw new NotFoundError('Email template not found');
  await emailTemplatesRepo.deleteEmailTemplate(ctx, id);
  return { message: 'Email template deleted' };
}

export async function loadEmailTemplateResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const record = await emailTemplatesRepo.findEmailTemplateById(ctx, id);
  if (!record) return null;
  return { type: 'recruitmentEmailTemplate', ...record };
}

// ---------------------------------------------------------------------
// 14. Joining Email (new — revamp)
// ---------------------------------------------------------------------

function renderEmailTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

export async function sendJoiningEmail(
  ctx: RequestContext,
  joiningId: string,
  input: SendJoiningEmailInput,
): Promise<{ message: string }> {
  const joining = await repo.findJoiningById(ctx, joiningId);
  if (!joining) throw new NotFoundError('Joining record not found');

  const candidate = await repo.findCandidateById(ctx, joining.candidateId);
  if (!candidate) throw new NotFoundError('Candidate not found');

  const offer = await repo.findOfferById(ctx, joining.offerId);
  const requisition = offer ? await repo.findRequisitionById(ctx, offer.requisitionId) : null;

  const vars: Record<string, string> = {
    candidate_name: `${candidate.firstName} ${candidate.lastName}`.trim(),
    role: offer?.positionName ?? requisition?.title ?? '',
    department: requisition?.departmentName ?? '',
    joining_date: joining.expectedJoiningDate
      ? new Date(joining.expectedJoiningDate).toLocaleDateString('en-IN', { dateStyle: 'long' })
      : '',
    reporting_manager: '',
    company_name: ctx.organizationId,
  };

  const token = crypto.randomBytes(32).toString('hex');
  const acknowledgeUrl = `${process.env['PUBLIC_BASE_URL'] ?? ''}/api/public/recruitment/acknowledge/${token}`;

  const acknowledgeButton = `\n\n---\nTo confirm your joining, please click: ${acknowledgeUrl}`;

  const subject = renderEmailTemplate(input.subject, vars);
  const bodyText = renderEmailTemplate(input.body, vars) + acknowledgeButton;

  await sendEmail({
    to: candidate.email,
    subject,
    text: bodyText,
  });

  await db.transaction(ctx, async (tx) => {
    await tx.query(sql`
      UPDATE candidate_joining
      SET joining_email_sent_at = now(),
          joining_email_template_id = ${input.templateId ?? null},
          acknowledge_token = ${token}
      WHERE organization_id = ${ctx.organizationId} AND id = ${joiningId}
    `);
    await tx.query(sql`
      INSERT INTO recruitment_candidate_event
        (organization_id, candidate_id, event_type, actor_id, metadata)
      VALUES (
        ${ctx.organizationId},
        ${candidate.id},
        'joining_email_sent',
        ${ctx.principal.id},
        ${JSON.stringify({ templateId: input.templateId ?? null })}::jsonb
      )
    `);
  });

  return { message: 'Joining email sent' };
}

// ---------------------------------------------------------------------
// Public: Acknowledge joining (called from public-routes.ts — no user ctx)
// ---------------------------------------------------------------------

export async function acknowledgeJoining(
  token: string,
  ip: string,
): Promise<{ acknowledged: boolean }> {
  const joining = await repo.findJoiningByAcknowledgeToken(token);
  if (!joining) throw new NotFoundError('Invalid or expired token');

  if (joining.acknowledgedAt) {
    return { acknowledged: true };
  }

  // Build minimal context from the joining record so db.transaction can set tenant context
  const systemCtx = {
    organizationId: joining.organizationId,
    principal: { id: 'system', email: '' },
  } as unknown as RequestContext;

  await db.transaction(systemCtx, async (tx) => {
    await tx.query(sql`
      UPDATE candidate_joining
      SET acknowledged_at = now(),
          acknowledge_ip = ${ip}
      WHERE id = ${joining.id}
    `);
    await tx.query(sql`
      INSERT INTO recruitment_candidate_event
        (organization_id, candidate_id, event_type, actor_id, metadata)
      VALUES (
        ${joining.organizationId},
        ${joining.candidateId},
        'acknowledged',
        NULL,
        NULL
      )
    `);
    if (joining.createdBy) {
      try {
        await notify(tx, systemCtx, {
          type: NOTIFICATION_TYPES.RECRUITMENT_CANDIDATE_ACKNOWLEDGED,
          priority: 'operational',
          audience: { users: [joining.createdBy] },
          title: 'Candidate acknowledged joining',
          body: 'A candidate has acknowledged their joining offer',
          link: '/company/recruitment?tab=joining',
          metadata: { joiningId: joining.id, candidateId: joining.candidateId },
        });
      } catch {
        // notification failure must not abort the acknowledgement
      }
    }
  });

  return { acknowledged: true };
}
