import { z } from 'zod';
import { route } from '../../platform/http/route.js';
import {
  archiveProject,
  archiveDiscussionGroup,
  addDiscussionGroupMembers,
  createDiscussionGroup,
  createProject,
  getProject,
  listProjects,
  loadProjectResource,
  setProjectTeam,
  removeDiscussionGroupMember,
  updateDiscussionGroup,
  updateProject,
} from './service.js';
import {
  createDiscussionGroupSchema,
  discussionGroupMembersSchema,
  createProjectSchema,
  projectListQuerySchema,
  projectTeamSchema,
  updateDiscussionGroupSchema,
  updateProjectSchema,
} from './validators.js';

const idParam = z.object({ id: z.string().uuid() });

/**
 * Project HTTP routes. `projects:view`/`projects:manage`/`projects:view-financials`
 * already existed in AUTHORIZATION.md before this module did — only the
 * discussion-group step below is a new binding (still `projects:manage`, no
 * new action). See projects/policy.ts for how the matrix's scopes are
 * interpreted against the `project` table.
 */
export function registerProjectRoutes(): void {
  route({
    method: 'GET',
    path: '/api/projects',
    action: 'projects:view',
    module: 'projects',
    handler: async ({ ctx, query }) => listProjects(ctx, projectListQuerySchema.parse(query)),
  });

  route({
    method: 'GET',
    path: '/api/projects/:id',
    action: 'projects:view',
    module: 'projects',
    resourceParam: 'id',
    loadResource: loadProjectResource,
    handler: async ({ ctx, params }) => getProject(ctx, idParam.parse(params).id),
  });

  route({
    method: 'POST',
    path: '/api/projects',
    action: 'projects:manage',
    module: 'projects',
    status: 201,
    handler: async ({ ctx, body }) => createProject(ctx, createProjectSchema.parse(body)),
  });

  route({
    method: 'PATCH',
    path: '/api/projects/:id',
    action: 'projects:manage',
    module: 'projects',
    resourceParam: 'id',
    loadResource: loadProjectResource,
    handler: async ({ ctx, params, body }) => updateProject(ctx, idParam.parse(params).id, updateProjectSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/projects/:id/team',
    action: 'projects:manage',
    module: 'projects',
    resourceParam: 'id',
    loadResource: loadProjectResource,
    handler: async ({ ctx, params, body }) => setProjectTeam(ctx, idParam.parse(params).id, projectTeamSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/projects/:id/archive',
    action: 'projects:manage',
    module: 'projects',
    resourceParam: 'id',
    loadResource: loadProjectResource,
    handler: async ({ ctx, params }) => archiveProject(ctx, idParam.parse(params).id),
  });

  // The wizard's second step — see service.ts's createDiscussionGroup.
  route({
    method: 'POST',
    path: '/api/projects/:id/discussion-group',
    action: 'projects:manage',
    module: 'projects',
    resourceParam: 'id',
    loadResource: loadProjectResource,
    status: 201,
    handler: async ({ ctx, params, body }) => createDiscussionGroup(ctx, idParam.parse(params).id, createDiscussionGroupSchema.parse(body)),
  });

  // Renaming/describing a group that already exists — see service.ts's updateDiscussionGroup.
  route({
    method: 'PATCH',
    path: '/api/projects/:id/discussion-group',
    action: 'projects:manage',
    module: 'projects',
    resourceParam: 'id',
    loadResource: loadProjectResource,
    handler: async ({ ctx, params, body }) => updateDiscussionGroup(ctx, idParam.parse(params).id, updateDiscussionGroupSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/projects/:id/discussion-group/members',
    action: 'projects:manage',
    module: 'projects',
    resourceParam: 'id',
    loadResource: loadProjectResource,
    handler: async ({ ctx, params, body }) => addDiscussionGroupMembers(ctx, idParam.parse(params).id, discussionGroupMembersSchema.parse(body).memberIds),
  });

  route({
    method: 'DELETE',
    path: '/api/projects/:id/discussion-group/members/:userId',
    action: 'projects:manage',
    module: 'projects',
    resourceParam: 'id',
    loadResource: loadProjectResource,
    handler: async ({ ctx, params }) => {
      const parsed = z.object({ id: z.string().uuid(), userId: z.string().uuid() }).parse(params);
      return removeDiscussionGroupMember(ctx, parsed.id, parsed.userId);
    },
  });

  route({
    method: 'POST',
    path: '/api/projects/:id/discussion-group/archive',
    action: 'projects:manage',
    module: 'projects',
    resourceParam: 'id',
    loadResource: loadProjectResource,
    handler: async ({ ctx, params }) => archiveDiscussionGroup(ctx, idParam.parse(params).id),
  });
}
