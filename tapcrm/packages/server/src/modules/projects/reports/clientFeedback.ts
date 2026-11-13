import { z } from 'zod';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { ProjectNotFoundError } from '../errors.js';
import { findProjectById } from '../repository.js';
import { notifyClientFeedbackReceived } from '../notifications.js';

export const FEEDBACK_AREAS = ['keyword-tracker', 'blog-updates', 'off-page-seo', 'screenshots'] as const;
export type FeedbackArea = (typeof FEEDBACK_AREAS)[number];
export const feedbackAreaSchema = z.enum(FEEDBACK_AREAS);
export const feedbackListQuerySchema = z.object({ area: feedbackAreaSchema.optional() });
export const createClientFeedbackSchema = z.object({ area: feedbackAreaSchema, note: z.string().trim().min(1).max(5000) });
export type CreateClientFeedbackInput = z.infer<typeof createClientFeedbackSchema>;
export interface ClientFeedback { readonly id: string; readonly projectId: string; readonly area: FeedbackArea; readonly note: string; readonly createdByName: string; readonly createdAt: Date; }

const feedbackSelect = sql`SELECT f.id, f.project_id AS "projectId", f.area, f.note, COALESCE(u.full_name, 'Client') AS "createdByName", f.created_at AS "createdAt" FROM client_project_feedback f LEFT JOIN app_user u ON u.organization_id = f.organization_id AND u.id = f.created_by`;

export async function listClientFeedback(ctx: RequestContext, projectId: string, area?: FeedbackArea): Promise<ClientFeedback[]> {
  if (!await findProjectById(ctx, projectId)) throw new ProjectNotFoundError();
  return db.query<ClientFeedback>(ctx, sql`${feedbackSelect} WHERE f.organization_id = ${ctx.organizationId} AND f.project_id = ${projectId} AND (${area ?? null}::text IS NULL OR f.area = ${area ?? null}) ORDER BY f.created_at DESC, f.id DESC`);
}

export async function insertClientFeedback(tx: Tx, ctx: RequestContext, projectId: string, input: CreateClientFeedbackInput): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`INSERT INTO client_project_feedback (organization_id, project_id, created_by, area, note) VALUES (${ctx.organizationId}, ${projectId}, ${ctx.principal.id}, ${input.area}, ${input.note}) RETURNING id`);
  return row.id;
}

export async function createClientFeedback(ctx: RequestContext, projectId: string, input: CreateClientFeedbackInput): Promise<ClientFeedback> {
  const project = await findProjectById(ctx, projectId);
  if (!project) throw new ProjectNotFoundError();
  const id = await db.transaction(ctx, async (tx) => {
    const feedbackId = await insertClientFeedback(tx, ctx, projectId, input);
    const assignees = await tx.query<{ userId: string }>(sql`
      SELECT pa.user_id AS "userId"
      FROM project_assignee pa
      JOIN app_user u
        ON u.organization_id = pa.organization_id
       AND u.id = pa.user_id
       AND u.status = 'active'
       AND u.account_type = 'employee'
      WHERE pa.organization_id = ${ctx.organizationId} AND pa.project_id = ${projectId}
    `);
    await notifyClientFeedbackReceived(
      tx,
      ctx,
      { id: project.id, name: project.name },
      assignees.map(({ userId }) => userId),
      input.area,
      feedbackId,
      input.note,
    );
    return feedbackId;
  });
  return db.one<ClientFeedback>(ctx, sql`${feedbackSelect} WHERE f.organization_id = ${ctx.organizationId} AND f.id = ${id}`);
}
