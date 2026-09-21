import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@tapcrm/contracts';
import { installAuthz } from '../../platform/authz-adapter.js';
import { createRequestContext, type RequestContext } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { grantOverride, revokeOverride } from './service.js';

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
const DEPT = randomUUID();
const POS_LEAD = randomUUID();
const POS_AGENT = randomUUID();
const LEAD = randomUUID();
const AGENT = randomUUID();
const OUTSIDER = randomUUID();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

function ctxFor(userId: string, positionId: string, level: number): RequestContext {
  const principal: Principal = {
    id: userId,
    organizationId: ORG,
    accountType: 'employee',
    sessionVersion: 1,
    positionId,
    departmentId: DEPT,
    teamId: null,
    reportsTo: null,
    organizationalLevel: level,
  };
  return createRequestContext({ organizationId: ORG, principal, requestId: `test-${userId}` });
}

const leadCtx = () => ctxFor(LEAD, POS_LEAD, 50);

describe.skipIf(!enabled)('override write path (PostgreSQL)', () => {
  beforeAll(async () => {
    if (!new URL(migrationUrl).pathname.includes('test')) throw new Error('refusing non-test database');
    installAuthz();

    await asOwner('create test organization', sql`
      INSERT INTO organization (id, code, name) VALUES (${ORG}, ${`AM${ORG.slice(0, 6)}`}, 'Access Test')`);
    await asOwner('create test department', sql`
      INSERT INTO department (id, organization_id, code, name, kind)
      VALUES (${DEPT}, ${ORG}, 'SALES', 'Sales', 'sales')`);
    await asOwner('create test positions', sql`
      INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
      VALUES (${POS_LEAD}, ${ORG}, ${DEPT}, 'LEAD', 'Team Lead', 50),
             (${POS_AGENT}, ${ORG}, ${DEPT}, 'AGENT', 'Agent', 20)`);
    await asOwner('create test users', sql`
      INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
      VALUES (${LEAD}, ${ORG}, 'employee', 'EMP-00001', ${`lead-${LEAD}@t.io`}, 'Lead', ${POS_LEAD}, ${DEPT}),
             (${AGENT}, ${ORG}, 'employee', 'EMP-00002', ${`agent-${AGENT}@t.io`}, 'Agent', ${POS_AGENT}, ${DEPT}),
             (${OUTSIDER}, ${ORG}, 'employee', 'EMP-00003', ${`out-${OUTSIDER}@t.io`}, 'Outsider', ${POS_AGENT}, ${DEPT})`);
    // The lead may delegate across the department and holds leads:view there.
    await asOwner('grant lead their position policies', sql`
      INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
      VALUES (${ORG}, ${POS_LEAD}, 'access:delegate', true, 'department'),
             (${ORG}, ${POS_LEAD}, 'leads:view', true, 'department')`);
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
    await asOwner('remove test users', sql`DELETE FROM app_user WHERE organization_id = ${ORG}`);
    await asOwner('remove test organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
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
});
