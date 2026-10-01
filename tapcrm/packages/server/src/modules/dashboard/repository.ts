import type { DashboardLayoutItem, DashboardPreferences, DashboardWidgetId } from '@tapcrm/contracts';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { RequestContext } from '../../platform/dal/context.js';

interface Row {
  layout: DashboardLayoutItem[];
  hidden: DashboardWidgetId[];
  updatedAt: string;
}

export async function readPreferences(ctx: RequestContext): Promise<DashboardPreferences> {
  const row = await db.maybeOne<Row>(
    ctx,
    sql`
      SELECT layout, hidden, updated_at
      FROM dashboard_preferences
      WHERE organization_id = ${ctx.organizationId} AND user_id = ${ctx.principal.id}
    `,
  );
  if (!row) return { layout: [], hidden: [], updatedAt: null };
  return {
    layout: row.layout ?? [],
    hidden: row.hidden ?? [],
    updatedAt: row.updatedAt,
  };
}

export async function writePreferences(
  ctx: RequestContext,
  input: { layout: readonly DashboardLayoutItem[]; hidden: readonly DashboardWidgetId[] },
): Promise<DashboardPreferences> {
  const row = await db.one<Row>(
    ctx,
    sql`
      INSERT INTO dashboard_preferences (organization_id, user_id, layout, hidden, updated_at)
      VALUES (
        ${ctx.organizationId},
        ${ctx.principal.id},
        ${JSON.stringify(input.layout)}::jsonb,
        ${input.hidden as unknown as string[]},
        now()
      )
      ON CONFLICT (organization_id, user_id) DO UPDATE
      SET layout = EXCLUDED.layout,
          hidden = EXCLUDED.hidden,
          updated_at = now()
      RETURNING layout, hidden, updated_at
    `,
  );
  return { layout: row.layout, hidden: row.hidden, updatedAt: row.updatedAt };
}
