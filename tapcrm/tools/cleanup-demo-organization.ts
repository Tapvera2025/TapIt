#!/usr/bin/env tsx
import { loadDotEnv, organizationArgument, DEMO_EMAIL_DOMAIN, DEMO_EMAIL_PREFIX } from './demo-fixture.js';

loadDotEnv();
const organizationCode = organizationArgument(true);
const [{ platformDb }, { sql }] = await Promise.all([
  import('../packages/server/src/platform/dal/db.js'),
  import('../packages/server/src/platform/dal/sql.js'),
]);

const result = await platformDb.transaction('seed', `remove development demo fixture from ${organizationCode}`, async (tx) => {
  const organization = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM organization WHERE code = ${organizationCode} AND status = 'active'
  `);
  if (!organization) throw new Error(`Active organization "${organizationCode}" was not found`);
  await tx.query(sql`SELECT set_config('app.organization_id', ${organization.id}, true)`);
  const users = await tx.query<{ id: string }>(sql`
    SELECT id FROM app_user WHERE organization_id = ${organization.id} AND account_type = 'employee'
      AND email LIKE ${DEMO_EMAIL_PREFIX + '%' + '@' + DEMO_EMAIL_DOMAIN}
  `);
  const userIds = users.map((user) => user.id);
  const teams = await tx.query<{ id: string }>(sql`
    SELECT id FROM team WHERE organization_id = ${organization.id} AND seed_code LIKE 'demo-%'
  `);
  const teamIds = teams.map((team) => team.id);
  if (userIds.length === 0 && teamIds.length === 0) return { users: 0, teams: 0 };

  const externalReports = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM app_user WHERE organization_id = ${organization.id} AND id <> ALL(${userIds}::uuid[])
      AND reports_to = ANY(${userIds}::uuid[]) LIMIT 1
  `);
  if (externalReports) throw new Error('Cleanup refused: a non-demo employee reports to a demo employee');
  const externalTeamMember = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM app_user WHERE organization_id = ${organization.id} AND id <> ALL(${userIds}::uuid[])
      AND team_id = ANY(${teamIds}::uuid[]) LIMIT 1
  `);
  if (externalTeamMember) throw new Error('Cleanup refused: a non-demo employee belongs to a demo team');

  if (userIds.length > 0) {
    await tx.query(sql`DELETE FROM refresh_token WHERE organization_id = ${organization.id} AND session_id IN (SELECT id FROM session WHERE organization_id = ${organization.id} AND user_id = ANY(${userIds}::uuid[]))`);
    await tx.query(sql`DELETE FROM session WHERE organization_id = ${organization.id} AND user_id = ANY(${userIds}::uuid[])`);
    await tx.query(sql`DELETE FROM mfa_challenge WHERE organization_id = ${organization.id} AND user_id = ANY(${userIds}::uuid[])`);
    await tx.query(sql`DELETE FROM mfa_recovery_code WHERE organization_id = ${organization.id} AND user_id = ANY(${userIds}::uuid[])`);
    await tx.query(sql`DELETE FROM mfa_enrollment WHERE organization_id = ${organization.id} AND user_id = ANY(${userIds}::uuid[])`);
    await tx.query(sql`DELETE FROM password_reset_token WHERE organization_id = ${organization.id} AND user_id = ANY(${userIds}::uuid[])`);
    await tx.query(sql`DELETE FROM email_verification_token WHERE organization_id = ${organization.id} AND user_id = ANY(${userIds}::uuid[])`);
    await tx.query(sql`DELETE FROM geofence_assignment WHERE organization_id = ${organization.id} AND user_id = ANY(${userIds}::uuid[])`);
    await tx.query(sql`DELETE FROM geofence_event WHERE organization_id = ${organization.id} AND user_id = ANY(${userIds}::uuid[])`);
    await tx.query(sql`DELETE FROM geofence_bypass_request WHERE organization_id = ${organization.id} AND user_id = ANY(${userIds}::uuid[])`);
    await tx.query(sql`DELETE FROM work_from_home_day WHERE organization_id = ${organization.id} AND user_id = ANY(${userIds}::uuid[])`);
    await tx.query(sql`DELETE FROM user_override WHERE organization_id = ${organization.id} AND user_id = ANY(${userIds}::uuid[]) AND granted_by = ANY(${userIds}::uuid[])`);
    await tx.query(sql`UPDATE team SET lead_user_id = NULL WHERE organization_id = ${organization.id} AND lead_user_id = ANY(${userIds}::uuid[])`);
    await tx.query(sql`DELETE FROM identity_email_directory WHERE organization_id = ${organization.id} AND user_id = ANY(${userIds}::uuid[])`);
    await tx.query(sql`DELETE FROM app_user WHERE organization_id = ${organization.id} AND id = ANY(${userIds}::uuid[])`);
  }
  if (teamIds.length > 0) await tx.query(sql`DELETE FROM team WHERE organization_id = ${organization.id} AND id = ANY(${teamIds}::uuid[])`);
  return { users: userIds.length, teams: teamIds.length };
});

console.log(`✓ Removed ${result.users} demo employees and ${result.teams} demo teams from ${organizationCode}`);
