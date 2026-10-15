import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { AssignedInterview, CandidateRound } from '../types.js';
import type { CreateCandidateRoundInput } from '../validators.js';

const ROUND_COLUMNS = sql`
  cr.id,
  cr.organization_id,
  cr.candidate_id,
  cr.pipeline_round_id,
  pr.name  AS pipeline_round_name,
  pr.order_index AS pipeline_round_order,
  cr.assigned_to,
  u.full_name AS assigned_to_name,
  cr.scheduled_at,
  cr.mode,
  cr.meeting_link,
  cr.location,
  cr.status,
  cr.interviewer_notes,
  cr.rating,
  cr.recommendation,
  cr.passed_at,
  cr.failed_at,
  cr.created_at,
  cr.updated_at
`;

export async function listCandidateRounds(
  ctx: RequestContext,
  candidateId: string,
): Promise<CandidateRound[]> {
  return db.query<CandidateRound>(
    ctx,
    sql`
      SELECT ${ROUND_COLUMNS}
      FROM recruitment_candidate_round cr
      JOIN recruitment_pipeline_round pr
        ON pr.organization_id = cr.organization_id AND pr.id = cr.pipeline_round_id
      LEFT JOIN app_user u
        ON u.organization_id = cr.organization_id AND u.id = cr.assigned_to
      WHERE cr.organization_id = ${ctx.organizationId}
        AND cr.candidate_id = ${candidateId}
      ORDER BY pr.order_index ASC, cr.created_at ASC
    `,
  );
}

export async function findCandidateRoundById(
  ctx: RequestContext,
  id: string,
): Promise<CandidateRound | null> {
  return db.maybeOne<CandidateRound>(
    ctx,
    sql`
      SELECT ${ROUND_COLUMNS}
      FROM recruitment_candidate_round cr
      JOIN recruitment_pipeline_round pr
        ON pr.organization_id = cr.organization_id AND pr.id = cr.pipeline_round_id
      LEFT JOIN app_user u
        ON u.organization_id = cr.organization_id AND u.id = cr.assigned_to
      WHERE cr.organization_id = ${ctx.organizationId} AND cr.id = ${id}
    `,
  );
}

export async function createCandidateRound(
  ctx: RequestContext,
  input: CreateCandidateRoundInput,
): Promise<CandidateRound> {
  const inserted = await db.one<{ id: string }>(
    ctx,
    sql`
      INSERT INTO recruitment_candidate_round (
        organization_id,
        candidate_id,
        pipeline_round_id,
        assigned_to,
        scheduled_at,
        mode,
        meeting_link,
        location
      )
      VALUES (
        ${ctx.organizationId},
        ${input.candidateId},
        ${input.pipelineRoundId},
        ${input.assignedTo ?? null},
        ${input.scheduledAt ? sql`${input.scheduledAt}::timestamptz` : null},
        ${input.mode ?? null},
        ${input.meetingLink ?? null},
        ${input.location ?? null}
      )
      RETURNING id
    `,
  );
  const round = await findCandidateRoundById(ctx, inserted.id);
  if (!round) throw new Error('Failed to retrieve created candidate round');
  return round;
}

export interface UpdateCandidateRoundFields {
  readonly assignedTo?: string | null;
  readonly scheduledAt?: string | null;
  readonly mode?: string | null;
  readonly meetingLink?: string | null;
  readonly location?: string | null;
  readonly status?: string;
  readonly interviewerNotes?: string | null;
  readonly rating?: number | null;
  readonly recommendation?: string | null;
  readonly passedAt?: string | null;
  readonly failedAt?: string | null;
}

export async function updateCandidateRound(
  ctx: RequestContext,
  id: string,
  fields: UpdateCandidateRoundFields,
): Promise<CandidateRound | null> {
  const setClauses = [];
  if ('assignedTo' in fields) setClauses.push(sql`assigned_to = ${fields.assignedTo ?? null}`);
  if ('scheduledAt' in fields) setClauses.push(sql`scheduled_at = ${fields.scheduledAt ? sql`${fields.scheduledAt}::timestamptz` : null}`);
  if ('mode' in fields) setClauses.push(sql`mode = ${fields.mode ?? null}`);
  if ('meetingLink' in fields) setClauses.push(sql`meeting_link = ${fields.meetingLink ?? null}`);
  if ('location' in fields) setClauses.push(sql`location = ${fields.location ?? null}`);
  if ('status' in fields && fields.status !== undefined) setClauses.push(sql`status = ${fields.status}`);
  if ('interviewerNotes' in fields) setClauses.push(sql`interviewer_notes = ${fields.interviewerNotes ?? null}`);
  if ('rating' in fields) setClauses.push(sql`rating = ${fields.rating ?? null}`);
  if ('recommendation' in fields) setClauses.push(sql`recommendation = ${fields.recommendation ?? null}`);
  if ('passedAt' in fields) setClauses.push(sql`passed_at = ${fields.passedAt ? sql`${fields.passedAt}::timestamptz` : null}`);
  if ('failedAt' in fields) setClauses.push(sql`failed_at = ${fields.failedAt ? sql`${fields.failedAt}::timestamptz` : null}`);

  if (setClauses.length === 0) return findCandidateRoundById(ctx, id);

  await db.query(
    ctx,
    sql`
      UPDATE recruitment_candidate_round
      SET ${sql.join(setClauses, ', ')}
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `,
  );
  return findCandidateRoundById(ctx, id);
}

/** The caller's own rounds, with the candidate and job they are for. */
export async function listMyInterviews(ctx: RequestContext): Promise<AssignedInterview[]> {
  return db.query<AssignedInterview>(
    ctx,
    sql`
      SELECT ${ROUND_COLUMNS},
        concat_ws(' ', c.first_name, c.last_name) AS candidate_name,
        r.title AS requisition_title,
        r.requisition_number,
        pr.interviewer_note AS interviewer_brief,
        (c.resume_object_key IS NOT NULL) AS has_resume
      FROM recruitment_candidate_round cr
      JOIN recruitment_pipeline_round pr
        ON pr.organization_id = cr.organization_id AND pr.id = cr.pipeline_round_id
      JOIN candidate c
        ON c.organization_id = cr.organization_id AND c.id = cr.candidate_id AND c.deleted_at IS NULL
      JOIN job_requisition r
        ON r.organization_id = c.organization_id AND r.id = c.requisition_id
      LEFT JOIN app_user u
        ON u.organization_id = cr.organization_id AND u.id = cr.assigned_to
      WHERE cr.organization_id = ${ctx.organizationId}
        AND cr.assigned_to = ${ctx.principal.id}
        AND cr.status NOT IN ('skipped', 'failed')
      ORDER BY cr.scheduled_at ASC NULLS LAST, cr.created_at DESC
    `,
  );
}
