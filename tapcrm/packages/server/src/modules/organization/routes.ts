import { visibilityFilter } from '@tapcrm/authz';
import { route } from '../../platform/http/route.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { RequestContext } from '../../platform/dal/context.js';
import type { Resource } from '@tapcrm/authz';

/**
 * `organization` route bindings — TECH.md §8.3.
 *
 * Binding declarations only. No authorization logic appears here: API-1 says a
 * handler that calls `authorize` itself fails review, because the framework
 * already did it (router.ts step 3).
 *
 * The paths below come from AUTHORIZATION.md §6.5 verbatim. Changing one makes
 * the boot-time manifest check fail (RM-1), which is the intent — §6.5 says the
 * method-to-action mapping "is the authorization contract, and changing it
 * changes who can do what."
 *
 * ⚠ SCAFFOLD: this module binds the read routes to prove the pipeline end to
 * end. The remaining `organization` bindings from §6.5, and the other four
 * Foundation modules, are still to be implemented — `npm run ci` reports
 * exactly which.
 */

const loadDepartment =
  (table: string) =>
  async (ctx: RequestContext, id: string): Promise<Resource | null> => {
    const row = await db.maybeOne<Record<string, unknown>>(
      ctx,
      sql`SELECT * FROM department WHERE id = ${id}`,
    );
    return row === null ? null : { ...row, type: table, id };
  };

export function registerOrganizationRoutes(): void {
  route({
    method: 'GET',
    path: '/api/org/departments',
    action: 'org:view-structure',
    handler: async ({ ctx }) => {
      // AZ-2 — the filter is built from the scope BEFORE the query runs.
      // "No endpoint fetches broadly and rejects rows afterwards."
      const filter = await visibilityFilter(ctx, 'org:view-structure', 'department');
      return db.query(ctx, sql`
        SELECT id, code, name, kind, status
        FROM department
        WHERE ${filter}
        ORDER BY code
      `);
    },
  });

  route({
    method: 'GET',
    path: '/api/org/teams',
    action: 'org:view-structure',
    handler: async ({ ctx }) => {
      const filter = await visibilityFilter(ctx, 'org:view-structure', 'team');
      return db.query(ctx, sql`
        SELECT id, name, kind, department_id, parent_team_id, lead_user_id
        FROM team
        WHERE ${filter}
        ORDER BY name
      `);
    },
  });

  route({
    method: 'GET',
    path: '/api/org/chart',
    action: 'org:view-people',
    handler: async ({ ctx }) => {
      const filter = await visibilityFilter(ctx, 'org:view-people', 'user');
      // OR-3 — "renders the actual reporting graph from reportsTo, not the
      // position ladder, and HIGHLIGHTS USERS WITH NO MANAGER SET."
      return db.query(ctx, sql`
        SELECT u.id, u.full_name, u.position_id, u.department_id, u.team_id,
               u.reports_to,
               (u.reports_to IS NULL AND u.account_type = 'employee') AS missing_manager
        FROM app_user u
        WHERE u.account_type = 'employee'
          AND u.status = 'active'
          AND ${filter}
        ORDER BY u.full_name
      `);
    },
  });

  route({
    method: 'PATCH',
    path: '/api/org/departments/:id',
    action: 'org:manage-departments',
    resourceParam: 'id',
    loadResource: loadDepartment('department'),
    handler: async ({ ctx, params, body }) => {
      const { name } = body as { name?: string };
      // D-1 — "Department.code is IMMUTABLE. Renaming changes the display name
      // only." The statement below cannot touch `code`, which is why the rule
      // holds without a guard clause anyone could forget.
      return db.one(ctx, sql`
        UPDATE department
        SET name = COALESCE(${name ?? null}, name)
        WHERE id = ${params['id']}
        RETURNING id, code, name, kind, status
      `);
    },
  });
}
