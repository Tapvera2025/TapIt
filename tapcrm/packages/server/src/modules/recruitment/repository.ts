import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { bootstrapDb, db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type {
  Candidate,
  CandidateJoining,
  CandidateResumeSubmission,
  Interview,
  InterviewFeedback,
  JobOffer,
  JobRequisition,
  ParsedResumeData,
  RecruitmentApplicationLink,
  RecruitmentMetrics,
} from './types.js';
import type {
  ConvertSubmissionInput,
  CreateApplicationLinkInput,
  CreateCandidateInput,
  CreateJoiningInput,
  CreateOfferInput,
  CreateRequisitionInput,
  InterviewDecisionInput,
  RescheduleInterviewInput,
  ScheduleInterviewInput,
  SubmitFeedbackInput,
  UpdateFeedbackInput,
  UpdateJoiningInput,
  UpdateOfferInput,
} from './validators.js';

// ---------------------------------------------------------------------
// 1. Requisitions
// ---------------------------------------------------------------------

export interface RequisitionFilter {
  readonly search?: string | undefined;
  readonly status?: string | undefined;
  readonly departmentId?: string | undefined;
  readonly employmentType?: string | undefined;
}

export async function listRequisitions(
  ctx: RequestContext,
  filter?: RequisitionFilter,
): Promise<JobRequisition[]> {
  const whereClauses: SqlFragment[] = [
    sql`r.organization_id = ${ctx.organizationId}`,
  ];

  if (filter?.status && filter.status !== 'all') {
    whereClauses.push(sql`r.status = ${filter.status}`);
  }
  if (filter?.departmentId) {
    whereClauses.push(sql`r.department_id = ${filter.departmentId}`);
  }
  if (filter?.employmentType && filter.employmentType !== 'all') {
    whereClauses.push(sql`r.employment_type = ${filter.employmentType}`);
  }
  if (filter?.search?.trim()) {
    const pattern = `%${filter.search.trim()}%`;
    whereClauses.push(sql`(r.title ILIKE ${pattern} OR r.requisition_number ILIKE ${pattern})`);
  }

  return db.query<JobRequisition>(
    ctx,
    sql`
      SELECT
        r.id,
        r.organization_id,
        r.requisition_number,
        r.title,
        r.department_id,
        d.name AS department_name,
        r.position_id,
        p.name AS position_name,
        r.openings_count,
        r.employment_type,
        r.location,
        r.description,
        r.requirements,
        r.status,
        to_char(r.target_hire_date, 'YYYY-MM-DD') AS target_hire_date,
        r.closed_at,
        r.created_by,
        r.created_at,
        r.updated_at
      FROM job_requisition r
      JOIN department d ON d.organization_id = r.organization_id AND d.id = r.department_id
      LEFT JOIN position p ON p.organization_id = r.organization_id AND p.id = r.position_id
      WHERE ${sql.join(whereClauses, ' AND ')}
      ORDER BY r.created_at DESC
    `,
  );
}

export async function findRequisitionById(
  ctx: RequestContext,
  id: string,
): Promise<JobRequisition | null> {
  return db.maybeOne<JobRequisition>(
    ctx,
    sql`
      SELECT
        r.id,
        r.organization_id,
        r.requisition_number,
        r.title,
        r.department_id,
        d.name AS department_name,
        r.position_id,
        p.name AS position_name,
        r.openings_count,
        r.employment_type,
        r.location,
        r.description,
        r.requirements,
        r.status,
        to_char(r.target_hire_date, 'YYYY-MM-DD') AS target_hire_date,
        r.closed_at,
        r.created_by,
        r.created_at,
        r.updated_at
      FROM job_requisition r
      JOIN department d ON d.organization_id = r.organization_id AND d.id = r.department_id
      LEFT JOIN position p ON p.organization_id = r.organization_id AND p.id = r.position_id
      WHERE r.organization_id = ${ctx.organizationId} AND r.id = ${id}
    `,
  );
}

export async function createRequisition(
  ctx: RequestContext,
  input: CreateRequisitionInput,
): Promise<JobRequisition> {
  const countRow = await db.one<{ count: number }>(
    ctx,
    sql`SELECT count(*)::integer AS count FROM job_requisition WHERE organization_id = ${ctx.organizationId}`,
  );
  const year = new Date().getFullYear();
  const num = String((countRow?.count ?? 0) + 1).padStart(3, '0');
  const requisitionNumber = `REQ-${year}-${num}`;

  const inserted = await db.one<{ id: string }>(
    ctx,
    sql`
      INSERT INTO job_requisition (
        organization_id,
        requisition_number,
        title,
        department_id,
        position_id,
        openings_count,
        employment_type,
        location,
        description,
        requirements,
        status,
        target_hire_date,
        created_by
      )
      VALUES (
        ${ctx.organizationId},
        ${requisitionNumber},
        ${input.title},
        ${input.departmentId},
        ${input.positionId ?? null},
        ${input.openingsCount},
        ${input.employmentType},
        ${input.location ?? null},
        ${input.description ?? null},
        ${input.requirements ?? null},
        ${input.status ?? 'draft'},
        ${input.targetHireDate ? sql`${input.targetHireDate}::date` : null},
        ${ctx.principal.id}
      )
      RETURNING id
    `,
  );

  const full = await findRequisitionById(ctx, inserted.id);
  if (!full) throw new Error('Failed to retrieve created requisition');
  return full;
}

export async function updateRequisitionStatus(
  ctx: RequestContext,
  id: string,
  status: string,
): Promise<JobRequisition | null> {
  const isClosing = status === 'filled' || status === 'closed' || status === 'cancelled';
  await db.query(
    ctx,
    sql`
      UPDATE job_requisition
      SET status = ${status},
          closed_at = ${isClosing ? sql`now()` : null}
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `,
  );
  return findRequisitionById(ctx, id);
}

// ---------------------------------------------------------------------
// 2. Candidates
// ---------------------------------------------------------------------

export interface CandidateFilter {
  readonly search?: string | undefined;
  readonly status?: string | undefined;
  readonly requisitionId?: string | undefined;
  readonly source?: string | undefined;
}

export async function listCandidates(
  ctx: RequestContext,
  filter?: CandidateFilter,
): Promise<Candidate[]> {
  const whereClauses: SqlFragment[] = [
    sql`c.organization_id = ${ctx.organizationId}`,
  ];

  if (filter?.status && filter.status !== 'all') {
    whereClauses.push(sql`c.status = ${filter.status}`);
  }
  if (filter?.requisitionId) {
    whereClauses.push(sql`c.requisition_id = ${filter.requisitionId}`);
  }
  if (filter?.source && filter.source !== 'all') {
    whereClauses.push(sql`c.source = ${filter.source}`);
  }
  if (filter?.search?.trim()) {
    const pattern = `%${filter.search.trim()}%`;
    whereClauses.push(sql`(
      c.first_name ILIKE ${pattern} OR
      c.last_name ILIKE ${pattern} OR
      c.email ILIKE ${pattern} OR
      concat(c.first_name, ' ', c.last_name) ILIKE ${pattern}
    )`);
  }

  return db.query<Candidate>(
    ctx,
    sql`
      SELECT
        c.id,
        c.organization_id,
        c.requisition_id,
        r.title AS requisition_title,
        r.requisition_number AS requisition_number,
        c.first_name,
        c.last_name,
        concat(c.first_name, ' ', c.last_name) AS full_name,
        c.email,
        c.phone,
        c.resume_url,
        c.resume_object_key,
        c.resume_file_name,
        c.resume_mime_type,
        c.resume_size,
        c.resume_uploaded_at,
        c.source,
        c.status,
        c.screening_notes,
        c.rejection_reason,
        c.created_by,
        c.created_at,
        c.updated_at
      FROM candidate c
      JOIN job_requisition r ON r.organization_id = c.organization_id AND r.id = c.requisition_id
      WHERE ${sql.join(whereClauses, ' AND ')}
      ORDER BY c.created_at DESC
    `,
  );
}

export async function findCandidateById(
  ctx: RequestContext,
  id: string,
  tx?: Tx,
): Promise<Candidate | null> {
  const query = sql`
    SELECT
      c.id,
      c.organization_id,
      c.requisition_id,
      r.title AS requisition_title,
      r.requisition_number AS requisition_number,
      c.first_name,
      c.last_name,
      concat(c.first_name, ' ', c.last_name) AS full_name,
      c.email,
      c.phone,
      c.resume_url,
      c.resume_object_key,
      c.resume_file_name,
      c.resume_mime_type,
      c.resume_size,
      c.resume_uploaded_at,
      c.source,
      c.status,
      c.screening_notes,
      c.rejection_reason,
      c.created_by,
      c.created_at,
      c.updated_at
    FROM candidate c
    JOIN job_requisition r ON r.organization_id = c.organization_id AND r.id = c.requisition_id
    WHERE c.organization_id = ${ctx.organizationId} AND c.id = ${id}
  `;
  return tx ? tx.maybeOne<Candidate>(query) : db.maybeOne<Candidate>(ctx, query);
}

export async function createCandidate(
  ctx: RequestContext,
  input: CreateCandidateInput,
): Promise<Candidate> {
  const inserted = await db.one<{ id: string }>(
    ctx,
    sql`
      INSERT INTO candidate (
        organization_id,
        requisition_id,
        first_name,
        last_name,
        email,
        phone,
        resume_url,
        resume_object_key,
        resume_file_name,
        resume_mime_type,
        resume_size,
        resume_uploaded_at,
        source,
        screening_notes,
        created_by
      )
      VALUES (
        ${ctx.organizationId},
        ${input.requisitionId},
        ${input.firstName},
        ${input.lastName},
        ${input.email},
        ${input.phone ?? null},
        ${input.resumeUrl ?? null},
        ${input.resumeObjectKey ?? null},
        ${input.resumeFileName ?? null},
        ${input.resumeMimeType ?? null},
        ${input.resumeSize ?? null},
        ${input.resumeUploadedAt ? new Date(input.resumeUploadedAt) : input.resumeObjectKey ? new Date() : null},
        ${input.source ?? 'direct'},
        ${input.screeningNotes ?? null},
        ${ctx.principal.id}
      )
      RETURNING id
    `,
  );

  if (!input.resumeUrl && input.resumeObjectKey) {
    const defaultResumeUrl = `/api/recruitment/candidates/${inserted.id}/resume`;
    await db.query(
      ctx,
      sql`
        UPDATE candidate
        SET resume_url = ${defaultResumeUrl}
        WHERE organization_id = ${ctx.organizationId} AND id = ${inserted.id}
      `,
    );
  }

  const full = await findCandidateById(ctx, inserted.id);
  if (!full) throw new Error('Failed to retrieve created candidate');
  return full;
}

export async function updateCandidateStatus(
  ctx: RequestContext,
  id: string,
  status: string,
  rejectionReason?: string | null,
): Promise<Candidate | null> {
  if (rejectionReason !== undefined) {
    await db.query(
      ctx,
      sql`
        UPDATE candidate
        SET status = ${status},
            rejection_reason = ${rejectionReason}
        WHERE organization_id = ${ctx.organizationId} AND id = ${id}
      `,
    );
  } else {
    await db.query(
      ctx,
      sql`
        UPDATE candidate
        SET status = ${status}
        WHERE organization_id = ${ctx.organizationId} AND id = ${id}
      `,
    );
  }
  return findCandidateById(ctx, id);
}

export async function updateCandidateScreening(
  ctx: RequestContext,
  id: string,
  screeningNotes: string,
): Promise<Candidate | null> {
  await db.query(
    ctx,
    sql`
      UPDATE candidate
      SET screening_notes = ${screeningNotes}
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `,
  );
  return findCandidateById(ctx, id);
}

// ---------------------------------------------------------------------
// 3. Interviews & Panel
// ---------------------------------------------------------------------

export interface InterviewFilter {
  readonly candidateId?: string | undefined;
  readonly requisitionId?: string | undefined;
  readonly status?: string | undefined;
  readonly stage?: string | undefined;
}

export async function listInterviews(
  ctx: RequestContext,
  filter?: InterviewFilter,
): Promise<Interview[]> {
  const whereClauses: SqlFragment[] = [
    sql`i.organization_id = ${ctx.organizationId}`,
  ];

  if (filter?.candidateId) {
    whereClauses.push(sql`i.candidate_id = ${filter.candidateId}`);
  }
  if (filter?.requisitionId) {
    whereClauses.push(sql`i.requisition_id = ${filter.requisitionId}`);
  }
  if (filter?.status && filter.status !== 'all') {
    whereClauses.push(sql`i.status = ${filter.status}`);
  }
  if (filter?.stage && filter.stage !== 'all') {
    whereClauses.push(sql`i.stage = ${filter.stage}`);
  }

  const interviews = await db.query<Interview>(
    ctx,
    sql`
      SELECT
        i.id,
        i.organization_id,
        i.candidate_id,
        concat(c.first_name, ' ', c.last_name) AS candidate_name,
        c.email AS candidate_email,
        i.requisition_id,
        r.title AS requisition_title,
        i.stage,
        i.round,
        i.interview_type,
        i.scheduled_at,
        i.duration_minutes,
        i.location_or_link,
        i.status,
        i.notes,
        i.created_by,
        i.created_at,
        i.updated_at
      FROM interview i
      JOIN candidate c ON c.organization_id = i.organization_id AND c.id = i.candidate_id
      JOIN job_requisition r ON r.organization_id = i.organization_id AND r.id = i.requisition_id
      WHERE ${sql.join(whereClauses, ' AND ')}
      ORDER BY i.scheduled_at ASC
    `,
  );

  if (interviews.length === 0) return [];

  const interviewIds = interviews.map((it) => it.id);
  const interviewers = await db.query<{ interviewId: string; userId: string; fullName: string }>(
    ctx,
    sql`
      SELECT
        ii.interview_id,
        ii.user_id,
        u.full_name
      FROM interview_interviewer ii
      JOIN app_user u ON u.organization_id = ii.organization_id AND u.id = ii.user_id
      WHERE ii.organization_id = ${ctx.organizationId}
        AND ii.interview_id IN (${sql.join(interviewIds.map((id) => sql`${id}`), ', ')})
    `,
  );

  const feedbacks = await db.query<InterviewFeedback>(
    ctx,
    sql`
      SELECT
        f.id,
        f.organization_id,
        f.interview_id,
        f.interviewer_id,
        u.full_name AS interviewer_name,
        f.recommendation,
        f.rating,
        f.feedback,
        f.strengths,
        f.areas_for_improvement,
        f.submitted_at,
        f.created_at,
        f.updated_at
      FROM interview_feedback f
      JOIN app_user u ON u.organization_id = f.organization_id AND u.id = f.interviewer_id
      WHERE f.organization_id = ${ctx.organizationId}
        AND f.interview_id IN (${sql.join(interviewIds.map((id) => sql`${id}`), ', ')})
      ORDER BY f.submitted_at ASC
    `,
  );

  const interviewersByInt = new Map<string, { ids: string[]; names: string[] }>();
  for (const row of interviewers) {
    const current = interviewersByInt.get(row.interviewId) ?? { ids: [], names: [] };
    current.ids.push(row.userId);
    current.names.push(row.fullName);
    interviewersByInt.set(row.interviewId, current);
  }

  const feedbackByInt = new Map<string, InterviewFeedback[]>();
  for (const fb of feedbacks) {
    const list = feedbackByInt.get(fb.interviewId) ?? [];
    list.push(fb);
    feedbackByInt.set(fb.interviewId, list);
  }

  return interviews.map((it) => {
    const panel = interviewersByInt.get(it.id);
    return {
      ...it,
      interviewerIds: panel?.ids ?? [],
      interviewerNames: panel?.names ?? [],
      feedback: feedbackByInt.get(it.id) ?? [],
    };
  });
}

export async function findInterviewById(
  ctx: RequestContext,
  id: string,
): Promise<Interview | null> {
  const interview = await db.maybeOne<Interview>(
    ctx,
    sql`
      SELECT
        i.id,
        i.organization_id,
        i.candidate_id,
        concat(c.first_name, ' ', c.last_name) AS candidate_name,
        c.email AS candidate_email,
        i.requisition_id,
        r.title AS requisition_title,
        i.stage,
        i.round,
        i.interview_type,
        i.scheduled_at,
        i.duration_minutes,
        i.location_or_link,
        i.status,
        i.notes,
        i.created_by,
        i.created_at,
        i.updated_at
      FROM interview i
      JOIN candidate c ON c.organization_id = i.organization_id AND c.id = i.candidate_id
      JOIN job_requisition r ON r.organization_id = i.organization_id AND r.id = i.requisition_id
      WHERE i.organization_id = ${ctx.organizationId} AND i.id = ${id}
    `,
  );

  if (!interview) return null;

  const interviewers = await db.query<{ userId: string; fullName: string }>(
    ctx,
    sql`
      SELECT ii.user_id, u.full_name
      FROM interview_interviewer ii
      JOIN app_user u ON u.organization_id = ii.organization_id AND u.id = ii.user_id
      WHERE ii.organization_id = ${ctx.organizationId} AND ii.interview_id = ${id}
    `,
  );

  const feedbacks = await db.query<InterviewFeedback>(
    ctx,
    sql`
      SELECT
        f.id,
        f.organization_id,
        f.interview_id,
        f.interviewer_id,
        u.full_name AS interviewer_name,
        f.recommendation,
        f.rating,
        f.feedback,
        f.strengths,
        f.areas_for_improvement,
        f.submitted_at,
        f.created_at,
        f.updated_at
      FROM interview_feedback f
      JOIN app_user u ON u.organization_id = f.organization_id AND u.id = f.interviewer_id
      WHERE f.organization_id = ${ctx.organizationId} AND f.interview_id = ${id}
      ORDER BY f.submitted_at ASC
    `,
  );

  return {
    ...interview,
    interviewerIds: interviewers.map((i) => i.userId),
    interviewerNames: interviewers.map((i) => i.fullName),
    feedback: feedbacks,
  };
}

export async function createInterview(
  ctx: RequestContext,
  input: ScheduleInterviewInput,
): Promise<Interview> {
  const inserted = await db.one<{ id: string }>(
    ctx,
    sql`
      INSERT INTO interview (
        organization_id,
        candidate_id,
        requisition_id,
        stage,
        round,
        interview_type,
        scheduled_at,
        duration_minutes,
        location_or_link,
        notes,
        created_by
      )
      VALUES (
        ${ctx.organizationId},
        ${input.candidateId},
        ${input.requisitionId},
        ${input.stage},
        ${input.round},
        ${input.interviewType},
        ${input.scheduledAt}::timestamptz,
        ${input.durationMinutes},
        ${input.locationOrLink ?? null},
        ${input.notes ?? null},
        ${ctx.principal.id}
      )
      RETURNING id
    `,
  );

  if (input.interviewerIds && input.interviewerIds.length > 0) {
    for (const userId of input.interviewerIds) {
      await db.query(
        ctx,
        sql`
          INSERT INTO interview_interviewer (
            organization_id,
            interview_id,
            user_id,
            assigned_by
          )
          VALUES (
            ${ctx.organizationId},
            ${inserted.id},
            ${userId},
            ${ctx.principal.id}
          )
          ON CONFLICT DO NOTHING
        `,
      );
    }
  }

  // Automatically transition candidate to 'interview' status if applied or screening
  await db.query(
    ctx,
    sql`
      UPDATE candidate
      SET status = 'interview'
      WHERE organization_id = ${ctx.organizationId} AND id = ${input.candidateId}
        AND status IN ('applied', 'screening')
    `,
  );

  const full = await findInterviewById(ctx, inserted.id);
  if (!full) throw new Error('Failed to retrieve created interview');
  return full;
}

export async function updateInterviewStatus(
  ctx: RequestContext,
  id: string,
  status: string,
): Promise<Interview | null> {
  await db.query(
    ctx,
    sql`
      UPDATE interview
      SET status = ${status}
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `,
  );
  return findInterviewById(ctx, id);
}

export async function createInterviewFeedback(
  ctx: RequestContext,
  interviewId: string,
  input: SubmitFeedbackInput,
): Promise<InterviewFeedback> {
  const fb = await db.one<InterviewFeedback>(
    ctx,
    sql`
      INSERT INTO interview_feedback (
        organization_id,
        interview_id,
        interviewer_id,
        recommendation,
        rating,
        feedback,
        strengths,
        areas_for_improvement
      )
      VALUES (
        ${ctx.organizationId},
        ${interviewId},
        ${input.interviewerId},
        ${input.recommendation},
        ${input.rating ?? null},
        ${input.feedback},
        ${input.strengths ?? null},
        ${input.areasForImprovement ?? null}
      )
      RETURNING
        id,
        organization_id,
        interview_id,
        interviewer_id,
        recommendation,
        rating,
        feedback,
        strengths,
        areas_for_improvement,
        submitted_at,
        created_at,
        updated_at
    `,
  );

  await db.query(
    ctx,
    sql`
      UPDATE interview
      SET status = 'completed'
      WHERE organization_id = ${ctx.organizationId} AND id = ${interviewId}
    `,
  );

  const user = await db.maybeOne<{ fullName: string }>(
    ctx,
    sql`
      SELECT full_name FROM app_user WHERE organization_id = ${ctx.organizationId} AND id = ${input.interviewerId}
    `,
  );

  return {
    ...fb,
    interviewerName: user?.fullName ?? 'Evaluator',
  };
}

export async function findUserById(
  ctx: RequestContext,
  userId: string,
): Promise<{ id: string; fullName: string } | null> {
  return db.maybeOne<{ id: string; fullName: string }>(
    ctx,
    sql`
      SELECT id, full_name
      FROM app_user
      WHERE organization_id = ${ctx.organizationId} AND id = ${userId}
    `,
  );
}

export async function getAssignedInterviewerIds(
  ctx: RequestContext,
  interviewId: string,
): Promise<string[]> {
  const rows = await db.query<{ userId: string }>(
    ctx,
    sql`
      SELECT ii.user_id
      FROM interview_interviewer ii
      JOIN app_user u ON u.organization_id = ii.organization_id AND u.id = ii.user_id
      WHERE ii.organization_id = ${ctx.organizationId} AND ii.interview_id = ${interviewId}
    `,
  );
  return rows.map((r) => r.userId);
}

export async function findInterviewFeedbackById(
  ctx: RequestContext,
  id: string,
): Promise<InterviewFeedback | null> {
  return db.maybeOne<InterviewFeedback>(
    ctx,
    sql`
      SELECT
        f.id,
        f.organization_id,
        f.interview_id,
        f.interviewer_id,
        u.full_name AS interviewer_name,
        f.recommendation,
        f.rating,
        f.feedback,
        f.strengths,
        f.areas_for_improvement,
        f.submitted_at,
        f.created_at,
        f.updated_at
      FROM interview_feedback f
      JOIN app_user u ON u.organization_id = f.organization_id AND u.id = f.interviewer_id
      WHERE f.organization_id = ${ctx.organizationId} AND f.id = ${id}
    `,
  );
}

export async function updateInterviewFeedback(
  ctx: RequestContext,
  id: string,
  input: UpdateFeedbackInput,
): Promise<InterviewFeedback | null> {
  const setClauses: SqlFragment[] = [];
  if (input.interviewerId !== undefined) setClauses.push(sql`interviewer_id = ${input.interviewerId}`);
  if (input.recommendation !== undefined) setClauses.push(sql`recommendation = ${input.recommendation}`);
  if (input.rating !== undefined) setClauses.push(sql`rating = ${input.rating}`);
  if (input.feedback !== undefined) setClauses.push(sql`feedback = ${input.feedback}`);
  if (input.strengths !== undefined) setClauses.push(sql`strengths = ${input.strengths}`);
  if (input.areasForImprovement !== undefined) setClauses.push(sql`areas_for_improvement = ${input.areasForImprovement}`);

  if (setClauses.length > 0) {
    await db.query(
      ctx,
      sql`
        UPDATE interview_feedback
        SET ${sql.join(setClauses, ', ')}
        WHERE organization_id = ${ctx.organizationId} AND id = ${id}
      `,
    );
  }

  return findInterviewFeedbackById(ctx, id);
}

// ---------------------------------------------------------------------
// 4. Offers
// ---------------------------------------------------------------------

export interface OfferFilter {
  readonly candidateId?: string | undefined;
  readonly status?: string | undefined;
}

export async function listOffers(
  ctx: RequestContext,
  filter?: OfferFilter,
): Promise<JobOffer[]> {
  const whereClauses: SqlFragment[] = [
    sql`o.organization_id = ${ctx.organizationId}`,
  ];

  if (filter?.candidateId) {
    whereClauses.push(sql`o.candidate_id = ${filter.candidateId}`);
  }
  if (filter?.status && filter.status !== 'all') {
    whereClauses.push(sql`o.status = ${filter.status}`);
  }

  return db.query<JobOffer>(
    ctx,
    sql`
      SELECT
        o.id,
        o.organization_id,
        o.candidate_id,
        concat(c.first_name, ' ', c.last_name) AS candidate_name,
        c.email AS candidate_email,
        o.requisition_id,
        r.title AS requisition_title,
        o.position_id,
        p.name AS position_name,
        o.designation_id,
        des.name AS designation_name,
        o.offered_salary::text AS offered_salary,
        o.currency,
        to_char(o.offer_date, 'YYYY-MM-DD') AS offer_date,
        to_char(o.valid_until, 'YYYY-MM-DD') AS valid_until,
        to_char(o.expected_joining_date, 'YYYY-MM-DD') AS expected_joining_date,
        o.status,
        o.notes,
        o.created_by,
        o.created_at,
        o.updated_at
      FROM job_offer o
      JOIN candidate c ON c.organization_id = o.organization_id AND c.id = o.candidate_id
      JOIN job_requisition r ON r.organization_id = o.organization_id AND r.id = o.requisition_id
      LEFT JOIN position p ON p.organization_id = o.organization_id AND p.id = o.position_id
      LEFT JOIN designation des ON des.organization_id = o.organization_id AND des.id = o.designation_id
      WHERE ${sql.join(whereClauses, ' AND ')}
      ORDER BY o.created_at DESC
    `,
  );
}

export async function findOfferById(
  ctx: RequestContext,
  id: string,
): Promise<JobOffer | null> {
  return db.maybeOne<JobOffer>(
    ctx,
    sql`
      SELECT
        o.id,
        o.organization_id,
        o.candidate_id,
        concat(c.first_name, ' ', c.last_name) AS candidate_name,
        c.email AS candidate_email,
        o.requisition_id,
        r.title AS requisition_title,
        o.position_id,
        p.name AS position_name,
        o.designation_id,
        des.name AS designation_name,
        o.offered_salary::text AS offered_salary,
        o.currency,
        to_char(o.offer_date, 'YYYY-MM-DD') AS offer_date,
        to_char(o.valid_until, 'YYYY-MM-DD') AS valid_until,
        to_char(o.expected_joining_date, 'YYYY-MM-DD') AS expected_joining_date,
        o.status,
        o.notes,
        o.created_by,
        o.created_at,
        o.updated_at
      FROM job_offer o
      JOIN candidate c ON c.organization_id = o.organization_id AND c.id = o.candidate_id
      JOIN job_requisition r ON r.organization_id = o.organization_id AND r.id = o.requisition_id
      LEFT JOIN position p ON p.organization_id = o.organization_id AND p.id = o.position_id
      LEFT JOIN designation des ON des.organization_id = o.organization_id AND des.id = o.designation_id
      WHERE o.organization_id = ${ctx.organizationId} AND o.id = ${id}
    `,
  );
}

export async function createOffer(
  ctx: RequestContext,
  input: CreateOfferInput,
): Promise<JobOffer> {
  const inserted = await db.one<{ id: string }>(
    ctx,
    sql`
      INSERT INTO job_offer (
        organization_id,
        candidate_id,
        requisition_id,
        position_id,
        designation_id,
        offered_salary,
        currency,
        offer_date,
        valid_until,
        expected_joining_date,
        status,
        notes,
        created_by
      )
      VALUES (
        ${ctx.organizationId},
        ${input.candidateId},
        ${input.requisitionId},
        ${input.positionId ?? null},
        ${input.designationId ?? null},
        ${input.offeredSalary}::numeric,
        ${input.currency ?? 'INR'},
        ${input.offerDate ? sql`${input.offerDate}::date` : sql`CURRENT_DATE`},
        ${input.validUntil ? sql`${input.validUntil}::date` : null},
        ${input.expectedJoiningDate ? sql`${input.expectedJoiningDate}::date` : null},
        ${input.status ?? 'draft'},
        ${input.notes ?? null},
        ${ctx.principal.id}
      )
      RETURNING id
    `,
  );

  const full = await findOfferById(ctx, inserted.id);
  if (!full) throw new Error('Failed to retrieve created offer');
  return full;
}

function toIsoDate(val: Date | string | null | undefined): string {
  if (!val) return new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]!;
  if (val instanceof Date) return val.toISOString().split('T')[0]!;
  const s = val.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]!;
  return new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]!;
}

