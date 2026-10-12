import type { AtsCriteria, AtsEvaluation } from '@tapcrm/contracts';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { NotEligibleError, NotFoundError } from '../../../platform/http/error-handler.js';

export interface AtsCriteriaRow {
  readonly requisitionId: string;
  readonly criteria: AtsCriteria;
  readonly criteriaHash: string;
  readonly updatedAt: Date | string;
}

export interface AtsScanRow {
  readonly id: string;
  readonly submissionId: string;
  readonly requisitionId: string;
  readonly criteria: AtsCriteria;
  readonly criteriaHash: string;
  readonly resumeHash: string;
  readonly resumeVersion: string;
  readonly engineVersion: string;
  readonly evaluation: AtsEvaluation;
  readonly scannedBy: string;
  readonly scannedByName: string | null;
  readonly createdAt: Date | string;
}

export type NewAtsScan = Omit<AtsScanRow, 'id' | 'createdAt' | 'scannedByName'>;

export interface AtsScanSummaryRow {
  readonly submissionId: string;
  readonly scanId: string;
  readonly requisitionId: string;
  readonly criteriaHash: string;
  readonly engineVersion: string;
  readonly evaluation: Pick<AtsEvaluation, 'status' | 'score' | 'checks'>;
  readonly createdAt: Date | string;
}

const SCAN_COLUMNS = sql`
  s.id, s.submission_id, s.requisition_id, s.criteria, s.criteria_hash,
  s.resume_hash, s.resume_version, s.engine_version, s.evaluation, s.scanned_by,
  u.full_name AS scanned_by_name, s.created_at
`;

const SCAN_FROM = sql`
  FROM recruitment_ats_scan s
  LEFT JOIN app_user u ON u.organization_id = s.organization_id AND u.id = s.scanned_by
`;

export async function findCriteria(ctx: RequestContext, requisitionId: string): Promise<AtsCriteriaRow | null> {
  return db.maybeOne<AtsCriteriaRow>(ctx, sql`
    SELECT requisition_id, criteria, criteria_hash, updated_at
    FROM recruitment_ats_criteria
    WHERE organization_id = ${ctx.organizationId} AND requisition_id = ${requisitionId}
  `);
}

export async function findCriteriaForRequisitions(
  ctx: RequestContext,
  requisitionIds: readonly string[],
): Promise<AtsCriteriaRow[]> {
  if (requisitionIds.length === 0) return [];
  return db.query<AtsCriteriaRow>(ctx, sql`
    SELECT requisition_id, criteria, criteria_hash, updated_at
    FROM recruitment_ats_criteria
    WHERE organization_id = ${ctx.organizationId} AND requisition_id = ANY(${[...requisitionIds]}::uuid[])
  `);
}

export async function saveCriteria(
  ctx: RequestContext, requisitionId: string, criteria: AtsCriteria, criteriaHash: string,
): Promise<AtsCriteriaRow> {
  return db.one<AtsCriteriaRow>(ctx, sql`
    INSERT INTO recruitment_ats_criteria
      (organization_id, requisition_id, criteria, criteria_hash, updated_by)
    VALUES (${ctx.organizationId}, ${requisitionId}, ${JSON.stringify(criteria)}::jsonb,
      ${criteriaHash}, ${ctx.principal.id})
    ON CONFLICT (organization_id, requisition_id) DO UPDATE
      SET criteria = EXCLUDED.criteria, criteria_hash = EXCLUDED.criteria_hash,
          updated_by = EXCLUDED.updated_by, updated_at = now()
    RETURNING requisition_id, criteria, criteria_hash, updated_at
  `);
}

export async function listScans(ctx: RequestContext, submissionId: string): Promise<AtsScanRow[]> {
  return db.query<AtsScanRow>(ctx, sql`
    SELECT ${SCAN_COLUMNS}
    ${SCAN_FROM}
    WHERE s.organization_id = ${ctx.organizationId} AND s.submission_id = ${submissionId}
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT 20
  `);
}

