import { effectivePolicy, visibilityFilter } from '@tapcrm/authz';
import { globalAccess } from '@tapcrm/contracts';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { scopeResolver } from '../../../platform/authz-adapter.js';
import { findDepartment, findTeam, enqueueOrganizationAudit } from '../../organization/facade.js';
import { TerritoryConflictError, TerritoryNotFoundError, TerritoryValidationError, TERRITORY_ERROR_CODES } from './errors.js';
import { territoryPolicy } from './policy.js';
import { findTerritory, findTerritoryByName, findTerritoryTx, insertTerritory, listTerritories as listRows, listTerritoryCoverage, loadTerritoryResource as loadResource, replaceRules, updateTerritoryRow } from './repository.js';
import type { Territory, TerritoryReporting, TerritoryResource } from './types.js';
import type { CreateTerritoryInput, TerritoryReportingQuery, TerritoryReassignmentInput, TerritoryStatusInput, UpdateTerritoryInput } from './validators.js';
import type { RoutingConfigurationInput } from './validators.js';
import { findRoutingConfiguration, upsertRoutingConfiguration } from './routing-repository.js';
import type { RoutingConfiguration } from './routing-types.js';

async function validateSalesTeam(ctx: RequestContext, teamId: string) {
  return db.transaction(ctx, async (tx) => {
    const team = await findTeam(tx, ctx.organizationId, teamId);
    if (!team || team.kind !== 'sales-team' || team.status !== 'active') {
      throw new TerritoryValidationError(TERRITORY_ERROR_CODES.TEAM_INVALID, 'Territory must belong to an active Sales Team');
    }
    const department = await findDepartment(tx, ctx.organizationId, team.departmentId);
    if (!department || department.status !== 'active' || department.code !== 'sales') {
      throw new TerritoryValidationError(TERRITORY_ERROR_CODES.TEAM_INVALID, 'Sales Team must belong to the active Sales department');
    }
    return { team, department };
  });
}

async function assertScoped(ctx: RequestContext, resource: TerritoryResource): Promise<void> {
  if (globalAccess(ctx.principal)) return;
  const policy = await effectivePolicy(ctx, 'territories:manage');
  if (!policy?.allowed) throw new TerritoryValidationError(TERRITORY_ERROR_CODES.TEAM_INVALID, 'Territory is outside the permitted Sales scope');
  if (!await territoryPolicy.check({ ...ctx, scope: scopeResolver }, 'territories:manage', resource, policy.scope)) {
    throw new TerritoryValidationError(TERRITORY_ERROR_CODES.TEAM_INVALID, 'Territory is outside the permitted Sales scope');
  }
}

function auditInput(input: { name: string; description: string | null; salesTeamId: string; status: string; rules: unknown[] }) {
  return { name: input.name, description: input.description, salesTeamId: input.salesTeamId, status: input.status, rules: input.rules };
}

export async function listTerritories(ctx: RequestContext): Promise<Territory[]> {
  return listRows(ctx, await visibilityFilter(ctx, 'territories:view', 'territory'));
}

export async function getTerritoryCoverage(ctx: RequestContext) {
  const routing = await getRoutingConfiguration(ctx);
  return listTerritoryCoverage(ctx, await visibilityFilter(ctx, 'territories:view', 'territory'), routing);
}

export async function getTerritory(ctx: RequestContext, id: string): Promise<Territory> {
  const territory = await findTerritory(ctx, id);
  if (!territory) throw new TerritoryNotFoundError();
  return territory;
}

export async function createTerritory(ctx: RequestContext, input: CreateTerritoryInput): Promise<Territory> {
  const { team, department } = await validateSalesTeam(ctx, input.salesTeamId);
  const resource: TerritoryResource = { type: 'territory', id: 'new', organizationId: ctx.organizationId, salesTeamId: team.id, departmentId: department.id };
  await assertScoped(ctx, resource);
  return db.transaction(ctx, async (tx) => {
    if (await findTerritoryByName(tx, ctx.organizationId, input.name)) throw new TerritoryConflictError(`Territory name "${input.name}" already exists`);
    const id = await insertTerritory(tx, { organizationId: ctx.organizationId, name: input.name, description: input.description ?? null, salesTeamId: input.salesTeamId, status: input.status, actorId: ctx.principal.id });
    await replaceRules(tx, ctx.organizationId, id, input.rules);
    const created = await findTerritoryTx(tx, ctx.organizationId, id);
    if (!created) throw new TerritoryNotFoundError();
    await enqueueOrganizationAudit(tx, { organizationId: ctx.organizationId, actorId: ctx.principal.id, actorType: ctx.principal.accountType, requestId: ctx.requestId, sourceIp: ctx.sourceIp, action: 'territory.created', resourceType: 'territory', resourceId: id, before: null, after: auditInput(created) });
    return created;
  });
}

export async function updateTerritory(ctx: RequestContext, id: string, input: UpdateTerritoryInput): Promise<Territory> {
  const before = await getTerritory(ctx, id);
  await assertScoped(ctx, { type: 'territory', id, organizationId: before.organizationId, salesTeamId: before.salesTeamId, departmentId: before.departmentId });
  const teamId = before.salesTeamId;
  return db.transaction(ctx, async (tx) => {
    if (await findTerritoryByName(tx, ctx.organizationId, input.name ?? before.name, id)) throw new TerritoryConflictError(`Territory name "${input.name ?? before.name}" already exists`);
    await updateTerritoryRow(tx, { organizationId: ctx.organizationId, id, name: input.name ?? before.name, description: input.description === undefined ? before.description : input.description, salesTeamId: teamId, status: input.status ?? before.status, actorId: ctx.principal.id });
    if (input.rules !== undefined) await replaceRules(tx, ctx.organizationId, id, input.rules);
    const updated = await findTerritoryTx(tx, ctx.organizationId, id);
    if (!updated) throw new TerritoryNotFoundError();
    await enqueueOrganizationAudit(tx, { organizationId: ctx.organizationId, actorId: ctx.principal.id, actorType: ctx.principal.accountType, requestId: ctx.requestId, sourceIp: ctx.sourceIp, action: 'territory.updated', resourceType: 'territory', resourceId: id, before: auditInput(before), after: auditInput(updated) });
    return updated;
  });
}

