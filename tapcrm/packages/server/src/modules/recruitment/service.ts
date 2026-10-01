import crypto from 'node:crypto';
import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import {
  ConflictError,
  NotEligibleError,
  NotFoundError,
} from '../../platform/http/error-handler.js';
import { PlatformValidationError } from '../../platform/errors.js';
import { provisionEmployee } from '../employee/index.js';
import {
  notifyCandidateRejection,
  notifyInterviewRescheduled,
  notifyInterviewScheduled,
  notifyOnboardingWelcome,
} from './notifications.js';
import { parseResume } from './parser.js';
import * as repo from './repository.js';
import {
  generateResumeObjectKey,
  getStorageService,
  validateResumeUpload,
} from './storage.js';
import type {
  Candidate,
  CandidateJoining,
  CandidateResumeSubmission,
  CandidateStatus,
  Interview,
  InterviewFeedback,
  InterviewStatus,
  JobOffer,
  JobRequisition,
  OfferStatus,
  ParsedCandidateData,
  PublicJobRequisitionDetails,
  RecruitmentApplicationLink,
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
  ConvertSubmissionInput,
  CreateApplicationLinkInput,
  CreateCandidateInput,
  CreateJoiningInput,
  CreateOfferInput,
  CreateRequisitionInput,
  HireCandidateInput,
  HrManualSubmissionInput,
  InterviewDecisionInput,
  PublicApplyInput,
  RescheduleInterviewInput,
  ScheduleInterviewInput,
  SubmitFeedbackInput,
  UpdateFeedbackInput,
  UpdateApplicationLinkStatusInput,
  UpdateCandidateStatusInput,
  UpdateJoiningInput,
  UpdateJoiningStatusInput,
  UpdateOfferInput,
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
    const storage = getStorageService();
    const obj = await storage.getObject(input.resumeObjectKey);
    buffer = obj.buffer;
    if (obj.mimeType) mimeType = obj.mimeType;
  } else if (input.fileBase64) {
    const cleanBase64 = input.fileBase64.replace(/^data:[^;]+;base64,/, '');
    buffer = Buffer.from(cleanBase64, 'base64');
  } else {
    throw new Error('Either resumeObjectKey or fileBase64 must be provided');
  }

  const parsed = parseResume(buffer, filename, mimeType);

  let firstName: string | null = null;
  let lastName: string | null = null;
  if (parsed.name && parsed.name.trim()) {
    const parts = parsed.name.trim().split(/\s+/);
    if (parts.length === 1) {
      firstName = parts[0]!;
      lastName = '';
    } else if (parts.length > 1) {
      firstName = parts[0]!;
      lastName = parts.slice(1).join(' ');
    }
  }

  return {
    parsed: {
      name: parsed.name ?? null,
      firstName,
      lastName,
      email: parsed.email ?? null,
      phone: parsed.phone ?? null,
      skills: parsed.skills ?? [],
      education: parsed.education,
      experience: parsed.experience,
      summary: parsed.summary,
      rawTextPreview: parsed.rawTextPreview,
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

  // Parse structured data from resume
  const parsedData = parseResume(buffer, input.resumeFilename, input.resumeMimeType);

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

  const parsedData = input.parsedData ?? parseResume(buffer, input.resumeFilename, input.resumeMimeType);

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
): Promise<CandidateResumeSubmission[]> {
  return repo.listResumeSubmissions(ctx, filter);
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

  const storage = getStorageService();
  const url = await storage.getSignedUrl(sub.resumeObjectKey, 900);
  return { url, filename: sub.resumeFilename };
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
