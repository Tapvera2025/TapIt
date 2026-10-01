import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { MyNotepadDbRow, MyNotepadHistoryDbRow } from './types.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Fetch the current notepad record for the authenticated user and tenant context.
 */
export async function findCurrentNoteRow(
  ctx: RequestContext,
): Promise<MyNotepadDbRow | null> {
  return db.maybeOne<MyNotepadDbRow>(
    ctx,
    sql`
      SELECT id, organization_id, user_id, content, created_at, updated_at
      FROM my_notepad
      WHERE organization_id = ${ctx.organizationId} AND user_id = ${ctx.principal.id}
    `,
  );
}

/**
 * Upsert the current note and create a history snapshot in an atomic transaction.
 */
export async function saveNoteTx(
  tx: Tx,
  organizationId: string,
  userId: string,
  content: string,
): Promise<{ note: MyNotepadDbRow; history: MyNotepadHistoryDbRow }> {
  const note = await tx.one<MyNotepadDbRow>(sql`
    INSERT INTO my_notepad (organization_id, user_id, content, created_at, updated_at)
    VALUES (${organizationId}, ${userId}, ${content}, now(), now())
    ON CONFLICT (organization_id, user_id)
    DO UPDATE SET
      content = EXCLUDED.content,
      updated_at = now()
    RETURNING id, organization_id, user_id, content, created_at, updated_at
  `);

  const history = await tx.one<MyNotepadHistoryDbRow>(sql`
    INSERT INTO my_notepad_history (organization_id, user_id, content, created_at)
    VALUES (${organizationId}, ${userId}, ${content}, now())
    RETURNING id, organization_id, user_id, content, created_at
  `);

  return { note, history };
}

/**
 * Clear the current note by setting content to empty string.
 * History is deliberately untouched.
 */
export async function clearCurrentNoteRow(
  ctx: RequestContext,
): Promise<MyNotepadDbRow> {
  return db.one<MyNotepadDbRow>(
    ctx,
    sql`
      INSERT INTO my_notepad (organization_id, user_id, content, created_at, updated_at)
      VALUES (${ctx.organizationId}, ${ctx.principal.id}, '', now(), now())
      ON CONFLICT (organization_id, user_id)
      DO UPDATE SET
        content = '',
        updated_at = now()
      RETURNING id, organization_id, user_id, content, created_at, updated_at
    `,
  );
}

/**
 * Retrieve saved note history snapshots for the authenticated user, newest first.
 */
export async function listNoteHistoryRows(
  ctx: RequestContext,
): Promise<MyNotepadHistoryDbRow[]> {
  return db.query<MyNotepadHistoryDbRow>(
    ctx,
    sql`
      SELECT id, organization_id, user_id, content, created_at
      FROM my_notepad_history
      WHERE organization_id = ${ctx.organizationId} AND user_id = ${ctx.principal.id}
      ORDER BY created_at DESC, id DESC
    `,
  );
}

/**
 * Retrieve a specific historical note by ID scoped strictly to the current user and tenant.
 */
export async function findHistoricalNoteRowById(
  ctx: RequestContext,
  id: string,
): Promise<MyNotepadHistoryDbRow | null> {
  if (!UUID_REGEX.test(id)) return null;

  return db.maybeOne<MyNotepadHistoryDbRow>(
    ctx,
    sql`
      SELECT id, organization_id, user_id, content, created_at
      FROM my_notepad_history
      WHERE organization_id = ${ctx.organizationId}
        AND user_id = ${ctx.principal.id}
        AND id = ${id}
    `,
  );
}
