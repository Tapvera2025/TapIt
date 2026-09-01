import type { Request } from 'express';
import type { Action } from '@tapcrm/contracts';
import { bootstrapDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import {
  installPrincipalResolver,
  type PrincipalResolution,
} from '../../platform/http/context.js';
import { verifyAccessToken } from './token.js';
import { buildPrincipalForResolver } from './resolver-principal.js';
import { touchSession } from './sessions.js';
import { authenticateServiceCredential } from './service.js';

interface AuthRow {
  id: string;
  organizationId: string;
  accountType: 'super-admin' | 'employee' | 'client' | 'service';
  sessionVersion: number;
  status: 'active' | 'inactive' | 'locked' | 'offboarded';
  email: string | null;
  fullName: string;
  mfaRequired: boolean;
  positionId: string | null;
  departmentId: string | null;
  teamId: string | null;
  reportsTo: string | null;
  clientId: string | null;
  organizationalLevel: number | null;
}

export function installIdentityPrincipalResolver(): void {
  installPrincipalResolver(async (req: Request): Promise<PrincipalResolution | null> => {
    const authorization = req.get('authorization');
    if (authorization?.startsWith('Bearer tcrm_sa_')) {
      const credential = authorization.slice('Bearer '.length).trim();
      const sa = await authenticateServiceCredential(
        credential,
        req.ip ?? req.socket.remoteAddress ?? null,
      );
      if (!sa) return null;
      return {
        principal: {
          id: sa.id,
          organizationId: sa.organizationId,
          accountType: 'service',
          sessionVersion: 0,
          allowedActions: sa.allowedActions as Action[],
          allowedResources: sa.allowedResources,
          expiresAt: new Date(sa.expiresAt),
        },
        organizationId: sa.organizationId,
        sessionId: '',
      };
    }

    const token = req.cookies?.['tapcrm_access'];

    if (typeof token !== 'string' || token.length === 0) {
      return null;
    }

    const payload = await verifyAccessToken(token);

    if (!payload) {
      return null;
    }

    const rows = await bootstrapDb.readAs<AuthRow>(
      payload.org,
      sql`
        SELECT
          u.id,
          u.organization_id AS "organizationId",
          u.account_type AS "accountType",
          u.session_version AS "sessionVersion",
          u.status,
          u.email,
          u.full_name AS "fullName",
          u.mfa_required AS "mfaRequired",
          u.position_id AS "positionId",
          u.department_id AS "departmentId",
          u.team_id AS "teamId",
          u.reports_to AS "reportsTo",
          u.client_id AS "clientId",
          p.organizational_level AS "organizationalLevel"
        FROM app_user u
        LEFT JOIN position p
          ON p.organization_id = u.organization_id
         AND p.id = u.position_id
        INNER JOIN session s
          ON s.organization_id = u.organization_id
         AND s.user_id = u.id
         AND s.id = ${payload.sid}
        WHERE
          u.organization_id = ${payload.org}
          AND u.id = ${payload.sub}
          AND u.account_type = ${payload.typ}
          AND u.status = 'active'
          AND u.session_version = ${payload.ver}
          AND s.session_version = ${payload.ver}
          AND s.revoked_at IS NULL
          AND s.expires_at > NOW()
        LIMIT 1
      `,
    );

    const row = rows[0];

    if (!row) {
      return null;
    }

    req.authSessionId = payload.sid;

    // Asynchronously touch session last active timestamp
    void touchSession(row.organizationId, payload.sid);

    return {
      organizationId: row.organizationId,
      sessionId: payload.sid,
      principal: buildPrincipalForResolver(row),
    };
  });
}