export async function updateOffer(
  ctx: RequestContext,
  id: string,
  input: UpdateOfferInput,
): Promise<JobOffer | null> {
  const setClauses: SqlFragment[] = [];
  if (input.candidateId !== undefined) setClauses.push(sql`candidate_id = ${input.candidateId}`);
  if (input.requisitionId !== undefined) setClauses.push(sql`requisition_id = ${input.requisitionId}`);
  if (input.positionId !== undefined) setClauses.push(sql`position_id = ${input.positionId ?? null}`);
  if (input.designationId !== undefined) setClauses.push(sql`designation_id = ${input.designationId ?? null}`);
  if (input.offeredSalary !== undefined) setClauses.push(sql`offered_salary = ${input.offeredSalary}::numeric`);
  if (input.currency !== undefined) setClauses.push(sql`currency = ${input.currency}`);
  if (input.offerDate !== undefined) setClauses.push(sql`offer_date = ${input.offerDate ? sql`${input.offerDate}::date` : sql`CURRENT_DATE`}`);
  if (input.validUntil !== undefined) setClauses.push(sql`valid_until = ${input.validUntil ? sql`${input.validUntil}::date` : null}`);
  if (input.expectedJoiningDate !== undefined) setClauses.push(sql`expected_joining_date = ${input.expectedJoiningDate ? sql`${input.expectedJoiningDate}::date` : null}`);
  if (input.status !== undefined) setClauses.push(sql`status = ${input.status}`);
  if (input.notes !== undefined) setClauses.push(sql`notes = ${input.notes ?? null}`);

  if (setClauses.length > 0) {
    await db.query(
      ctx,
      sql`
        UPDATE job_offer
        SET ${sql.join(setClauses, ', ')}
        WHERE organization_id = ${ctx.organizationId} AND id = ${id}
      `,
    );
  }

  return findOfferById(ctx, id);
}

