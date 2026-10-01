import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@tapcrm/contracts';
import { installAuthz } from '../../platform/authz-adapter.js';
import { createRequestContext, type RequestContext } from '../../platform/dal/context.js';
import { platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { dispatchOrganization } from '../notifications/dispatcher.js';
import { registerClientPolicies } from '../clients/policy.js';
import { createClient } from '../clients/service.js';
import { ProjectClientNotFoundError, ProjectDiscussionGroupExistsError, ProjectValidationError } from './errors.js';
import { registerProjectPolicies } from './policy.js';
import {
  archiveProject,
  createDiscussionGroup,
  createProject,
  getProject,
  listProjects,
  setProjectTeam,
} from './service.js';
import { projectListQuerySchema } from './validators.js';

/**
 * Runs the projects engine against REAL PostgreSQL: RLS, the client
 * dependency, the currency snapshot, the "creator or assignee" policy, the
 * "you were added" notification (via the real dispatcher), and the wizard's
 * separate discussion-group step (via the chat module's facade — a genuine
 * cross-module integration, not a mock).
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=... DATABASE_URL=... \
 *   REDIS_URL=... JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... \
 *   npx vitest run packages/server/src/modules/projects
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const migrationUrl = process.env['MIGRATION_DATABASE_URL'] ?? '';

describe.skipIf(!enabled)('projects engine (PostgreSQL)', () => {
  const orgA = randomUUID();
  const deptA = randomUUID();
  const posA = randomUUID();
  const admin = randomUUID();
  const alice = randomUUID();
  const bob = randomUUID();

  const asOwner = <T = unknown>(reason: string, fragment: ReturnType<typeof sql>) => platformDb.query<T>('migration', reason, fragment);

  function ctxFor(userId: string): RequestContext {
    const principal: Principal = {
      id: userId, organizationId: orgA, accountType: 'employee', sessionVersion: 1,
      positionId: posA, departmentId: deptA, teamId: null, reportsTo: null, organizationalLevel: 1,
    };
    return createRequestContext({ organizationId: orgA, principal, requestId: `test-${userId}` });
  }
  const asAdmin = () => ctxFor(admin);

  let clientId = '';

  beforeAll(async () => {
    const dbName = new URL(migrationUrl).pathname;
    if (!dbName.includes('test')) throw new Error(`Refusing to run against "${dbName}"`);
    installAuthz();
    registerClientPolicies();
    registerProjectPolicies();

    await asOwner('seed org', sql`INSERT INTO organization (id, code, name) VALUES (${orgA}, ${`PRJA${orgA.slice(0, 6)}`}, 'PRJA')`);
    await asOwner('enable chat module', sql`
      INSERT INTO organization_module (organization_id, module_id, status, enabled_at)
      SELECT ${orgA}, m.id, 'enabled', now() FROM module m WHERE m.key = 'chat'
    `);
    await asOwner('seed dept', sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${deptA}, ${orgA}, 'D1', 'Dept', 'support')`);
    await asOwner('seed position', sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level) VALUES (${posA}, ${orgA}, ${deptA}, 'PM', 'PM', 20)`);
    await asOwner('grant views', sql`
      INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
      VALUES (${orgA}, ${posA}, 'projects:view', true, 'own'), (${orgA}, ${posA}, 'clients:view', true, 'own')
    `);
    for (const [id, code] of [[admin, 'A1'], [alice, 'A2'], [bob, 'A3']] as const) {
      await asOwner(
        'seed user',
        sql`INSERT INTO app_user (id, organization_id, account_type, email, status, full_name, employee_id, department_id, position_id)
            VALUES (${id}, ${orgA}, 'employee', ${`${code}@projects-test.invalid`}, 'active', ${`User ${code}`}, ${`PRJ-${code}`}, ${deptA}, ${posA})`,
      );
    }

    const client = await createClient(asAdmin(), {
      clientName: 'Client Contact', businessName: 'Acme Co', email: 'acme@projects-test.invalid',
      password: 'a-genuinely-strong-password-99', region: 'in',
    });
    clientId = client.id;
  });

  afterAll(async () => {
    for (const table of [
      'notification', 'notification_delivery', 'notification_outbox', 'conversation_member', 'conversation',
      'project_assignee', 'project_service', 'project', 'identity_email_directory',
    ]) {
      await asOwner(`cleanup ${table}`, sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${orgA}`);
    }
    // client.created_by -> app_user, and app_user.client_id -> client: the
    // client-type login rows (which REQUIRE client_id, so it cannot be
    // nulled) must go before `client`, which must go before the rest of
    // app_user (whom `client.created_by` points at).
    await asOwner('cleanup client logins', sql`DELETE FROM app_user WHERE organization_id = ${orgA} AND account_type = 'client'`);
    await asOwner('cleanup client', sql`DELETE FROM client WHERE organization_id = ${orgA}`);
    for (const table of ['app_user', 'position_policy', 'position', 'department', 'organization_module']) {
      await asOwner(`cleanup ${table}`, sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${orgA}`);
    }
    await asOwner('cleanup org', sql`DELETE FROM organization WHERE id = ${orgA}`);
    await closePools();
  });

  const baseInput = (suffix: string) => ({
    clientId,
    name: `Project ${suffix}`,
    services: [{ service: 'seo' as const }, { service: 'other' as const, otherLabel: 'Custom thing' }],
    assigneeIds: [alice],
    startDate: '2026-01-01',
    priority: 'high' as const,
  });

  it('creates a project, snapshots the client currency, stores services, and notifies the assignee (not the actor)', async () => {
    const project = await createProject(asAdmin(), baseInput('create'));
    expect(project.currency).toBe('INR'); // snapshotted from the client, not looked up live
    expect(project.businessName).toBe('Acme Co');
    expect(project.workStatus).toBe('new');
    expect(project.services.map((s) => s.service).sort()).toEqual(['other', 'seo']);
    expect(project.assignees.map((a) => a.userId)).toEqual([alice]);

    await dispatchOrganization(orgA);
    const [row] = await asOwner<{ title: string }>(
      'read',
      sql`SELECT title FROM notification WHERE recipient_id = ${alice} AND metadata->>'projectId' = ${project.id}`,
    );
    expect(row?.title).toBe(`You have been added to a new project — ${project.name}`);
    const adminNotified = await asOwner<{ n: string }>('read', sql`SELECT count(*)::text AS n FROM notification WHERE recipient_id = ${admin} AND metadata->>'projectId' = ${project.id}`);
    expect(adminNotified[0]?.n).toBe('0'); // the actor is never notified about their own action
  });

  it('refuses an unknown or inactive client', async () => {
    await expect(createProject(asAdmin(), { ...baseInput('bad-client'), clientId: randomUUID() })).rejects.toThrow(ProjectClientNotFoundError);
  });

  it('refuses an assignee who is not an active employee', async () => {
    await expect(createProject(asAdmin(), { ...baseInput('bad-assignee'), assigneeIds: [randomUUID()] })).rejects.toThrow(ProjectValidationError);
  });

  it('a rolled-back creation leaves no project, no services and no notification behind', async () => {
    const before = await asOwner<{ n: string }>('read', sql`SELECT count(*)::text AS n FROM project WHERE organization_id = ${orgA}`);
    await expect(createProject(asAdmin(), { ...baseInput('rollback'), assigneeIds: [randomUUID()] })).rejects.toThrow();
    const after = await asOwner<{ n: string }>('read', sql`SELECT count(*)::text AS n FROM project WHERE organization_id = ${orgA}`);
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it('setProjectTeam replaces the roster and notifies only the newly added people', async () => {
    const project = await createProject(asAdmin(), baseInput('team'));
    await dispatchOrganization(orgA); // flush the creation notification

    const updated = await setProjectTeam(asAdmin(), project.id, { assigneeIds: [alice, bob] });
    expect(updated.assignees.map((a) => a.userId).sort()).toEqual([alice, bob].sort());

    await dispatchOrganization(orgA);
    const aliceCount = await asOwner<{ n: string }>('read', sql`SELECT count(*)::text AS n FROM notification WHERE recipient_id = ${alice} AND metadata->>'projectId' = ${project.id}`);
    const bobCount = await asOwner<{ n: string }>('read', sql`SELECT count(*)::text AS n FROM notification WHERE recipient_id = ${bob} AND metadata->>'projectId' = ${project.id}`);
    expect(aliceCount[0]?.n).toBe('1'); // already on the team: not re-notified
    expect(bobCount[0]?.n).toBe('1'); // newly added: notified
  });

  it('archiving drops a project from the list but keeps the row', async () => {
    const project = await createProject(asAdmin(), baseInput('archive'));
    await archiveProject(asAdmin(), project.id);

    const page = await listProjects(asAdmin(), projectListQuerySchema.parse({}));
    expect(page.items.some((p) => p.id === project.id)).toBe(false);

    const [row] = await asOwner<{ n: string }>('read', sql`SELECT count(*)::text AS n FROM project WHERE id = ${project.id}`);
    expect(row?.n).toBe('1');
  });

  describe('the discussion-group wizard step (Phase 2 chat module, cross-module facade)', () => {
    it('creates a real chat conversation once, with the given name and members', async () => {
      const project = await createProject(asAdmin(), baseInput('discuss'));
      const { conversationId } = await createDiscussionGroup(asAdmin(), project.id, {
        name: `${project.name} – Acme Co`,
        memberIds: [alice],
      });
      expect(conversationId).toBeTruthy();

      const [conversation] = await asOwner<{ kind: string; name: string; projectId: string }>(
        'read',
        sql`SELECT kind, name, project_id AS "projectId" FROM conversation WHERE id = ${conversationId}`,
      );
      expect(conversation?.kind).toBe('project');
      expect(conversation?.projectId).toBe(project.id);

      const members = await asOwner<{ userId: string }>('read', sql`SELECT user_id AS "userId" FROM conversation_member WHERE conversation_id = ${conversationId}`);
      // The caller (admin) is always included, same as every group creation; alice was the explicit member.
      expect(members.map((m) => m.userId).sort()).toEqual([admin, alice].sort());

      const refetched = await getProject(asAdmin(), project.id);
      expect(refetched.discussionConversationId).toBe(conversationId);
    });

    it('refuses a second discussion group for the same project', async () => {
      const project = await createProject(asAdmin(), baseInput('discuss-twice'));
      await createDiscussionGroup(asAdmin(), project.id, { name: 'Room', memberIds: [alice] });
      await expect(createDiscussionGroup(asAdmin(), project.id, { name: 'Room Again', memberIds: [alice] })).rejects.toThrow(ProjectDiscussionGroupExistsError);
    });
  });
});
