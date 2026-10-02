import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { route } from '../../platform/http/route.js';
import { sql } from '../../platform/dal/sql.js';
import { createHoliday, listHolidays, reviseHoliday } from './service.js';
import { createSchema, listQuerySchema, reviseSchema } from './validators.js';

/** Design §7 — three bindings, as declared in the registry seed. */

async function loadHoliday(ctx: RequestContext, id: string): Promise<Resource | null> {
  return db.maybeOne<Resource>(
    ctx,
    sql`
    SELECT 'holiday' AS type, id, organization_id AS "organizationId"
    FROM holiday WHERE id = ${id}
    `,
  );
}

export function registerHolidayRoutes(): void {
  route({
    method: 'GET',
    path: '/api/holidays',
    action: 'holidays:view',
    module: 'holidays',
    handler: async ({ ctx, query }) => listHolidays(ctx, listQuerySchema.parse(query)),
  });

  route({
    method: 'POST',
    path: '/api/holidays',
    action: 'holidays:manage',
    module: 'holidays',
    handler: async ({ ctx, body }) => createHoliday(ctx, createSchema.parse(body)),
  });

  route({
    method: 'PATCH',
    path: '/api/holidays/:id',
    action: 'holidays:manage',
    module: 'holidays',
    resourceParam: 'id',
    loadResource: loadHoliday,
    handler: async ({ ctx, params, body }) =>
      reviseHoliday(ctx, params['id']!, reviseSchema.parse(body)),
  });
}