export async function updateOfferStatus(
  ctx: RequestContext,
  id: string,
  status: string,
): Promise<JobOffer | null> {
  await db.query(
    ctx,
    sql`
      UPDATE job_offer
      SET status = ${status}
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `,
  );

  const offer = await findOfferById(ctx, id);
  if (offer && status === 'accepted') {
    const existingJoining = await db.maybeOne<{ id: string }>(
      ctx,
      sql`
        SELECT id FROM candidate_joining WHERE organization_id = ${ctx.organizationId} AND offer_id = ${id}
      `,
    );
    if (!existingJoining) {
      const defaultDate = toIsoDate(offer.expectedJoiningDate);
      await db.query(
        ctx,
        sql`
          INSERT INTO candidate_joining (
            organization_id,
            candidate_id,
            offer_id,
            expected_joining_date,
            status,
            notes,
            created_by
          )
          VALUES (
            ${ctx.organizationId},
            ${offer.candidateId},
            ${offer.id},
            ${defaultDate}::date,
            'pending',
            'Auto-created upon job offer acceptance',
            ${ctx.principal.id}
          )
          ON CONFLICT DO NOTHING
        `,
      );
    }
  }

  return offer;
}

// ---------------------------------------------------------------------
// 5. Joining
// ---------------------------------------------------------------------

