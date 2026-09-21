import { MATCH_ALL, effectivePolicy, visibilityFilter } from '@tapcrm/authz';
import { globalAccess } from '@tapcrm/contracts';
import { TEAM_LEAD_POSITION_CODES } from '../../../platform/organizations/template.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { enqueueOrganizationAudit } from '../repository.js';
import { findDepartment } from '../departments/repository.js';
import {
  OrganizationConflictError,
  OrganizationNotFoundError,
  OrganizationValidationError,
  ORGANIZATION_ERROR_CODES,
} from '../errors.js';
import type {
  AddTeamMemberInput,
  CreateTeamInput,
  UpdateTeamInput,
} from '../validators.js';
import {
  assignUserToTeam,
  countActiveTeamMembers,
  countChildTeams,
  findTeam,
  findTeamByName,
  findUser,
  insertTeam,
  listTeams as listRows,
  loadTeamResource,
  updateTeam as updateRow,
  type TeamRecord,
} from './repository.js';

export async function listTeams(ctx: RequestContext): Promise<TeamRecord[]> {
  const [structurePolicy, peoplePolicy] = await Promise.all([
    effectivePolicy(ctx, 'org:view-structure'),
    effectivePolicy(ctx, 'org:view-people'),
  ]);
  const filter =
    structurePolicy?.allowed === true && structurePolicy.scope === 'department'
      ? MATCH_ALL
      : await visibilityFilter(ctx, 'org:view-structure', 'team');
  const teams = await listRows(ctx, filter);
  const ownDepartmentId =
    ctx.principal.accountType === 'employee' ? ctx.principal.departmentId : null;
  const canSeeAllLeads =
    globalAccess(ctx.principal) || peoplePolicy?.scope === 'all-people';
  const canSeeOwnDepartmentLeads = peoplePolicy?.scope === 'department';

  // A team lead is an employee identity, not structural metadata. Preserve it
  // only where the caller also has people visibility.
  return teams.map((team) => ({
    ...team,
    leadUserId:
      canSeeAllLeads ||
      (canSeeOwnDepartmentLeads && team.departmentId === ownDepartmentId)
        ? team.leadUserId
        : null,
  }));
}

async function validateTeam(
  tx: Tx,
  ctx: RequestContext,
  input: {
    departmentId: string;
    kind: string;
    leadUserId: string | null;
    parentTeamId: string | null;
  },
  currentId?: string,
): Promise<void> {
  const department = await findDepartment(tx, ctx.organizationId, input.departmentId);
  if (!department || department.status !== 'active')
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.TEAM_DEPARTMENT_INVALID,
      'Team department is invalid or inactive',
    );
  if (
    (input.kind === 'sales-team' || input.kind === 'dev-subteam') &&
    input.parentTeamId !== null
  )
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.TEAM_PARENT_INVALID,
      'This team kind cannot have a parent team',
    );
  if (input.kind === 'sales-pool' && input.parentTeamId === null)
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.TEAM_PARENT_INVALID,
      'A sales-pool must belong to a sales-team',
    );
  if (input.parentTeamId !== null) {
    if (input.parentTeamId === currentId)
      throw new OrganizationValidationError(
        ORGANIZATION_ERROR_CODES.TEAM_PARENT_INVALID,
        'A team cannot be its own parent',
      );
    const parent = await findTeam(tx, ctx.organizationId, input.parentTeamId);
    if (!parent || parent.departmentId !== input.departmentId)
      throw new OrganizationValidationError(
        ORGANIZATION_ERROR_CODES.TEAM_PARENT_INVALID,
        'Parent team must belong to the same department',
      );
    if (input.kind === 'sales-pool' && parent.kind !== 'sales-team')
      throw new OrganizationValidationError(
        ORGANIZATION_ERROR_CODES.TEAM_PARENT_INVALID,
        'A sales-pool parent must be a sales-team in the same department',
      );

    // The database protects tenant ownership and self-parenting, while this
    // traversal protects the full graph from indirect cycles.
    const seen = new Set<string>([currentId ?? '']);
    let ancestorId: string | null = input.parentTeamId;
    while (ancestorId !== null) {
      if (seen.has(ancestorId))
        throw new OrganizationValidationError(
          ORGANIZATION_ERROR_CODES.TEAM_PARENT_INVALID,
          'Team hierarchy cannot contain a cycle',
        );
      seen.add(ancestorId);
      const ancestor = await findTeam(tx, ctx.organizationId, ancestorId);
      ancestorId = ancestor?.parentTeamId ?? null;
    }
  }
  if (input.leadUserId !== null) {
    const lead = await findUser(tx, ctx.organizationId, input.leadUserId);
    if (
      !lead ||
      lead.status !== 'active' ||
      lead.accountType !== 'employee' ||
      lead.departmentId !== input.departmentId ||
      !isEligibleTeamLeadPosition(input.kind, lead.positionCode, lead.positionStatus)
    )
      throw new OrganizationValidationError(
        ORGANIZATION_ERROR_CODES.TEAM_LEAD_INVALID,
        'Team lead must have an active position appropriate for this team kind',
      );
  }
}

