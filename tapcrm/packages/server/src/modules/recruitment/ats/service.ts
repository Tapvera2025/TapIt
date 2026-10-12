import type {
  AtsCriteria,
  AtsCriteriaSettings,
  AtsScanReport,
  AtsScanSummary,
  AtsSubmissionScanState,
} from '@tapcrm/contracts';
import type { RequestContext } from '../../../platform/dal/context.js';
import { NotEligibleError, NotFoundError } from '../../../platform/http/error-handler.js';
import * as recruitmentRepo from '../repository.js';
import { extractResumeText } from '../resume-text.js';
import { getStorageService } from '../storage.js';
import type { CandidateResumeSubmission, JobRequisition } from '../types.js';
import {
  criteriaHash,
  hasScreeningRequirement,
  normalizeCriteria,
  sha256,
  suggestCriteria,
} from './criteria.js';
import { ATS_ENGINE_VERSION, countMissingRequired, evaluateResume } from './engine.js';
import * as atsRepo from './repository.js';

/**
 * ATS screening use cases.
 *
 * Criteria belong to the job (requisition) so every applicant to a job is
 * measured against the same yardstick. Each scan is stored as an immutable
 * report with the exact criteria, resume fingerprint and engine version used,
 * so a score can always be explained later. Scanning never changes an
 * application's status — accepting or rejecting stays an HR decision.
 */

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function requireRequisition(ctx: RequestContext, requisitionId: string): Promise<JobRequisition> {
  const requisition = await recruitmentRepo.findRequisitionById(ctx, requisitionId);
  if (!requisition) throw new NotFoundError('Job requisition');
  return requisition;
}

async function requireSubmission(ctx: RequestContext, submissionId: string): Promise<CandidateResumeSubmission> {
  const submission = await recruitmentRepo.findResumeSubmissionById(ctx, submissionId);
  if (!submission) throw new NotFoundError('Resume submission');
  return submission;
}

function settingsFor(requisition: JobRequisition, row: atsRepo.AtsCriteriaRow | null): AtsCriteriaSettings {
  if (row) {
    return {
      requisitionId: requisition.id,
      criteria: row.criteria,
      criteriaHash: row.criteriaHash,
      updatedAt: iso(row.updatedAt),
      configured: true,
    };
  }
  const suggested = suggestCriteria(requisition);
  return {
    requisitionId: requisition.id,
    criteria: suggested,
    criteriaHash: criteriaHash(suggested),
    updatedAt: null,
    configured: false,
  };
}

export async function getCriteriaSettings(ctx: RequestContext, requisitionId: string): Promise<AtsCriteriaSettings> {
  const requisition = await requireRequisition(ctx, requisitionId);
  return settingsFor(requisition, await atsRepo.findCriteria(ctx, requisitionId));
}

export async function saveCriteriaSettings(
  ctx: RequestContext,
  requisitionId: string,
  input: AtsCriteria,
): Promise<AtsCriteriaSettings> {
  const requisition = await requireRequisition(ctx, requisitionId);
  const criteria = normalizeCriteria(input);
  if (!hasScreeningRequirement(criteria)) {
    throw new NotEligibleError(
      'ATS_CRITERIA_EMPTY',
      'Add at least one required skill, qualification or minimum experience before saving.',
      { unmet: ['at least one screening requirement'] },
    );
  }
  const row = await atsRepo.saveCriteria(ctx, requisitionId, criteria, criteriaHash(criteria));
  return settingsFor(requisition, row);
}

function toReport(
  row: atsRepo.AtsScanRow,
  submission: Pick<CandidateResumeSubmission, 'requisitionId'>,
  currentCriteriaHash: string | null,
): AtsScanReport {
  return {
    ...row.evaluation,
    id: row.id,
    submissionId: row.submissionId,
    requisitionId: row.requisitionId,
    criteria: row.criteria,
    criteriaHash: row.criteriaHash,
    resumeHash: row.resumeHash,
    engineVersion: row.engineVersion,
    scannedBy: row.scannedBy,
    scannedByName: row.scannedByName,
    createdAt: iso(row.createdAt),
    stale: row.engineVersion !== ATS_ENGINE_VERSION
      || row.requisitionId !== submission.requisitionId
      || currentCriteriaHash === null
      || row.criteriaHash !== currentCriteriaHash,
  };
}