export interface JoiningFilter {
  readonly status?: string | undefined;
  readonly candidateId?: string | undefined;
}

export async function listJoinings(
  ctx: RequestContext,
  filter?: JoiningFilter,
): Promise<CandidateJoining[]> {
  const whereClauses: SqlFragment[] = [
    sql`j.organization_id = ${ctx.organizationId}`,
  ];

  if (filter?.status && filter.status !== 'all') {
    whereClauses.push(sql`j.status = ${filter.status}`);
  }
  if (filter?.candidateId) {
    whereClauses.push(sql`j.candidate_id = ${filter.candidateId}`);
  }

  return db.query<CandidateJoining>(
    ctx,
    sql`
      SELECT
        j.id,
        j.organization_id,
        j.candidate_id,
        concat(c.first_name, ' ', c.last_name) AS candidate_name,
        c.email AS candidate_email,
        j.offer_id,
        to_char(j.expected_joining_date, 'YYYY-MM-DD') AS expected_joining_date,
        to_char(j.actual_joining_date, 'YYYY-MM-DD') AS actual_joining_date,
        j.status,
        j.employee_id,
        j.notes,
        j.created_by,
        j.created_at,
        j.updated_at
      FROM candidate_joining j
      JOIN candidate c ON c.organization_id = j.organization_id AND c.id = j.candidate_id
      WHERE ${sql.join(whereClauses, ' AND ')}
      ORDER BY j.expected_joining_date ASC
    `,
  );
}