export async function findMatchingScan(ctx: RequestContext, input: {
  readonly submissionId: string;
  readonly resumeHash: string;
  readonly criteriaHash: string;
  readonly engineVersion: string;
}): Promise<AtsScanRow | null> {
  return db.maybeOne<AtsScanRow>(ctx, sql`
    SELECT ${SCAN_COLUMNS}
    ${SCAN_FROM}
    WHERE s.organization_id = ${ctx.organizationId} AND s.submission_id = ${input.submissionId}
      AND s.resume_hash = ${input.resumeHash} AND s.criteria_hash = ${input.criteriaHash}
      AND s.engine_version = ${input.engineVersion}
  `);
}

/** Latest scan per application, for list views. */
export async function latestScanSummaries(
  ctx: RequestContext,
  submissionIds: readonly string[],
): Promise<AtsScanSummaryRow[]> {
  if (submissionIds.length === 0) return [];
  return db.query<AtsScanSummaryRow>(ctx, sql`
    SELECT DISTINCT ON (s.submission_id)
      s.submission_id, s.id AS scan_id, s.requisition_id, s.criteria_hash, s.engine_version,
      jsonb_build_object(
        'status', s.evaluation->'status',
        'score', s.evaluation->'score',
        'checks', s.evaluation->'checks'
      ) AS evaluation,
      s.created_at
    FROM recruitment_ats_scan s
    WHERE s.organization_id = ${ctx.organizationId} AND s.submission_id = ANY(${[...submissionIds]}::uuid[])
    ORDER BY s.submission_id, s.created_at DESC, s.id DESC
  `);
}

/**
 * Appends one immutable report. Locks the application row so a scan cannot be
 * recorded after HR has accepted or rejected it, and is idempotent: the same
 * resume, criteria and engine version return the existing report.
 * Scanning never changes the application's status.
 */
export async function saveScan(ctx: RequestContext, input: NewAtsScan): Promise<AtsScanRow> {
  const id = await db.transaction(ctx, async (tx) => {
    const submission = await tx.maybeOne<{ status: string; requisitionId: string }>(sql`
      SELECT status, requisition_id FROM candidate_resume_submission
      WHERE organization_id = ${ctx.organizationId} AND id = ${input.submissionId}
      FOR UPDATE
    `);
    if (!submission) throw new NotFoundError('Resume submission');
    if (submission.status === 'converted' || submission.status === 'rejected') {
      throw new NotEligibleError(
        'ATS_APPLICATION_CLOSED',
        'This application has already been accepted or rejected. Its existing ATS reports remain available.',
        { unmet: ['application is open for review'], required: ['submitted', 'reviewed'], actual: submission.status },
      );
    }
    if (submission.requisitionId !== input.requisitionId) {
      throw new NotEligibleError(
        'ATS_APPLICATION_JOB_CHANGED',
        'The application now belongs to a different job. Reload it and run a new scan.',
        { unmet: ['scan criteria belong to the application job'] },
      );
    }
    const inserted = await tx.maybeOne<{ id: string }>(sql`
      INSERT INTO recruitment_ats_scan
        (organization_id, submission_id, requisition_id, criteria, criteria_hash,
         resume_hash, resume_version, engine_version, evaluation, scanned_by)
      VALUES (${ctx.organizationId}, ${input.submissionId}, ${input.requisitionId},
        ${JSON.stringify(input.criteria)}::jsonb, ${input.criteriaHash}, ${input.resumeHash},
        ${input.resumeVersion}, ${input.engineVersion}, ${JSON.stringify(input.evaluation)}::jsonb,
        ${input.scannedBy})
      ON CONFLICT (organization_id, submission_id, resume_hash, criteria_hash, engine_version)
        DO NOTHING
      RETURNING id
    `);
    if (inserted) return inserted.id;
    const existing = await tx.one<{ id: string }>(sql`
      SELECT id FROM recruitment_ats_scan
      WHERE organization_id = ${ctx.organizationId} AND submission_id = ${input.submissionId}
        AND resume_hash = ${input.resumeHash} AND criteria_hash = ${input.criteriaHash}
        AND engine_version = ${input.engineVersion}
    `);
    return existing.id;
  });

  return db.one<AtsScanRow>(ctx, sql`
    SELECT ${SCAN_COLUMNS}
    ${SCAN_FROM}
    WHERE s.organization_id = ${ctx.organizationId} AND s.id = ${id}
  `);
}