export async function updateTerritoryStatus(ctx: RequestContext, id: string, input: TerritoryStatusInput): Promise<Territory> {
  const before = await getTerritory(ctx, id);
  await assertScoped(ctx, { type: 'territory', id, organizationId: before.organizationId, salesTeamId: before.salesTeamId, departmentId: before.departmentId });
  if (before.status === input.status) return before;
  return db.transaction(ctx, async (tx) => {
    await updateTerritoryRow(tx, { organizationId: ctx.organizationId, id, name: before.name, description: before.description, salesTeamId: before.salesTeamId, status: input.status, actorId: ctx.principal.id });
    const updated = await findTerritoryTx(tx, ctx.organizationId, id);
    if (!updated) throw new TerritoryNotFoundError();
    await enqueueOrganizationAudit(tx, { organizationId: ctx.organizationId, actorId: ctx.principal.id, actorType: ctx.principal.accountType, requestId: ctx.requestId, sourceIp: ctx.sourceIp, action: `territory.${input.status === 'active' ? 'activated' : 'deactivated'}`, resourceType: 'territory', resourceId: id, before: { status: before.status }, after: { status: updated.status } });
    return updated;
  });
}

export async function reassignTerritory(ctx: RequestContext, id: string, input: TerritoryReassignmentInput): Promise<Territory> {
  const before = await getTerritory(ctx, id);
  await assertScoped(ctx, { type: 'territory', id, organizationId: before.organizationId, salesTeamId: before.salesTeamId, departmentId: before.departmentId });
  const { team, department } = await validateSalesTeam(ctx, input.salesTeamId);
  await assertScoped(ctx, { type: 'territory', id, organizationId: ctx.organizationId, salesTeamId: team.id, departmentId: department.id });
  if (before.salesTeamId === team.id) return before;
  return db.transaction(ctx, async (tx) => {
    // Reassignment changes future routing only. Existing Leads belong to the
    // future Leads module and are intentionally never mutated here.
    await updateTerritoryRow(tx, { organizationId: ctx.organizationId, id, name: before.name, description: before.description, salesTeamId: team.id, status: before.status, actorId: ctx.principal.id });
    const updated = await findTerritoryTx(tx, ctx.organizationId, id);
    if (!updated) throw new TerritoryNotFoundError();
    await enqueueOrganizationAudit(tx, { organizationId: ctx.organizationId, actorId: ctx.principal.id, actorType: ctx.principal.accountType, requestId: ctx.requestId, sourceIp: ctx.sourceIp, action: 'territory.reassigned', resourceType: 'territory', resourceId: id, before: { territoryId: id, salesTeamId: before.salesTeamId, salesTeamName: before.salesTeamName }, after: { territoryId: id, salesTeamId: updated.salesTeamId, salesTeamName: updated.salesTeamName }, reason: 'Future inbound routing only; existing Leads are unchanged' });
    return updated;
  });
}

export async function getTerritoryReporting(ctx: RequestContext, query: TerritoryReportingQuery): Promise<TerritoryReporting> {
  const visible = await getTerritoryCoverage(ctx);
  const filtered = visible.filter((territory) =>
    (!query.territoryId || territory.territoryId === query.territoryId) &&
    (!query.salesTeamId || territory.salesTeamId === query.salesTeamId) &&
    (!query.salesPoolId || territory.salesPools.some((pool) => pool.id === query.salesPoolId)),
  );
  return {
    filters: { territoryId: query.territoryId ?? null, salesTeamId: query.salesTeamId ?? null, salesPoolId: query.salesPoolId ?? null, source: query.source ?? null, from: query.from ?? null, to: query.to ?? null },
    territories: filtered.map((territory) => ({ territoryId: territory.territoryId, territoryName: territory.territoryName, salesTeamId: territory.salesTeamId, salesTeamName: territory.salesTeamName, leadCount: null, conversionCount: null, conversionRate: null, revenue: null })),
    sources: [],
  };
}

export const loadTerritoryResource = loadResource;

export async function getRoutingConfiguration(ctx: RequestContext): Promise<RoutingConfiguration> {
  return (await findRoutingConfiguration(ctx)) ?? {
    enabled: true,
    assignmentStrategy: 'fewest_open_leads',
    updatedBy: ctx.principal.id,
    updatedAt: new Date(),
  };
}

export async function updateRoutingConfiguration(ctx: RequestContext, input: RoutingConfigurationInput): Promise<RoutingConfiguration> {
  const before = await getRoutingConfiguration(ctx);
  const updated = await db.transaction(ctx, async (tx) => {
    await upsertRoutingConfiguration(tx, ctx.organizationId, ctx.principal.id, input);
    const result = { enabled: input.enabled, assignmentStrategy: input.assignmentStrategy, updatedBy: ctx.principal.id, updatedAt: new Date() } satisfies RoutingConfiguration;
    await enqueueOrganizationAudit(tx, { organizationId: ctx.organizationId, actorId: ctx.principal.id, actorType: ctx.principal.accountType, requestId: ctx.requestId, sourceIp: ctx.sourceIp, action: 'territory.routing_configuration.updated', resourceType: 'territoryRoutingConfiguration', resourceId: null, before, after: result });
    return result;
  });
  return updated;
}
