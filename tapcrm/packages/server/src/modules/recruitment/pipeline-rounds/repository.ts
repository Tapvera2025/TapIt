import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { PipelineRound } from '../types.js';
import type {
  CreatePipelineRoundInput,
  UpdatePipelineRoundInput,
  ReorderPipelineRoundsInput,
} from '../validators.js';

const ROUND_COLUMNS = sql`
  r.id,
  r.organization_id,
  r.requisition_id,
  r.name,
  r.mode,
  r.order_index,
  r.interviewer_note,
  r.created_at,
  r.updated_at
`;

export async function listPipelineRounds(
  ctx: RequestContext,
  requisitionId: string,
): Promise<PipelineRound[]> {
  return db.query<PipelineRound>(
    ctx,
    sql`
      SELECT ${ROUND_COLUMNS}
      FROM recruitment_pipeline_round r
      WHERE r.organization_id = ${ctx.organizationId}
        AND r.requisition_id = ${requisitionId}
      ORDER BY r.order_index ASC, r.created_at ASC
    `,
  );
}

export async function findPipelineRoundById(
  ctx: RequestContext,
  id: string,
): Promise<PipelineRound | null> {
  return db.maybeOne<PipelineRound>(
    ctx,
    sql`
      SELECT ${ROUND_COLUMNS}
      FROM recruitment_pipeline_round r
      WHERE r.organization_id = ${ctx.organizationId} AND r.id = ${id}
    `,
  );
}

export async function createPipelineRound(
  ctx: RequestContext,
  input: CreatePipelineRoundInput,
): Promise<PipelineRound> {
  const inserted = await db.one<{ id: string }>(
    ctx,
    sql`
      INSERT INTO recruitment_pipeline_round (
        organization_id,
        requisition_id,
        name,
        mode,
        order_index,
        interviewer_note
      )
      VALUES (
        ${ctx.organizationId},
        ${input.requisitionId},
        ${input.name},
        ${input.mode},
        ${input.orderIndex},
        ${input.interviewerNote ?? null}
      )
      RETURNING id
    `,
  );
  const round = await findPipelineRoundById(ctx, inserted.id);
  if (!round) throw new Error('Failed to retrieve created pipeline round');
  return round;
}

export async function updatePipelineRound(
  ctx: RequestContext,
  id: string,
  input: UpdatePipelineRoundInput,
): Promise<PipelineRound | null> {
  const setClauses = [];
  if (input.name !== undefined) setClauses.push(sql`name = ${input.name}`);
  if (input.mode !== undefined) setClauses.push(sql`mode = ${input.mode}`);
  if (input.orderIndex !== undefined) setClauses.push(sql`order_index = ${input.orderIndex}`);
  if ('interviewerNote' in input) setClauses.push(sql`interviewer_note = ${input.interviewerNote ?? null}`);

  if (setClauses.length === 0) return findPipelineRoundById(ctx, id);

  await db.query(
    ctx,
    sql`
      UPDATE recruitment_pipeline_round
      SET ${sql.join(setClauses, ', ')}
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `,
  );
  return findPipelineRoundById(ctx, id);
}

export async function deletePipelineRound(
  ctx: RequestContext,
  id: string,
): Promise<void> {
  await db.query(
    ctx,
    sql`
      DELETE FROM recruitment_pipeline_round
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `,
  );
}

export async function reorderPipelineRounds(
  ctx: RequestContext,
  input: ReorderPipelineRoundsInput,
): Promise<void> {
  for (const item of input.rounds) {
    await db.query(
      ctx,
      sql`
        UPDATE recruitment_pipeline_round
        SET order_index = ${item.orderIndex}
        WHERE organization_id = ${ctx.organizationId} AND id = ${item.id}
      `,
    );
  }
}
