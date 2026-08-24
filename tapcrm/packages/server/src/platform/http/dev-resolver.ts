import type { Request } from 'express';
import type { Principal } from '@tapcrm/contracts';
import { bootstrapDb } from '../dal/db.js';
import { sql } from '../dal/sql.js';
import { installPrincipalResolver } from './context.js';

/**
 * Development principal resolver.
 *
 * ⚠ NOT AN AUTHENTICATION MECHANISM. It trusts an `x-dev-user-id` header, which
 * means anyone who can reach the port is anyone they say they are. It exists so
 * the authorization pipeline can be exercised end to end before the `identity`
 * module lands, and `install()` refuses to run outside development.
 *
 * It loads the REAL user row rather than fabricating a principal from headers,
 * because a principal without `positionId` resolves to an empty permission set —
 * every request 403s and the pipeline looks broken when it is merely unfed.
 *
 * When `identity` lands it installs its own resolver over this one, and this
 * file is deleted.
 */

// camelCase: the DAL maps at the boundary (§5.1).
interface UserRow {
  id: string;
  organizationId: string;
  accountType: 'super-admin' | 'employee' | 'client' | 'service';
  sessionVersion: number;
  status: string;
  positionId: string | null;
  departmentId: string | null;
  teamId: string | null;
  reportsTo: string | null;
  clientId: string | null;
  organizationalLevel: number | null;
}

export function installDevPrincipalResolver(): void {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'installDevPrincipalResolver() must never run in production. It trusts a header.',
    );
  }

  installPrincipalResolver(async (req: Request) => {
    const userId = req.header('x-dev-user-id');
    const organizationId = req.header('x-dev-organization-id');
    if (!userId || !organizationId) return null;

    // `bootstrapDb` sets tenant context from the CLAIMED organization, so RLS
    // still adjudicates: a caller naming someone else's tenant matches zero
    // rows and gets a 401. The identity module's session lookup uses the same
    // primitive.
    const rows = await bootstrapDb.readAs<UserRow>(
      organizationId,
      sql`SELECT u.id, u.organization_id, u.account_type, u.session_version, u.status,
                 u.position_id, u.department_id, u.team_id, u.reports_to, u.client_id,
                 p.organizational_level
          FROM app_user u
          LEFT JOIN position p ON p.id = u.position_id
          WHERE u.id = ${userId} AND u.organization_id = ${organizationId}`,
    );

    const row = rows[0];
    if (row === undefined) return null;

    // Pipeline step 1 — "Account active?" A deactivated user's session stops
    // working (ID-7). Enforced here so the dev path matches the real one.
    if (row.status !== 'active') return null;

    const base = {
      id: row.id,
      organizationId: row.organizationId,
      sessionVersion: row.sessionVersion,
    };

    let principal: Principal;
    switch (row.accountType) {
      case 'super-admin':
        principal = { ...base, accountType: 'super-admin' };
        break;
      case 'client':
        principal = { ...base, accountType: 'client', clientId: row.clientId ?? '' };
        break;
      case 'service':
        principal = {
          ...base,
          accountType: 'service',
          allowedActions: [],
          allowedResources: [],
          expiresAt: new Date(0),
        };
        break;
      default:
        principal = {
          ...base,
          accountType: 'employee',
          positionId: row.positionId ?? '',
          departmentId: row.departmentId ?? '',
          teamId: row.teamId,
          reportsTo: row.reportsTo,
          organizationalLevel: row.organizationalLevel ?? 0,
        };
    }

    return { principal, organizationId: row.organizationId };
  });
}