export async function findJoiningById(
  ctx: RequestContext,
  id: string,
): Promise<CandidateJoining | null> {
  return db.maybeOne<CandidateJoining>(
    ctx,
    sql`
      SELECT
        j.id,
        j.organization_id,
        j.candidate_id,
        concat(c.first_name, ' ', c.last_name) AS candidate_name,
        c.email AS candidate_email,
        j.offer_id,
        to_char(j.expected_joining_date, 'YYYY-MM-DD') AS expected_joining_date,
        to_char(j.actual_joining_date, 'YYYY-MM-DD') AS actual_joining_date,
        j.status,
        j.employee_id,
        j.notes,
        j.created_by,
        j.created_at,
        j.updated_at
      FROM candidate_joining j
      JOIN candidate c ON c.organization_id = j.organization_id AND c.id = j.candidate_id
      WHERE j.organization_id = ${ctx.organizationId} AND j.id = ${id}
    `,
  );
}

export async function createJoining(
  ctx: RequestContext,
  input: CreateJoiningInput,
): Promise<CandidateJoining> {
  const inserted = await db.one<{ id: string }>(
    ctx,
    sql`
      INSERT INTO candidate_joining (
        organization_id,
        candidate_id,
        offer_id,
        expected_joining_date,
        status,
        notes,
        created_by
      )
      VALUES (
        ${ctx.organizationId},
        ${input.candidateId},
        ${input.offerId},
        ${input.expectedJoiningDate}::date,
        ${input.status ?? 'pending'},
        ${input.notes ?? null},
        ${ctx.principal.id}
      )
      RETURNING id
    `,
  );

  const full = await findJoiningById(ctx, inserted.id);
  if (!full) throw new Error('Failed to retrieve created candidate joining');
  return full;
}

export async function updateJoiningStatus(
  ctx: RequestContext,
  id: string,
  status: string,
  actualJoiningDate?: string | null,
  notes?: string | null,
): Promise<CandidateJoining | null> {
  const setClauses: SqlFragment[] = [
    sql`status = ${status}`,
  ];

  if (actualJoiningDate !== undefined) {
    setClauses.push(
      actualJoiningDate
        ? sql`actual_joining_date = ${actualJoiningDate}::date`
        : sql`actual_joining_date = NULL`,
    );
  } else if (status === 'joined') {
    setClauses.push(sql`actual_joining_date = COALESCE(actual_joining_date, CURRENT_DATE)`);
  }

  if (notes !== undefined) {
    setClauses.push(sql`notes = ${notes}`);
  }

  await db.query(
    ctx,
    sql`
      UPDATE candidate_joining
      SET ${sql.join(setClauses, ', ')}
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `,
  );

  return findJoiningById(ctx, id);
}

export async function updateJoining(
  ctx: RequestContext,
  id: string,
  input: UpdateJoiningInput,
): Promise<CandidateJoining | null> {
  const setClauses: SqlFragment[] = [];
  if (input.candidateId !== undefined) setClauses.push(sql`candidate_id = ${input.candidateId}`);
  if (input.offerId !== undefined) setClauses.push(sql`offer_id = ${input.offerId}`);
  if (input.expectedJoiningDate !== undefined) setClauses.push(sql`expected_joining_date = ${input.expectedJoiningDate}::date`);
  if (input.status !== undefined) setClauses.push(sql`status = ${input.status}`);
  if (input.actualJoiningDate !== undefined) {
    setClauses.push(
      input.actualJoiningDate
        ? sql`actual_joining_date = ${input.actualJoiningDate}::date`
        : sql`actual_joining_date = NULL`,
    );
  }
  if (input.notes !== undefined) setClauses.push(sql`notes = ${input.notes}`);

  if (setClauses.length > 0) {
    await db.query(
      ctx,
      sql`
        UPDATE candidate_joining
        SET ${sql.join(setClauses, ', ')}
        WHERE organization_id = ${ctx.organizationId} AND id = ${id}
      `,
    );
  }

  return findJoiningById(ctx, id);
}

// ---------------------------------------------------------------------
// 6. Metrics Aggregate
// ---------------------------------------------------------------------

export async function getRecruitmentMetrics(
  ctx: RequestContext,
): Promise<RecruitmentMetrics> {
  const [reqCounts, candCounts, intCounts, offerCounts, joinCounts] = await Promise.all([
    db.one<{ count: number }>(
      ctx,
      sql`SELECT count(*)::integer AS count FROM job_requisition WHERE organization_id = ${ctx.organizationId} AND status = 'open'`,
    ),
    db.one<{ activeCount: number; screeningCount: number }>(
      ctx,
      sql`
        SELECT
          count(*) FILTER (WHERE status NOT IN ('rejected', 'withdrawn'))::integer AS active_count,
          count(*) FILTER (WHERE status = 'screening')::integer AS screening_count
        FROM candidate
        WHERE organization_id = ${ctx.organizationId}
      `,
    ),
    db.one<{ count: number }>(
      ctx,
      sql`SELECT count(*)::integer AS count FROM interview WHERE organization_id = ${ctx.organizationId} AND status = 'scheduled'`,
    ),
    db.one<{ count: number }>(
      ctx,
      sql`SELECT count(*)::integer AS count FROM job_offer WHERE organization_id = ${ctx.organizationId} AND status IN ('draft', 'sent')`,
    ),
    db.one<{ count: number }>(
      ctx,
      sql`SELECT count(*)::integer AS count FROM candidate_joining WHERE organization_id = ${ctx.organizationId} AND status IN ('pending', 'confirmed')`,
    ),
  ]);

  return {
    openRequisitions: reqCounts?.count ?? 0,
    activeCandidates: candCounts?.activeCount ?? 0,
    candidatesInScreening: candCounts?.screeningCount ?? 0,
    upcomingInterviews: intCounts?.count ?? 0,
    offersPending: offerCounts?.count ?? 0,
    joiningPending: joinCounts?.count ?? 0,
  };
}

