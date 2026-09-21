import type { Tx } from '../dal/db.js';
import { sql } from '../dal/sql.js';
import { templateForModules, type OrganizationTemplate } from './template.js';
import { provisionDefaultPositionPolicies } from './policy-matrix.js';

export async function bootstrapOrganization(
  tx: Tx,
  organizationId: string,
  moduleKeys: readonly string[],
  options: { includeAll?: boolean } = {},
): Promise<void> {
  const template = templateForModules(moduleKeys, options.includeAll === true);
  const departmentIds = new Map<string, string>();
  const createdTeamIds = new Set<string>();
  const createdPositionIds = new Set<string>();

  for (const definition of template.departments) {
    const existing = await tx.maybeOne<{ id: string; isSeeded: boolean }>(sql`
      SELECT id, is_seeded FROM department
      WHERE organization_id = ${organizationId} AND code = ${definition.code}
    `);
    if (existing && !existing.isSeeded) {
      throw new Error(
        `Cannot bootstrap department "${definition.code}" because a custom department already uses that code`,
      );
    }
    const row = existing
      ? existing
      : await tx.one<{ id: string }>(sql`
          INSERT INTO department (organization_id, code, name, kind, status, is_seeded)
          VALUES (${organizationId}, ${definition.code}, ${definition.name}, ${definition.kind}, ${definition.status}, true)
          RETURNING id
        `);
    departmentIds.set(definition.code, row.id);
  }

  const teamIds = new Map<string, string>();
  for (const definition of template.teams) {
    const departmentId = departmentIds.get(definition.department);
    if (!departmentId) continue;
    const existing = await tx.maybeOne<{ id: string; isSeeded: boolean }>(sql`
      SELECT id, is_seeded FROM team
      WHERE organization_id = ${organizationId} AND department_id = ${departmentId}
        AND kind = ${definition.kind}
        AND (seed_code = ${definition.code} OR (seed_code IS NULL AND lower(name) = lower(${definition.name})))
    `);
    if (existing && !existing.isSeeded) {
      throw new Error(
        `Cannot bootstrap team "${definition.name}" because a custom team already uses that name`,
      );
    }
    const row = existing
      ? existing
      : await tx.one<{ id: string }>(sql`
          INSERT INTO team (
            organization_id, department_id, kind, name, lead_user_id,
            parent_team_id, shared_visibility, is_seeded, seed_code
          )
          VALUES (
            ${organizationId}, ${departmentId}, ${definition.kind}, ${definition.name},
            NULL, NULL, ${definition.sharedVisibility}, true, ${definition.code}
          )
          RETURNING id
        `);
    if (!existing) createdTeamIds.add(row.id);
    teamIds.set(definition.code, row.id);
  }
  for (const definition of template.teams) {
    const teamId = teamIds.get(definition.code);
    const parentId = definition.parent === null ? null : teamIds.get(definition.parent);
    if (!teamId || (definition.parent !== null && !parentId)) continue;
    if (createdTeamIds.has(teamId))
      await tx.query(sql`
        UPDATE team SET parent_team_id = ${parentId ?? null}
        WHERE organization_id = ${organizationId} AND id = ${teamId}
      `);
  }

  const positionIds = new Map<string, string>();
  for (const definition of template.positions) {
    const departmentId = departmentIds.get(definition.department);
    if (!departmentId) continue;
    const existing = await tx.maybeOne<{ id: string; isSeeded: boolean }>(sql`
      SELECT id, is_seeded FROM position
      WHERE organization_id = ${organizationId} AND code = ${definition.code}
    `);
    if (existing && !existing.isSeeded) {
      throw new Error(
        `Cannot bootstrap position "${definition.code}" because a custom position already uses that code`,
      );
    }
    const row = existing
      ? existing
      : await tx.one<{ id: string }>(sql`
          INSERT INTO position (
            organization_id, department_id, code, name, organizational_level,
            parent_position_id, is_seeded, status
          )
          VALUES (${organizationId}, ${departmentId}, ${definition.code}, ${definition.name}, ${definition.level}, NULL, true, ${definition.status})
          RETURNING id
        `);
    if (!existing) createdPositionIds.add(row.id);
    positionIds.set(definition.code, row.id);
  }
  for (const definition of template.positions) {
    const positionId = positionIds.get(definition.code);
    const parentId =
      definition.parent === null ? null : positionIds.get(definition.parent);
    if (!positionId || (definition.parent !== null && !parentId)) continue;
    if (createdPositionIds.has(positionId))
      await tx.query(sql`
        UPDATE position SET parent_position_id = ${parentId ?? null}
        WHERE organization_id = ${organizationId} AND id = ${positionId}
      `);
  }

  for (const definition of template.designations) {
    const departmentId = departmentIds.get(definition.department);
    if (!departmentId) continue;
    const existing = await tx.maybeOne<{ id: string; isSeeded: boolean }>(sql`
      SELECT id, is_seeded FROM designation
      WHERE organization_id = ${organizationId}
        AND (seed_code = ${definition.code} OR (seed_code IS NULL AND lower(name) = lower(${definition.name})))
    `);
    if (existing && !existing.isSeeded) {
      throw new Error(
        `Cannot bootstrap designation "${definition.name}" because a custom designation already uses that name`,
      );
    }
    if (!existing) {
      await tx.query(sql`
        INSERT INTO designation (organization_id, department_id, name, specializations, status, is_seeded, seed_code)
        VALUES (${organizationId}, ${departmentId}, ${definition.name}, ${[...definition.specializations]}, 'active', true, ${definition.code})
      `);
    }
  }

  await provisionDefaultPositionPolicies(
    tx,
    organizationId,
    moduleKeys,
    template.positions,
    positionIds,
  );
}

export function starterTemplateForModules(
  moduleKeys: readonly string[],
): OrganizationTemplate {
  return templateForModules(moduleKeys);
}
