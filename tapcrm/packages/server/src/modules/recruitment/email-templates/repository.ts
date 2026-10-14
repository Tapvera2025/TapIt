import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { RecruitmentEmailTemplate } from '../types.js';
import type { CreateEmailTemplateInput, UpdateEmailTemplateInput } from '../validators.js';

const TEMPLATE_COLUMNS = sql`
  t.id,
  t.organization_id,
  t.name,
  t.subject,
  t.body,
  t.is_default,
  t.created_at,
  t.updated_at
`;

export async function listEmailTemplates(
  ctx: RequestContext,
): Promise<RecruitmentEmailTemplate[]> {
  return db.query<RecruitmentEmailTemplate>(
    ctx,
    sql`
      SELECT ${TEMPLATE_COLUMNS}
      FROM recruitment_email_template t
      WHERE t.organization_id = ${ctx.organizationId}
      ORDER BY t.is_default DESC, t.created_at ASC
    `,
  );
}

export async function findEmailTemplateById(
  ctx: RequestContext,
  id: string,
): Promise<RecruitmentEmailTemplate | null> {
  return db.maybeOne<RecruitmentEmailTemplate>(
    ctx,
    sql`
      SELECT ${TEMPLATE_COLUMNS}
      FROM recruitment_email_template t
      WHERE t.organization_id = ${ctx.organizationId} AND t.id = ${id}
    `,
  );
}

export async function createEmailTemplate(
  ctx: RequestContext,
  input: CreateEmailTemplateInput,
): Promise<RecruitmentEmailTemplate> {
  if (input.isDefault) {
    await db.query(
      ctx,
      sql`
        UPDATE recruitment_email_template
        SET is_default = false
        WHERE organization_id = ${ctx.organizationId} AND is_default = true
      `,
    );
  }

  const inserted = await db.one<{ id: string }>(
    ctx,
    sql`
      INSERT INTO recruitment_email_template (
        organization_id, name, subject, body, is_default
      )
      VALUES (
        ${ctx.organizationId},
        ${input.name},
        ${input.subject},
        ${input.body},
        ${input.isDefault ?? false}
      )
      RETURNING id
    `,
  );
  const template = await findEmailTemplateById(ctx, inserted.id);
  if (!template) throw new Error('Failed to retrieve created email template');
  return template;
}

export async function updateEmailTemplate(
  ctx: RequestContext,
  id: string,
  input: UpdateEmailTemplateInput,
): Promise<RecruitmentEmailTemplate | null> {
  if (input.isDefault === true) {
    await db.query(
      ctx,
      sql`
        UPDATE recruitment_email_template
        SET is_default = false
        WHERE organization_id = ${ctx.organizationId} AND is_default = true AND id != ${id}
      `,
    );
  }

  const setClauses = [];
  if (input.name !== undefined) setClauses.push(sql`name = ${input.name}`);
  if (input.subject !== undefined) setClauses.push(sql`subject = ${input.subject}`);
  if (input.body !== undefined) setClauses.push(sql`body = ${input.body}`);
  if (input.isDefault !== undefined) setClauses.push(sql`is_default = ${input.isDefault}`);

  if (setClauses.length === 0) return findEmailTemplateById(ctx, id);

  await db.query(
    ctx,
    sql`
      UPDATE recruitment_email_template
      SET ${sql.join(setClauses, ', ')}
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `,
  );
  return findEmailTemplateById(ctx, id);
}

export async function deleteEmailTemplate(
  ctx: RequestContext,
  id: string,
): Promise<void> {
  await db.query(
    ctx,
    sql`
      DELETE FROM recruitment_email_template
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `,
  );
}