// ---------------------------------------------------------------------
// 7. Application Links
// ---------------------------------------------------------------------

export async function createApplicationLink(
  ctx: RequestContext,
  input: CreateApplicationLinkInput,
  token: string,
): Promise<RecruitmentApplicationLink> {
  const expiresAtValue = input.expiresAt ? sql`${input.expiresAt}::timestamptz` : sql`NULL`;

  const inserted = await db.one<{ id: string }>(
    ctx,
    sql`
      INSERT INTO recruitment_application_link (
        organization_id,
        requisition_id,
        token,
        status,
        expires_at,
        created_by
      )
      VALUES (
        ${ctx.organizationId},
        ${input.requisitionId},
        ${token},
        ${input.status ?? 'active'},
        ${expiresAtValue},
        ${ctx.principal.id}
      )
      RETURNING id
    `,
  );

  const full = await findApplicationLinkById(ctx, inserted.id);
  if (!full) throw new Error('Failed to retrieve created application link');
  return full;
}

export async function findApplicationLinkById(
  ctx: RequestContext,
  id: string,
): Promise<RecruitmentApplicationLink | null> {
  return db.maybeOne<RecruitmentApplicationLink>(
    ctx,
    sql`
      SELECT
        l.id,
        l.organization_id,
        l.requisition_id,
        r.title AS requisition_title,
        r.requisition_number,
        l.token,
        l.status,
        l.expires_at,
        l.created_by,
        l.created_at,
        l.updated_at
      FROM recruitment_application_link l
      JOIN job_requisition r ON r.organization_id = l.organization_id AND r.id = l.requisition_id
      WHERE l.organization_id = ${ctx.organizationId} AND l.id = ${id}
    `,
  );
}

export async function listApplicationLinks(
  ctx: RequestContext,
  requisitionId?: string,
): Promise<RecruitmentApplicationLink[]> {
  const whereClauses: SqlFragment[] = [
    sql`l.organization_id = ${ctx.organizationId}`,
  ];

  if (requisitionId) {
    whereClauses.push(sql`l.requisition_id = ${requisitionId}`);
  }

  return db.query<RecruitmentApplicationLink>(
    ctx,
    sql`
      SELECT
        l.id,
        l.organization_id,
        l.requisition_id,
        r.title AS requisition_title,
        r.requisition_number,
        l.token,
        l.status,
        l.expires_at,
        l.created_by,
        l.created_at,
        l.updated_at
      FROM recruitment_application_link l
      JOIN job_requisition r ON r.organization_id = l.organization_id AND r.id = l.requisition_id
      WHERE ${sql.join(whereClauses, ' AND ')}
      ORDER BY l.created_at DESC
    `,
  );
}

export async function updateApplicationLinkStatus(
  ctx: RequestContext,
  id: string,
  status: string,
  expiresAt?: string | null,
): Promise<RecruitmentApplicationLink | null> {
  const setClauses: SqlFragment[] = [
    sql`status = ${status}`,
  ];

  if (expiresAt !== undefined) {
    setClauses.push(expiresAt ? sql`expires_at = ${expiresAt}::timestamptz` : sql`expires_at = NULL`);
  }

  await db.query(
    ctx,
    sql`
      UPDATE recruitment_application_link
      SET ${sql.join(setClauses, ', ')}
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `,
  );

  return findApplicationLinkById(ctx, id);
}

/**
 * Public token-resolver: uses the SECURITY DEFINER function to resolve
 * token pre-auth, then reads the public requisition details under tenant isolation.
 */
export async function resolvePublicApplicationLink(token: string): Promise<{
  link: RecruitmentApplicationLink;
  requisition: JobRequisition;
} | null> {
  const links = await bootstrapDb.readIdentityDirectory<RecruitmentApplicationLink>(
    sql`SELECT * FROM resolve_recruitment_application_link(${token})`,
  );

  const link = links[0];
  if (!link) return null;

  // Check status and expiration
  if (link.status !== 'active') return null;
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now()) return null;

  const reqs = await bootstrapDb.readAs<JobRequisition>(
    link.organizationId,
    sql`
      SELECT
        r.id,
        r.organization_id,
        r.requisition_number,
        r.title,
        r.department_id,
        d.name AS department_name,
        r.position_id,
        p.name AS position_name,
        r.openings_count,
        r.employment_type,
        r.location,
        r.description,
        r.requirements,
        r.status,
        r.target_hire_date,
        r.closed_at,
        r.created_by,
        r.created_at,
        r.updated_at
      FROM job_requisition r
      LEFT JOIN department d ON d.organization_id = r.organization_id AND d.id = r.department_id
      LEFT JOIN position p ON p.organization_id = r.organization_id AND p.id = r.position_id
      WHERE r.organization_id = ${link.organizationId} AND r.id = ${link.requisitionId}
    `,
  );

  const requisition = reqs[0];
  if (!requisition) return null;

  // Tenant / resource relationship check (fail closed)
  if (requisition.organizationId !== link.organizationId || requisition.id !== link.requisitionId) {
    return null;
  }

  // Linked requisition must be eligible for public applications ('open')
  if (requisition.status !== 'open') {
    return null;
  }

  return { link, requisition };
}

// ---------------------------------------------------------------------
// 8. Resume Submissions
// ---------------------------------------------------------------------

export interface CreateSubmissionData {
  readonly organizationId: string;
  readonly requisitionId: string;
  readonly applicationLinkId?: string | null;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone?: string | null;
  readonly resumeObjectKey: string;
  readonly resumeFilename: string;
  readonly resumeMimeType: string;
  readonly resumeFileSize: number;
  readonly parsedData: ParsedResumeData;
}

export async function createResumeSubmissionPreAuth(
  input: CreateSubmissionData,
): Promise<CandidateResumeSubmission> {
  const parsedDataJson = JSON.stringify(input.parsedData ?? {});

  const rows = await bootstrapDb.readAs<CandidateResumeSubmission>(
    input.organizationId,
    sql`
      INSERT INTO candidate_resume_submission (
        organization_id,
        requisition_id,
        application_link_id,
        first_name,
        last_name,
        email,
        phone,
        resume_object_key,
        resume_filename,
        resume_mime_type,
        resume_file_size,
        parsed_data,
        status
      )
      VALUES (
        ${input.organizationId},
        ${input.requisitionId},
        ${input.applicationLinkId ?? null},
        ${input.firstName},
        ${input.lastName},
        ${input.email},
        ${input.phone ?? null},
        ${input.resumeObjectKey},
        ${input.resumeFilename},
        ${input.resumeMimeType},
        ${input.resumeFileSize},
        ${parsedDataJson}::jsonb,
        'submitted'
      )
      RETURNING
        id,
        organization_id,
        requisition_id,
        application_link_id,
        first_name,
        last_name,
        email,
        phone,
        resume_object_key,
        resume_filename,
        resume_mime_type,
        resume_file_size,
        parsed_data,
        status,
        candidate_id,
        rejection_reason,
        reviewed_by,
        reviewed_at,
        created_at,
        updated_at
    `,
  );

  const row = rows[0];
  if (!row) throw new Error('Failed to create resume submission');
  return {
    ...row,
    fullName: `${row.firstName} ${row.lastName}`.trim(),
  };
}

