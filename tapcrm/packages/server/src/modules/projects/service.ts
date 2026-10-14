import { visibilityFilter, type Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { getClientSummary } from '../clients/facade.js';
import { addProjectConversationMembers, archiveProjectConversation, createProjectConversation, removeProjectConversationMember, renameProjectConversation } from '../chat/facade.js';
import { ProjectClientNotFoundError, ProjectDiscussionGroupExistsError, ProjectNotFoundError, ProjectValidationError } from './errors.js';
import { notifyProjectAssigned } from './notifications.js';
import {
  archiveProjectRow,
  findProjectAssigneeIds,
  findProjectById,
  findProjectClientId,
  insertProject,
  insertProjectServices,
  listProjects as repoListProjects,
  replaceProjectAssignees,
  replaceProjectServices,
  updateProjectRow,
  validateAssigneeIds,
} from './repository.js';
import type { PaginatedProjects, Project, ProjectListQuery } from './types.js';
import type { CreateDiscussionGroupInput, CreateProjectInput, ProjectTeamInput, UpdateProjectInput } from './validators.js';

export async function loadProjectResource(ctx: RequestContext, id: string): Promise<Resource | null> {
  const project = await findProjectById(ctx, id);
  if (!project) return null;
  const assigneeIds = await findProjectAssigneeIds(ctx, id);
  return { type: 'project', id: project.id, organizationId: project.organizationId, createdBy: project.createdBy, assigneeIds };
}

export async function listProjects(ctx: RequestContext, query: ProjectListQuery): Promise<PaginatedProjects> {
  const filter = await visibilityFilter(ctx, 'projects:view', 'project');
  return repoListProjects(ctx, filter, query);
}

export async function getProject(ctx: RequestContext, id: string): Promise<Project> {
  const project = await findProjectById(ctx, id);
  if (!project) throw new ProjectNotFoundError();
  return project;
}

/**
 * Creates the project, its services and its initial team, and notifies each
 * assignee — all in one transaction (TX-2): a rolled-back creation leaves
 * neither a half-made project nor a stray notification. The discussion
 * group is deliberately NOT created here — that is the wizard's separate
 * second step (`createDiscussionGroup` below), by product decision.
 */
export async function createProject(ctx: RequestContext, input: CreateProjectInput): Promise<Project> {
  const { id } = await db.transaction(ctx, async (tx) => {
    const client = await getClientSummary(tx, ctx.organizationId, input.clientId);
    if (!client) throw new ProjectClientNotFoundError();
    if (client.status !== 'active') throw new ProjectValidationError('This client is inactive', { clientId: input.clientId });

    const assigneeIds = await validateAssigneeIds(tx, ctx.organizationId, input.assigneeIds);
    if (assigneeIds.length !== input.assigneeIds.length) {
      const missing = input.assigneeIds.filter((assigneeId) => !assigneeIds.includes(assigneeId));
      throw new ProjectValidationError('One or more assignees are not active employees of this organization', { missingUserIds: missing });
    }

    const project = await insertProject(tx, ctx.organizationId, ctx.principal.id, {
      clientId: input.clientId,
      name: input.name,
      priority: input.priority,
      workStatus: input.workStatus ?? 'new',
      startDate: input.startDate,
      expectedEndDate: input.expectedEndDate ?? null,
      budget: input.budget ?? null,
      currency: client.currency,
      description: input.description ?? null,
      remarks: input.remarks ?? null,
    });
    await insertProjectServices(tx, ctx.organizationId, project.id, input.services);
    if (assigneeIds.length > 0) await replaceProjectAssignees(tx, ctx.organizationId, project.id, assigneeIds, ctx.principal.id);

    await notifyProjectAssigned(tx, ctx, { id: project.id, name: input.name }, assigneeIds);
    return project;
  });

  const created = await findProjectById(ctx, id);
  if (!created) throw new ProjectNotFoundError();
  return created;
}

export async function updateProject(ctx: RequestContext, id: string, input: UpdateProjectInput): Promise<Project> {
  const existing = await findProjectById(ctx, id);
  if (!existing) throw new ProjectNotFoundError();

  await db.transaction(ctx, async (tx) => {
    await updateProjectRow(tx, ctx.organizationId, id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.workStatus !== undefined ? { workStatus: input.workStatus } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.expectedEndDate !== undefined ? { expectedEndDate: input.expectedEndDate } : {}),
      ...(input.budget !== undefined ? { budget: input.budget } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
    });
    if (input.services !== undefined) await replaceProjectServices(tx, ctx.organizationId, id, input.services);
  });

  const updated = await findProjectById(ctx, id);
  if (!updated) throw new ProjectNotFoundError();
  return updated;
}

