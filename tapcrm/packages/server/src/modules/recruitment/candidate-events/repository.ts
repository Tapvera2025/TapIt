import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { CandidateEvent, CandidateEventType } from '../types.js';

export async function listCandidateEvents(
  ctx: RequestContext,
  candidateId: string,
): Promise<CandidateEvent[]> {
  return db.query<CandidateEvent>(
    ctx,
    sql`
      SELECT
        e.id,
        e.organization_id,
        e.candidate_id,
        e.event_type,
        e.actor_id,
        u.full_name AS actor_name,
        e.metadata,
        e.occurred_at
      FROM recruitment_candidate_event e
      LEFT JOIN app_user u
        ON u.organization_id = e.organization_id AND u.id = e.actor_id
      WHERE e.organization_id = ${ctx.organizationId}
        AND e.candidate_id = ${candidateId}
      ORDER BY e.occurred_at DESC
    `,
  );
}

export async function createCandidateEvent(
  ctx: RequestContext,
  candidateId: string,
  eventType: CandidateEventType,
  actorId: string | null,
  metadata: Record<string, unknown> | null,
): Promise<void> {
  await db.query(
    ctx,
    sql`
      INSERT INTO recruitment_candidate_event (
        organization_id, candidate_id, event_type, actor_id, metadata
      )
      VALUES (
        ${ctx.organizationId},
        ${candidateId},
        ${eventType},
        ${actorId ?? null},
        ${metadata ? sql`${JSON.stringify(metadata)}::jsonb` : null}
      )
    `,
  );
}
