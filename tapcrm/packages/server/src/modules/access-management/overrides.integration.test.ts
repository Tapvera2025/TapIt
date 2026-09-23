import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@tapcrm/contracts';
import { effectivePolicy } from '@tapcrm/authz';
import { installAuthz } from '../../platform/authz-adapter.js';
import { createRequestContext, type RequestContext } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { decideRoleChange, grantOverride, requestRoleChange, revokeOverride } from './service.js';

/**
 * The override write path against REAL PostgreSQL, through the runtime role.
 *
 * The point of these, beyond CRUD: a granted override must actually change what
 * the authorization engine resolves. A write path that stores rows the engine
 * does not read is the failure mode worth testing for.
 *
 * Opt-in, same harness as the audit drainer:
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=... DATABASE_URL=... \
 *   JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... REDIS_URL=... npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const migrationUrl = process.env['MIGRATION_DATABASE_URL'] ?? '';

const ORG = randomUUID();
const OTHER_ORG_FOR_TEAM = randomUUID();
const DEPT = randomUUID();
const OTHER_DEPT = randomUUID();
const OTHER_ORG_DEPT = randomUUID();
const POS_LEAD = randomUUID();
const POS_AGENT = randomUUID();
const POS_HR = randomUUID();
const POS_OTHER = randomUUID();
const TEAM_SALES = randomUUID();
const TEAM_OTHER = randomUUID();
const OTHER_ORG_TEAM = randomUUID();
const LEAD = randomUUID();
const AGENT = randomUUID();
const OUTSIDER = randomUUID();
const HR = randomUUID();
const HR_OTHER = randomUUID();
const SUPER = randomUUID();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

function ctxFor(userId: string, positionId: string, level: number, departmentId = DEPT): RequestContext {
  const principal: Principal = {
    id: userId,
    organizationId: ORG,
    accountType: 'employee',
    sessionVersion: 1,
    positionId,
    departmentId,
    teamId: null,
    reportsTo: null,
    organizationalLevel: level,
  };
  return createRequestContext({ organizationId: ORG, principal, requestId: `test-${userId}` });
}

const leadCtx = () => ctxFor(LEAD, POS_LEAD, 50);
const hrCtx = () => ctxFor(HR, POS_HR, 90);
const promotedAgentCtx = () => ctxFor(AGENT, POS_LEAD, 50);
const superCtx = () => createRequestContext({
  organizationId: ORG,
  principal: {
    id: SUPER,
    organizationId: ORG,
    accountType: 'super-admin',
    sessionVersion: 1,
  },
  requestId: `test-${SUPER}`,
});

describe.skipIf(!enabled)('override write path (PostgreSQL)', () => {
  beforeAll(async () => {
    if (!new URL(migrationUrl).pathname.includes('test')) throw new Error('refusing non-test database');
    installAuthz();

    await asOwner('create test organization', sql`
      INSERT INTO organization (id, code, name) VALUES (${ORG}, ${`AM${ORG.slice(0, 6)}`}, 'Access Test')`);
    await asOwner('create foreign test organization', sql`
      INSERT INTO organization (id, code, name) VALUES (${OTHER_ORG_FOR_TEAM}, ${`AMX${OTHER_ORG_FOR_TEAM.slice(0, 5)}`}, 'Foreign Access Test')`);
    await asOwner('create test department', sql`
      INSERT INTO department (id, organization_id, code, name, kind)
      VALUES (${DEPT}, ${ORG}, 'SALES', 'Sales', 'sales')`);
    await asOwner('create second test department', sql`
      INSERT INTO department (id, organization_id, code, name, kind)
      VALUES (${OTHER_DEPT}, ${ORG}, 'OTHER', 'Other', 'other')`);
    await asOwner('create foreign team', sql`
      INSERT INTO department (id, organization_id, code, name, kind)
      VALUES (${OTHER_ORG_DEPT}, ${OTHER_ORG_FOR_TEAM}, 'FOREIGN', 'Foreign', 'other')`);
    await asOwner('create test positions', sql`
      INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
      VALUES (${POS_LEAD}, ${ORG}, ${DEPT}, 'LEAD', 'Team Lead', 50),
             (${POS_AGENT}, ${ORG}, ${DEPT}, 'AGENT', 'Agent', 20),
             (${POS_HR}, ${ORG}, ${DEPT}, 'hr', 'HR', 90),
             (${POS_OTHER}, ${ORG}, ${OTHER_DEPT}, 'OTHER', 'Other', 20)`);
    await asOwner('create test teams', sql`
      INSERT INTO team (id, organization_id, department_id, kind, name)
      VALUES (${TEAM_SALES}, ${ORG}, ${DEPT}, 'sales-team', 'Sales Team'),
             (${TEAM_OTHER}, ${ORG}, ${OTHER_DEPT}, 'sales-team', 'Other Team')`);
    await asOwner('create foreign organization team', sql`
      INSERT INTO team (id, organization_id, department_id, kind, name)
      VALUES (${OTHER_ORG_TEAM}, ${OTHER_ORG_FOR_TEAM}, ${OTHER_ORG_DEPT}, 'sales-team', 'Foreign Team')`);
    await asOwner('create test users', sql`
      INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
      VALUES (${LEAD}, ${ORG}, 'employee', 'EMP-00001', ${`lead-${LEAD}@t.io`}, 'Lead', ${POS_LEAD}, ${DEPT}),
             (${AGENT}, ${ORG}, 'employee', 'EMP-00002', ${`agent-${AGENT}@t.io`}, 'Agent', ${POS_AGENT}, ${DEPT}),
             (${OUTSIDER}, ${ORG}, 'employee', 'EMP-00003', ${`out-${OUTSIDER}@t.io`}, 'Outsider', ${POS_OTHER}, ${OTHER_DEPT}),
             (${HR}, ${ORG}, 'employee', 'EMP-00004', ${`hr-${HR}@t.io`}, 'HR', ${POS_HR}, ${DEPT}),
             (${HR_OTHER}, ${ORG}, 'employee', 'EMP-00005', ${`hr-other-${HR_OTHER}@t.io`}, 'HR Other', ${POS_HR}, ${DEPT}),
             (${SUPER}, ${ORG}, 'super-admin', NULL, ${`super-${SUPER}@t.io`}, 'Super Admin', NULL, NULL)`);
    await asOwner('set reporting relationship', sql`
      UPDATE app_user SET reports_to = ${HR}
      WHERE organization_id = ${ORG} AND id = ${AGENT}`);
    await asOwner('set test employee teams', sql`
      UPDATE app_user SET team_id = CASE
        WHEN id = ${AGENT} THEN ${TEAM_SALES}
        WHEN id = ${OUTSIDER} THEN ${TEAM_OTHER}
        ELSE team_id END
      WHERE organization_id = ${ORG}`);
    // The lead may delegate across the department and holds leads:view there.
    await asOwner('grant lead their position policies', sql`
      INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
      VALUES (${ORG}, ${POS_LEAD}, 'access:delegate', true, 'department'),
             (${ORG}, ${POS_LEAD}, 'leads:view', true, 'department'),
             (${ORG}, ${POS_HR}, 'access:request-role-change', true, 'department'),
             (${ORG}, ${POS_HR}, 'users:view', true, 'all-people')`);
    await asOwner('seed role-change regression overrides', sql`
      INSERT INTO user_override
        (organization_id, user_id, action, allowed, scope, reason, granted_by)
      VALUES
        (${ORG}, ${HR}, 'users:view', true, 'department',
         'Regression: restrict HR target scope', ${SUPER})`);
  });

  afterAll(async () => {
    await asOwner('remove test audit rows', sql`DELETE FROM audit_outbox WHERE organization_id = ${ORG}`);
    // Teardown order is dictated by a schema gap worth knowing about:
    // `identity_email_directory` (migration 0024) holds NON-cascading FKs to
    // both `organization` and `app_user`, because migration 0012's cascade
    // rewrite ran before that table existed. Its cleanup trigger is AFTER
    // DELETE, which is too late for a non-deferred constraint — so an app_user
    // row carrying an email cannot be deleted until the directory row goes
    // first. Eight tables added after 0012 share the non-cascading FK.
    await asOwner('remove directory rows', sql`DELETE FROM identity_email_directory WHERE organization_id = ${ORG}`);
    await asOwner('remove role change requests', sql`DELETE FROM role_change_request WHERE organization_id = ${ORG}`);
    await asOwner('remove test users', sql`DELETE FROM app_user WHERE organization_id = ${ORG}`);
    await asOwner('remove test teams', sql`DELETE FROM team WHERE organization_id = ${ORG}`);
    await asOwner('remove test organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await asOwner('remove foreign test team', sql`DELETE FROM team WHERE organization_id = ${OTHER_ORG_FOR_TEAM}`);
    await asOwner('remove foreign test department', sql`DELETE FROM department WHERE organization_id = ${OTHER_ORG_FOR_TEAM}`);
    await asOwner('remove foreign test organization', sql`DELETE FROM organization WHERE id = ${OTHER_ORG_FOR_TEAM}`);
    await closePools();
  });

  async function storedOverrides(userId: string) {
    return db.query<{ id: string; action: string; scope: string; reason: string; revokedAt: Date | null }>(
      leadCtx(),
      sql`SELECT id, action, scope, reason, revoked_at FROM user_override
          WHERE organization_id = ${ORG} AND user_id = ${userId} ORDER BY granted_at`,
    );
  }

  it('grants an override and records who, why and when', async () => {
    const result = await grantOverride(leadCtx(), {
      userId: AGENT,
      action: 'leads:view',
      allowed: true,
      scope: 'team',
      fields: null,
      reason: 'Covering the supervisor while on leave',
      expiresAt: null,
    });
    expect(result.id).toBeTruthy();

    const [stored] = await storedOverrides(AGENT);
    expect(stored).toMatchObject({
      action: 'leads:view',
      scope: 'team',
      reason: 'Covering the supervisor while on leave',
      revokedAt: null,
    });
  });

  it('makes the engine resolve the granted policy for the subject', async () => {
    const rows = await db.query<{ action: string; scope: string; source: string }>(
      leadCtx(),
      sql`SELECT action, scope, 'override' AS source FROM user_override
          WHERE organization_id = ${ORG} AND user_id = ${AGENT}
            AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    );
    expect(rows).toContainEqual({ action: 'leads:view', scope: 'team', source: 'override' });
  });

  it('audits replacement of an existing override (AM-13)', async () => {
    await grantOverride(leadCtx(), {
      userId: AGENT,
      action: 'leads:view',
      allowed: true,
      scope: 'own',
      fields: null,
      reason: 'Narrower temporary coverage',
      expiresAt: null,
    });
    const rows = await db.query<{ payload: Record<string, unknown> }>(
      leadCtx(),
      sql`SELECT payload FROM audit_outbox WHERE organization_id = ${ORG} AND stream = 'activity'`,
    );
    expect(rows.map((row) => row.payload['action'])).toContain('access.override_superseded');
  });

  it('writes an audit record for the grant (AM-13)', async () => {
    const rows = await db.query<{ payload: Record<string, unknown> }>(
      leadCtx(),
      sql`SELECT payload FROM audit_outbox WHERE organization_id = ${ORG} AND stream = 'activity'`,
    );
    const actions = rows.map((r) => r.payload['action']);
    expect(actions).toContain('access.override_granted');
  });

  it('refuses a grant that exceeds the actor ceiling, naming the constraint', async () => {
    await expect(
      grantOverride(leadCtx(), {
        userId: AGENT,
        action: 'leads:view',
        allowed: true,
        scope: 'all-people',
        fields: null,
        reason: 'too wide',
        expiresAt: null,
      }),
    ).rejects.toMatchObject({ code: 'ACCESS_OVERRIDE_SCOPE_INVALID_FOR_DOMAIN' });
  });

  it('refuses a grant to someone at the same level (seniority)', async () => {
    await expect(
      grantOverride(leadCtx(), {
        userId: LEAD,
        action: 'leads:view',
        allowed: true,
        scope: 'own',
        fields: null,
        reason: 'self grant',
        expiresAt: null,
      }),
    ).rejects.toMatchObject({ code: 'ACCESS_DELEGATION_SENIORITY' });
  });

  it('requires a reason (AM-6)', async () => {
    await expect(
      grantOverride(leadCtx(), {
        userId: AGENT,
        action: 'leads:view',
        allowed: true,
        scope: 'own',
        fields: null,
        reason: '   ',
        expiresAt: null,
      }),
    ).rejects.toThrow();
  });

  it('revokes by marking, never deleting, so the grant stays auditable', async () => {
    const granted = await grantOverride(leadCtx(), {
      userId: OUTSIDER,
      action: 'leads:view',
      allowed: true,
      scope: 'own',
      fields: null,
      reason: 'temporary',
      expiresAt: null,
    });
    await revokeOverride(leadCtx(), granted.id);

    const rows = await storedOverrides(OUTSIDER);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revokedAt).not.toBeNull();
  });

  it('reports an unknown override as not found', async () => {
    await expect(revokeOverride(leadCtx(), randomUUID())).rejects.toMatchObject({
      code: 'ACCESS_OVERRIDE_NOT_FOUND',
    });
  });

  it('stores an expiry, which the resolution query then honours (AM-7)', async () => {
    const past = new Date(Date.now() - 1000);
    await asOwner('insert an already-expired override', sql`
      INSERT INTO user_override (organization_id, user_id, action, allowed, scope, reason, granted_by, expires_at)
      VALUES (${ORG}, ${AGENT}, 'attendance:view', true, 'own', 'expired', ${LEAD}, ${past})`);

    const active = await db.query<{ action: string }>(
      leadCtx(),
      sql`SELECT action FROM user_override
          WHERE organization_id = ${ORG} AND user_id = ${AGENT}
            AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    );
    expect(active.map((r) => r.action)).not.toContain('attendance:view');
  });

  it('routes role changes through Super Admin and clears overrides atomically (AM-8/12/13)', async () => {
    await expect(requestRoleChange(ctxFor(AGENT, POS_AGENT, 20), {
      subjectUserId: OUTSIDER,
      toPositionId: POS_OTHER,
      reason: 'Normal employees cannot submit role-change requests',
    })).rejects.toThrow(/No policy|not allow/i);

    await expect(requestRoleChange(leadCtx(), {
      subjectUserId: AGENT,
      toPositionId: POS_LEAD,
      reason: 'Managers must not submit role-change requests',
    })).rejects.toThrow(/No policy|not allow/i);

    await asOwner('delegate role-change action to manager', sql`
      INSERT INTO user_override
        (organization_id, user_id, action, allowed, scope, reason, granted_by)
      VALUES (${ORG}, ${LEAD}, 'access:request-role-change', true, 'department',
              'Regression: delegated role-change action', ${SUPER})`);
    await expect(requestRoleChange(leadCtx(), {
      subjectUserId: AGENT,
      toPositionId: POS_LEAD,
      reason: 'Delegated action still cannot bypass HR-only rule',
    })).rejects.toMatchObject({ code: 'ACCESS_ROLE_CHANGE_REQUESTER_NOT_HR' });

    await expect(requestRoleChange(hrCtx(), {
      subjectUserId: AGENT,
      toPositionId: POS_OTHER,
      requestedTeamId: TEAM_SALES,
      reason: 'The requested team belongs to another department',
    })).rejects.toMatchObject({ code: 'ACCESS_ROLE_CHANGE_TEAM_INVALID' });

    await expect(requestRoleChange(hrCtx(), {
      subjectUserId: AGENT,
      toPositionId: POS_LEAD,
      requestedTeamId: OTHER_ORG_TEAM,
      reason: 'A team from another organization must be rejected',
    })).rejects.toMatchObject({ code: 'ACCESS_ROLE_CHANGE_TEAM_INVALID' });

    const beforePending = await asOwner('read employee before pending request', sql`
      SELECT position_id AS "positionId", department_id AS "departmentId",
             team_id AS "teamId", reports_to AS "reportsTo"
      FROM app_user WHERE organization_id = ${ORG} AND id = ${AGENT}`);

    await expect(requestRoleChange(hrCtx(), {
      subjectUserId: OUTSIDER,
      toPositionId: POS_OTHER,
      reason: 'HR may request changes across the organization',
    })).rejects.toThrow(/No policy|not allow/i);

    await expect(requestRoleChange(hrCtx(), {
      subjectUserId: HR_OTHER,
      toPositionId: POS_LEAD,
      reason: 'HR cannot request another HR position change',
    })).rejects.toMatchObject({ code: 'ACCESS_ROLE_CHANGE_HR_TARGET_FORBIDDEN' });

    const request = await requestRoleChange(hrCtx(), {
      subjectUserId: AGENT,
      toPositionId: POS_LEAD,
      requestedTeamId: TEAM_SALES,
      reason: 'Promotion approved by management',
    });
    expect(request.status).toBe('pending');
    const duringPending = await asOwner('verify employee unchanged while pending', sql`
      SELECT position_id AS "positionId", department_id AS "departmentId",
             team_id AS "teamId", reports_to AS "reportsTo"
      FROM app_user WHERE organization_id = ${ORG} AND id = ${AGENT}`);
    expect(duringPending[0]).toEqual(beforePending[0]);
    const decision = await decideRoleChange(superCtx(), request.id, {
      approved: true,
      reason: 'Super Admin approval',
    });
    expect(decision.status).toBe('approved');
    const user = await asOwner('verify role change', sql`
      SELECT position_id AS "positionId", department_id AS "departmentId",
             team_id AS "teamId", reports_to AS "reportsTo", session_version AS "sessionVersion"
      FROM app_user WHERE organization_id = ${ORG} AND id = ${AGENT}`);
    expect(user[0]).toMatchObject({
      positionId: POS_LEAD,
      departmentId: DEPT,
      teamId: TEAM_SALES,
      reportsTo: HR,
    });
    const resolved = await effectivePolicy(promotedAgentCtx(), 'leads:view');
    expect(resolved).toMatchObject({ allowed: true, scope: 'department' });
    const active = await db.query<{ id: string }>(
      leadCtx(),
      sql`SELECT id FROM user_override WHERE organization_id = ${ORG} AND user_id = ${AGENT} AND revoked_at IS NULL`,
    );
    expect(active).toHaveLength(0);
    const audits = await db.query<{ payload: Record<string, unknown> }>(
      leadCtx(),
      sql`SELECT payload FROM audit_outbox WHERE organization_id = ${ORG} AND stream = 'activity'`,
    );
    const actions = audits.map((row) => row.payload['action']);
    expect(actions).toEqual(expect.arrayContaining([
      'access.role_change_requested',
      'access.role_change_approved',
      'access.override_cleared_position_change',
    ]));
  });
});