export async function createResumeSubmission(
  ctx: RequestContext,
  input: CreateSubmissionData,
): Promise<CandidateResumeSubmission> {
  const parsedDataJson = JSON.stringify(input.parsedData ?? {});

  const row = await db.one<CandidateResumeSubmission>(
    ctx,
    sql`
      INSERT INTO candidate_resume_submission (
        organization_id,
        requisition_id,
        application_link_id,
        first_name,
        last_name,
        email,
        phone,
        resume_object_key,
        resume_filename,
        resume_mime_type,
        resume_file_size,
        parsed_data,
        status
      )
      VALUES (
        ${ctx.organizationId},
        ${input.requisitionId},
        ${input.applicationLinkId ?? null},
        ${input.firstName},
        ${input.lastName},
        ${input.email},
        ${input.phone ?? null},
        ${input.resumeObjectKey},
        ${input.resumeFilename},
        ${input.resumeMimeType},
        ${input.resumeFileSize},
        ${parsedDataJson}::jsonb,
        'submitted'
      )
      RETURNING
        id,
        organization_id,
        requisition_id,
        application_link_id,
        first_name,
        last_name,
        email,
        phone,
        resume_object_key,
        resume_filename,
        resume_mime_type,
        resume_file_size,
        parsed_data,
        status,
        candidate_id,
        rejection_reason,
        reviewed_by,
        reviewed_at,
        created_at,
        updated_at
    `,
  );

  return {
    ...row,
    fullName: `${row.firstName} ${row.lastName}`.trim(),
  };
}

export async function findResumeSubmissionById(
  ctx: RequestContext,
  id: string,
  tx?: Tx,
): Promise<CandidateResumeSubmission | null> {
  const query = sql`
    SELECT
      s.id,
      s.organization_id,
      s.requisition_id,
      r.title AS requisition_title,
      r.requisition_number,
      s.application_link_id,
      s.first_name,
      s.last_name,
      s.email,
      s.phone,
      s.resume_object_key,
      s.resume_filename,
      s.resume_mime_type,
      s.resume_file_size,
      s.parsed_data,
      s.status,
      s.candidate_id,
      s.rejection_reason,
      s.reviewed_by,
      s.reviewed_at,
      s.created_at,
      s.updated_at
    FROM candidate_resume_submission s
    JOIN job_requisition r ON r.organization_id = s.organization_id AND r.id = s.requisition_id
    WHERE s.organization_id = ${ctx.organizationId} AND s.id = ${id}
  `;
  const row = tx
    ? await tx.maybeOne<CandidateResumeSubmission>(query)
    : await db.maybeOne<CandidateResumeSubmission>(ctx, query);

  if (!row) return null;
  return {
    ...row,
    fullName: `${row.firstName} ${row.lastName}`.trim(),
  };
}

export interface SubmissionFilter {
  readonly requisitionId?: string | undefined;
  readonly status?: string | undefined;
  readonly search?: string | undefined;
}

export async function listResumeSubmissions(
  ctx: RequestContext,
  filter?: SubmissionFilter,
): Promise<CandidateResumeSubmission[]> {
  const whereClauses: SqlFragment[] = [
    sql`s.organization_id = ${ctx.organizationId}`,
  ];

  if (filter?.requisitionId) {
    whereClauses.push(sql`s.requisition_id = ${filter.requisitionId}`);
  }
  if (filter?.status && filter.status !== 'all') {
    whereClauses.push(sql`s.status = ${filter.status}`);
  }
  if (filter?.search?.trim()) {
    const pattern = `%${filter.search.trim()}%`;
    whereClauses.push(
      sql`(s.first_name ILIKE ${pattern} OR s.last_name ILIKE ${pattern} OR s.email ILIKE ${pattern})`,
    );
  }

  const rows = await db.query<CandidateResumeSubmission>(
    ctx,
    sql`
      SELECT
        s.id,
        s.organization_id,
        s.requisition_id,
        r.title AS requisition_title,
        r.requisition_number,
        s.application_link_id,
        s.first_name,
        s.last_name,
        s.email,
        s.phone,
        s.resume_object_key,
        s.resume_filename,
        s.resume_mime_type,
        s.resume_file_size,
        s.parsed_data,
        s.status,
        s.candidate_id,
        s.rejection_reason,
        s.reviewed_by,
        s.reviewed_at,
        s.created_at,
        s.updated_at
      FROM candidate_resume_submission s
      JOIN job_requisition r ON r.organization_id = s.organization_id AND r.id = s.requisition_id
      WHERE ${sql.join(whereClauses, ' AND ')}
      ORDER BY s.created_at DESC
    `,
  );

  return rows.map((r) => ({
    ...r,
    fullName: `${r.firstName} ${r.lastName}`.trim(),
  }));
}

export async function updateResumeSubmissionStatus(
  ctx: RequestContext,
  id: string,
  status: string,
  rejectionReason?: string | null,
): Promise<CandidateResumeSubmission | null> {
  const setClauses: SqlFragment[] = [
    sql`status = ${status}`,
    sql`reviewed_by = ${ctx.principal.id}`,
    sql`reviewed_at = now()`,
  ];

  if (rejectionReason !== undefined) {
    setClauses.push(sql`rejection_reason = ${rejectionReason}`);
  }

  await db.query(
    ctx,
    sql`
      UPDATE candidate_resume_submission
      SET ${sql.join(setClauses, ', ')}
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `,
  );

  return findResumeSubmissionById(ctx, id);
}

// ---------------------------------------------------------------------
// 9. Candidate Uniqueness & Conversion
// ---------------------------------------------------------------------

export async function candidateExistsForRequisition(
  ctx: RequestContext,
  requisitionId: string,
  email: string,
): Promise<boolean> {
  const result = await db.maybeOne<{ exists: number }>(
    ctx,
    sql`
      SELECT 1 AS exists
      FROM candidate
      WHERE organization_id = ${ctx.organizationId}
        AND requisition_id = ${requisitionId}
        AND email = ${email.trim().toLowerCase()}
      LIMIT 1
    `,
  );
  return result !== null;
}

export async function convertSubmissionToCandidate(
  ctx: RequestContext,
  submissionId: string,
  input?: ConvertSubmissionInput,
): Promise<{ candidate: Candidate; submission: CandidateResumeSubmission }> {
  return db.transaction(ctx, async (tx) => {
    const submissionRows = await tx.query<CandidateResumeSubmission>(
      sql`
        SELECT *
        FROM candidate_resume_submission
        WHERE organization_id = ${ctx.organizationId} AND id = ${submissionId}
        FOR UPDATE
      `,
    );

    const submission = submissionRows[0];
    if (!submission) {
      throw new Error('Resume submission not found');
    }

    if (submission.status === 'converted' && submission.candidateId) {
      const existingCandidate = await findCandidateById(ctx, submission.candidateId, tx);
      if (existingCandidate) {
        const fullSubmission = await findResumeSubmissionById(ctx, submission.id, tx);
        return { candidate: existingCandidate, submission: fullSubmission ?? submission };
      }
    }

    const firstName = input?.firstName ?? submission.firstName;
    const lastName = input?.lastName ?? submission.lastName;
    const email = (input?.email ?? submission.email).trim().toLowerCase();
    const phone = input?.phone !== undefined ? input.phone : submission.phone;
    const source = input?.source ?? 'career_site';
    const screeningNotes = input?.screeningNotes ?? null;

    // Check duplicate candidate constraint
    const existing = await tx.query<{ id: string }>(
      sql`
        SELECT id
        FROM candidate
        WHERE organization_id = ${ctx.organizationId}
          AND requisition_id = ${submission.requisitionId}
          AND email = ${email}
      `,
    );

    if (existing.length > 0) {
      const error = new Error('Candidate with this email already exists for this job requisition');
      (error as Error & { code?: string }).code = 'DUPLICATE_CANDIDATE';
      throw error;
    }

    const resumeUrl = `/api/recruitment/resume-submissions/${submission.id}/resume`;

    const candidateInsert = await tx.query<{ id: string }>(
      sql`
        INSERT INTO candidate (
          organization_id,
          requisition_id,
          first_name,
          last_name,
          email,
          phone,
          resume_url,
          resume_object_key,
          resume_file_name,
          resume_mime_type,
          resume_size,
          resume_uploaded_at,
          source,
          screening_notes,
          created_by
        )
        VALUES (
          ${ctx.organizationId},
          ${submission.requisitionId},
          ${firstName},
          ${lastName},
          ${email},
          ${phone},
          ${resumeUrl},
          ${submission.resumeObjectKey},
          ${submission.resumeFilename},
          ${submission.resumeMimeType},
          ${submission.resumeFileSize},
          ${submission.createdAt ? new Date(submission.createdAt) : new Date()},
          ${source},
          ${screeningNotes},
          ${ctx.principal.id}
        )
        RETURNING id
      `,
    );

    const candidateId = candidateInsert[0]!.id;

    await tx.query(
      sql`
        UPDATE candidate_resume_submission
        SET status = 'converted',
            candidate_id = ${candidateId},
            reviewed_by = ${ctx.principal.id},
            reviewed_at = now()
        WHERE organization_id = ${ctx.organizationId} AND id = ${submission.id}
      `,
    );

    const candidate = await findCandidateById(ctx, candidateId, tx);
    if (!candidate) throw new Error('Failed to retrieve converted candidate');

    const updatedSubmission = await findResumeSubmissionById(ctx, submission.id, tx);
    if (!updatedSubmission) throw new Error('Failed to retrieve updated submission');

    return { candidate, submission: updatedSubmission };
  });
}