export async function getSubmissionScanState(
  ctx: RequestContext,
  submissionId: string,
): Promise<AtsSubmissionScanState> {
  const submission = await requireSubmission(ctx, submissionId);
  const [requisition, criteriaRow, scans] = await Promise.all([
    requireRequisition(ctx, submission.requisitionId),
    atsRepo.findCriteria(ctx, submission.requisitionId),
    atsRepo.listScans(ctx, submissionId),
  ]);
  const settings = settingsFor(requisition, criteriaRow);
  return {
    settings,
    scans: scans.map((row) => toReport(row, submission, criteriaRow?.criteriaHash ?? null)),
  };
}

export async function runSubmissionScan(ctx: RequestContext, submissionId: string): Promise<AtsScanReport> {
  const submission = await requireSubmission(ctx, submissionId);
  if (submission.status === 'converted' || submission.status === 'rejected') {
    throw new NotEligibleError(
      'ATS_APPLICATION_CLOSED',
      'This application has already been accepted or rejected, so it cannot be scanned again. Its existing ATS reports remain available.',
      { unmet: ['application is open for review'], required: ['submitted', 'reviewed'], actual: submission.status },
    );
  }

  const criteriaRow = await atsRepo.findCriteria(ctx, submission.requisitionId);
  if (!criteriaRow) {
    throw new NotEligibleError(
      'ATS_CRITERIA_NOT_CONFIGURED',
      'Set the screening criteria for this job before running an ATS scan.',
      { unmet: ['ATS criteria saved for the job'] },
    );
  }

  let file: { buffer: Buffer };
  try {
    file = await getStorageService().getObject(submission.resumeObjectKey);
  } catch {
    throw new NotEligibleError(
      'ATS_RESUME_UNAVAILABLE',
      'The resume file for this application could not be loaded from storage.',
      { unmet: ['resume file available'] },
    );
  }

  const resumeHash = sha256(file.buffer);
  const existing = await atsRepo.findMatchingScan(ctx, {
    submissionId,
    resumeHash,
    criteriaHash: criteriaRow.criteriaHash,
    engineVersion: ATS_ENGINE_VERSION,
  });
  if (existing) return toReport(existing, submission, criteriaRow.criteriaHash);

  const extraction = await extractResumeText(file.buffer, submission.resumeFilename, submission.resumeMimeType);
  const evaluation = evaluateResume(extraction, criteriaRow.criteria, { asOf: new Date() });

  const saved = await atsRepo.saveScan(ctx, {
    submissionId,
    requisitionId: submission.requisitionId,
    criteria: criteriaRow.criteria,
    criteriaHash: criteriaRow.criteriaHash,
    resumeHash,
    resumeVersion: sha256(extraction.text),
    engineVersion: ATS_ENGINE_VERSION,
    evaluation,
    scannedBy: ctx.principal.id,
  });
  return toReport(saved, submission, criteriaRow.criteriaHash);
}

/** Adds each application's latest ATS result, for the Resume Inbox list. */
export async function attachScanSummaries<T extends Pick<CandidateResumeSubmission, 'id' | 'requisitionId'>>(
  ctx: RequestContext,
  submissions: readonly T[],
): Promise<(T & { ats: AtsScanSummary | null })[]> {
  if (submissions.length === 0) return [];
  const [summaries, criteria] = await Promise.all([
    atsRepo.latestScanSummaries(ctx, submissions.map((submission) => submission.id)),
    atsRepo.findCriteriaForRequisitions(ctx, [...new Set(submissions.map((submission) => submission.requisitionId))]),
  ]);
  const bySubmission = new Map(summaries.map((summary) => [summary.submissionId, summary]));
  const hashByRequisition = new Map(criteria.map((row) => [row.requisitionId, row.criteriaHash]));

  return submissions.map((submission) => {
    const summary = bySubmission.get(submission.id);
    if (!summary) return { ...submission, ats: null };
    return {
      ...submission,
      ats: {
        scanId: summary.scanId,
        status: summary.evaluation.status,
        score: summary.evaluation.score,
        missingRequired: summary.evaluation.status === 'needs_review'
          ? 0
          : countMissingRequired({ checks: summary.evaluation.checks ?? [] }),
        scannedAt: iso(summary.createdAt),
        stale: summary.engineVersion !== ATS_ENGINE_VERSION
          || summary.requisitionId !== submission.requisitionId
          || summary.criteriaHash !== hashByRequisition.get(submission.requisitionId),
      },
    };
  });
}