export function isEligibleTeamLeadPosition(
  teamKind: string,
  positionCode: string | null,
  positionStatus: string | null = 'active',
): boolean {
  const eligibleCodes: readonly string[] =
    TEAM_LEAD_POSITION_CODES[teamKind as keyof typeof TEAM_LEAD_POSITION_CODES] ?? [];
  return (
    positionStatus === 'active' &&
    typeof positionCode === 'string' &&
    eligibleCodes.includes(positionCode)
  );
}

export function assertTeamDepartmentChangeAllowed(input: {
  activeMemberCount: number;
  childTeamCount: number;
}): void {
  if (input.activeMemberCount > 0) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.TEAM_DEPARTMENT_HAS_ACTIVE_MEMBERS,
      'A team with active members cannot be moved to another department',
      { activeMemberCount: input.activeMemberCount },
    );
  }
  if (input.childTeamCount > 0) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.TEAM_PARENT_INVALID,
      'A team with child teams cannot be moved to another department',
      { childTeamCount: input.childTeamCount },
    );
  }
}

export function assertTeamMemberDepartmentConsistency(
  userDepartmentId: string | null,
  teamDepartmentId: string,
): void {
  if (userDepartmentId !== teamDepartmentId) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.TEAM_MEMBER_INVALID,
      'Team member and team must belong to the same department',
    );
  }
}

export async function createTeam(
  ctx: RequestContext,
  input: CreateTeamInput,
): Promise<TeamRecord> {
  return db.transaction(ctx, async (tx) => {
    if (await findTeamByName(tx, ctx.organizationId, input.departmentId, input.name))
      throw new OrganizationConflictError(
        ORGANIZATION_ERROR_CODES.TEAM_NAME_EXISTS,
        `Team name "${input.name}" already exists in this department`,
      );
    await validateTeam(tx, ctx, { ...input, parentTeamId: input.parentTeamId ?? null });
    const team = await insertTeam(tx, {
      organizationId: ctx.organizationId,
      ...input,
      leadUserId: input.leadUserId ?? null,
      parentTeamId: input.parentTeamId ?? null,
    });
    await enqueueOrganizationAudit(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
      action: 'organization.team.created',
      resourceType: 'team',
      resourceId: team.id,
      before: null,
      after: team,
    });
    return team;
  });
}

export async function updateTeam(
  ctx: RequestContext,
  id: string,
  input: UpdateTeamInput,
): Promise<TeamRecord> {
  return db.transaction(ctx, async (tx) => {
    const before = await findTeam(tx, ctx.organizationId, id);
    if (!before)
      throw new OrganizationNotFoundError(
        ORGANIZATION_ERROR_CODES.TEAM_NOT_FOUND,
        'Team not found',
      );
    const next = {
      departmentId: input.departmentId ?? before.departmentId,
      kind: input.kind ?? before.kind,
      name: input.name ?? before.name,
      leadUserId: input.leadUserId === undefined ? before.leadUserId : input.leadUserId,
      parentTeamId:
        input.parentTeamId === undefined ? before.parentTeamId : input.parentTeamId,
      sharedVisibility: input.sharedVisibility ?? before.sharedVisibility,
    };
    if (await findTeamByName(tx, ctx.organizationId, next.departmentId, next.name, id))
      throw new OrganizationConflictError(
        ORGANIZATION_ERROR_CODES.TEAM_NAME_EXISTS,
        `Team name "${next.name}" already exists in this department`,
      );
    if (next.departmentId !== before.departmentId) {
      const [activeMemberCount, childTeamCount] = await Promise.all([
        countActiveTeamMembers(tx, ctx.organizationId, id),
        countChildTeams(tx, ctx.organizationId, id),
      ]);
      assertTeamDepartmentChangeAllowed({ activeMemberCount, childTeamCount });
    }
    await validateTeam(tx, ctx, next, id);
    const after = await updateRow(tx, {
      organizationId: ctx.organizationId,
      id,
      ...next,
    });
    await enqueueOrganizationAudit(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
      action: 'organization.team.updated',
      resourceType: 'team',
      resourceId: id,
      before,
      after,
    });
    return after;
  });
}

export async function addTeamMember(
  ctx: RequestContext,
  teamId: string,
  input: AddTeamMemberInput,
): Promise<{ id: string; teamId: string | null }> {
  return db.transaction(ctx, async (tx) => {
    const team = await findTeam(tx, ctx.organizationId, teamId);
    if (!team)
      throw new OrganizationNotFoundError(
        ORGANIZATION_ERROR_CODES.TEAM_NOT_FOUND,
        'Team not found',
      );
    const user = await findUser(tx, ctx.organizationId, input.userId);
    if (!user || user.accountType !== 'employee' || user.status !== 'active')
      throw new OrganizationValidationError(
        ORGANIZATION_ERROR_CODES.TEAM_MEMBER_INVALID,
        'Team member must be an active employee in the same department',
      );
    assertTeamMemberDepartmentConsistency(user.departmentId, team.departmentId);
    const after = await assignUserToTeam(tx, ctx.organizationId, input.userId, teamId);
    await enqueueOrganizationAudit(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
      action: 'organization.team.member-assigned',
      resourceType: 'team',
      resourceId: teamId,
      before: { userId: input.userId, teamId: user.teamId },
      after: { userId: input.userId, teamId },
    });
    return after;
  });
}

export { loadTeamResource };