// ---------------------------------------------------------------------
// 10. Interview Reschedule & Decision
// ---------------------------------------------------------------------

export async function rescheduleInterview(
  ctx: RequestContext,
  interviewId: string,
  input: RescheduleInterviewInput,
): Promise<{ oldInterview: Interview; newInterview: Interview }> {
  return db.transaction(ctx, async (tx) => {
    const oldRows = await tx.query<Interview>(
      sql`
        SELECT *
        FROM interview
        WHERE organization_id = ${ctx.organizationId} AND id = ${interviewId}
        FOR UPDATE
      `,
    );

    const old = oldRows[0];
    if (!old) {
      throw new Error('Interview not found');
    }

    if (old.status === 'cancelled' || old.status === 'rescheduled') {
      throw new Error(`Cannot reschedule an interview with status: ${old.status}`);
    }

    // Mark previous interview as rescheduled
    await tx.query(
      sql`
        UPDATE interview
        SET status = 'rescheduled'
        WHERE organization_id = ${ctx.organizationId} AND id = ${interviewId}
      `,
    );

    // Fetch existing interviewers for the panel
    const existingInterviewers = await tx.query<{ userId: string }>(
      sql`
        SELECT user_id
        FROM interview_interviewer
        WHERE organization_id = ${ctx.organizationId} AND interview_id = ${interviewId}
      `,
    );

    const interviewerIds = input.interviewerIds ?? existingInterviewers.map((i) => i.userId);

    // Create the new interview record preserving candidate, requisition, stage, and round
    const inserted = await tx.query<{ id: string }>(
      sql`
        INSERT INTO interview (
          organization_id,
          candidate_id,
          requisition_id,
          stage,
          round,
          interview_type,
          scheduled_at,
          duration_minutes,
          location_or_link,
          notes,
          created_by
        )
        VALUES (
          ${ctx.organizationId},
          ${old.candidateId},
          ${old.requisitionId},
          ${old.stage},
          ${old.round},
          ${old.interviewType},
          ${input.scheduledAt}::timestamptz,
          ${input.durationMinutes ?? old.durationMinutes},
          ${input.locationOrLink ?? old.locationOrLink},
          ${input.notes ?? old.notes},
          ${ctx.principal.id}
        )
        RETURNING id
      `,
    );

    const newInterviewId = inserted[0]!.id;

    if (interviewerIds.length > 0) {
      for (const userId of interviewerIds) {
        await tx.query(
          sql`
            INSERT INTO interview_interviewer (
              organization_id,
              interview_id,
              user_id,
              assigned_by
            )
            VALUES (
              ${ctx.organizationId},
              ${newInterviewId},
              ${userId},
              ${ctx.principal.id}
            )
            ON CONFLICT DO NOTHING
          `,
        );
      }
    }

    const oldInterview = await findInterviewById(ctx, interviewId);
    const newInterview = await findInterviewById(ctx, newInterviewId);

    if (!oldInterview || !newInterview) {
      throw new Error('Failed to retrieve rescheduled interview records');
    }

    return { oldInterview, newInterview };
  });
}

export async function recordInterviewDecision(
  ctx: RequestContext,
  interviewId: string,
  input: InterviewDecisionInput,
): Promise<Candidate> {
  const interview = await findInterviewById(ctx, interviewId);
  if (!interview) {
    throw new Error('Interview not found');
  }

  const candidate = await findCandidateById(ctx, interview.candidateId);
  if (!candidate) {
    throw new Error('Candidate not found');
  }

  if (input.decision === 'accepted') {
    // Transition candidate to selected
    await updateCandidateStatus(ctx, candidate.id, 'selected');
  } else {
    // Transition candidate to rejected with reason
    await updateCandidateStatus(ctx, candidate.id, 'rejected', input.rejectionReason ?? 'Not selected after interview');
  }

  const updated = await findCandidateById(ctx, candidate.id);
  if (!updated) throw new Error('Failed to retrieve candidate');
  return updated;
}

// ---------------------------------------------------------------------
// 11. Candidate Hiring Eligibility & Finalization
// ---------------------------------------------------------------------

export async function getCandidateHiringEligibility(
  ctx: RequestContext,
  candidateId: string,
): Promise<{
  candidate: Candidate;
  requisition: JobRequisition;
  offer: JobOffer;
  joining: CandidateJoining;
}> {
  const candidate = await findCandidateById(ctx, candidateId);
  if (!candidate) {
    throw new Error('Candidate not found');
  }

  const requisition = await findRequisitionById(ctx, candidate.requisitionId);
  if (!requisition) {
    throw new Error('Job requisition not found');
  }

  // Candidate must be in 'selected' status
  if (candidate.status !== 'selected') {
    const error = new Error(`Candidate must be in 'selected' status to be hired (current: ${candidate.status})`);
    (error as Error & { code?: string }).code = 'INVALID_CANDIDATE_STATE';
    throw error;
  }

  // Must have an accepted offer
  const offers = await listOffers(ctx, { candidateId, status: 'accepted' });
  const offer = offers[0];
  if (!offer) {
    const error = new Error('Candidate has no accepted job offer');
    (error as Error & { code?: string }).code = 'NO_ACCEPTED_OFFER';
    throw error;
  }

  // Must have a pending or confirmed candidate joining record
  const joinings = await listJoinings(ctx, { candidateId });
  const joining = joinings.find((j) => j.status === 'pending' || j.status === 'confirmed');
  if (!joining) {
    const error = new Error('Candidate has no active pending/confirmed joining record');
    (error as Error & { code?: string }).code = 'NO_JOINING_RECORD';
    throw error;
  }

  return { candidate, requisition, offer, joining };
}

export async function finalizeCandidateJoining(
  ctx: RequestContext,
  joiningId: string,
  employeeId: string,
  actualJoiningDate?: string,
): Promise<CandidateJoining> {
  const dateClause = actualJoiningDate
    ? sql`${actualJoiningDate}::date`
    : sql`CURRENT_DATE`;

  await db.query(
    ctx,
    sql`
      UPDATE candidate_joining
      SET status = 'joined',
          employee_id = ${employeeId},
          actual_joining_date = ${dateClause}
      WHERE organization_id = ${ctx.organizationId} AND id = ${joiningId}
    `,
  );

  const updated = await findJoiningById(ctx, joiningId);
  if (!updated) throw new Error('Failed to retrieve finalized joining record');
  return updated;
}