/** `POST /api/projects/:id/team` — replaces the assignee set; only the DIFFERENCE (newly added people) is notified. */
export async function setProjectTeam(ctx: RequestContext, id: string, input: ProjectTeamInput): Promise<Project> {
  const existing = await findProjectById(ctx, id);
  if (!existing) throw new ProjectNotFoundError();
  const before = new Set(existing.assignees.map((a) => a.userId));

  await db.transaction(ctx, async (tx) => {
    const assigneeIds = await validateAssigneeIds(tx, ctx.organizationId, input.assigneeIds);
    if (assigneeIds.length !== input.assigneeIds.length) {
      const missing = input.assigneeIds.filter((assigneeId) => !assigneeIds.includes(assigneeId));
      throw new ProjectValidationError('One or more assignees are not active employees of this organization', { missingUserIds: missing });
    }
    await replaceProjectAssignees(tx, ctx.organizationId, id, assigneeIds, ctx.principal.id);
    const newlyAdded = assigneeIds.filter((assigneeId) => !before.has(assigneeId));
    await notifyProjectAssigned(tx, ctx, { id, name: existing.name }, newlyAdded);
    // Give new team members the discussion group too; never remove anyone as
    // a side effect of a team edit (see chat/facade.ts's addProjectConversationMembers).
    if (existing.discussionConversationId && newlyAdded.length > 0) {
      await addProjectConversationMembers(tx, ctx, existing.discussionConversationId, newlyAdded, existing.name);
    }
  });

  const updated = await findProjectById(ctx, id);
  if (!updated) throw new ProjectNotFoundError();
  return updated;
}

export async function archiveProject(ctx: RequestContext, id: string): Promise<{ archived: true }> {
  const existing = await findProjectById(ctx, id);
  if (!existing) throw new ProjectNotFoundError();
  await db.transaction(ctx, (tx) => archiveProjectRow(tx, ctx.organizationId, id));
  return { archived: true };
}

/**
 * The wizard's SECOND step (product decision — not automatic on project
 * creation): a suggested name and the project's current team + client are
 * preselected by the caller (client UI), but the actual member list and name
 * are whatever this call is given, so the admin's edits on that screen are
 * respected.
 */
export async function createDiscussionGroup(ctx: RequestContext, projectId: string, input: CreateDiscussionGroupInput): Promise<{ conversationId: string }> {
  const existing = await findProjectById(ctx, projectId);
  if (!existing) throw new ProjectNotFoundError();
  if (existing.discussionConversationId) throw new ProjectDiscussionGroupExistsError();

  const clientId = await findProjectClientId(ctx, projectId);
  if (!clientId) throw new ProjectClientNotFoundError();

  const { id } = await db.transaction(ctx, (tx) =>
    createProjectConversation(tx, ctx, { name: input.name, memberIds: input.memberIds, projectId }),
  );
  return { conversationId: id };
}

/** Renaming/describing an existing discussion group — `projects:manage` on this project, not `chat:manage-groups`. */
export async function updateDiscussionGroup(
  ctx: RequestContext,
  projectId: string,
  input: { name: string; description?: string | null | undefined },
): Promise<{ conversationId: string }> {
  const existing = await findProjectById(ctx, projectId);
  if (!existing) throw new ProjectNotFoundError();
  if (!existing.discussionConversationId) throw new ProjectValidationError('This project has no discussion group yet');

  const conversationId = existing.discussionConversationId;
  await db.transaction(ctx, (tx) => renameProjectConversation(tx, ctx.organizationId, conversationId, input.name, input.description));
  return { conversationId };
}

async function discussionGroupForProject(ctx: RequestContext, projectId: string): Promise<{ id: string; name: string }> {
  const project = await findProjectById(ctx, projectId);
  if (!project) throw new ProjectNotFoundError();
  if (!project.discussionConversationId) throw new ProjectValidationError('This project has no discussion group yet');
  return { id: project.discussionConversationId, name: project.name };
}

export async function addDiscussionGroupMembers(ctx: RequestContext, projectId: string, memberIds: string[]): Promise<{ conversationId: string }> {
  const group = await discussionGroupForProject(ctx, projectId);
  await db.transaction(ctx, (tx) => addProjectConversationMembers(tx, ctx, group.id, memberIds, group.name));
  return { conversationId: group.id };
}

export async function removeDiscussionGroupMember(ctx: RequestContext, projectId: string, userId: string): Promise<{ conversationId: string }> {
  const group = await discussionGroupForProject(ctx, projectId);
  await db.transaction(ctx, (tx) => removeProjectConversationMember(tx, ctx, group.id, userId, group.name));
  return { conversationId: group.id };
}

export async function archiveDiscussionGroup(ctx: RequestContext, projectId: string): Promise<{ archived: true }> {
  const group = await discussionGroupForProject(ctx, projectId);
  await db.transaction(ctx, (tx) => archiveProjectConversation(tx, ctx.organizationId, group.id));
  return { archived: true };
}
