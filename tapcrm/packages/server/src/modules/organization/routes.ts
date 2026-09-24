import { route } from '../../platform/http/route.js';
import {
  addTeamMember,
  createDepartment,
  createDesignation,
  createTeam,
  listDepartments,
  listDesignations,
  loadDesignationResource,
  updateDesignationById,
  listTeams,
  updateDepartment,
  updateTeam,
  loadDepartmentResource,
  loadTeamResource,
} from './controller.js';
import {
  createPosition,
  previewCreatePosition,
  getPositionHolders,
  getPositionLadder,
  getPositionPolicies,
  loadPositionResource,
  previewPositionPolicies,
  updatePositionPolicies,
  updatePositionById,
} from './positions/service.js';
import { getOrganizationChart } from './chart/service.js';
import {
  confirmManagerReassignmentSubtree,
  previewManagerReassignment,
  previewManagerReassignmentSubtree,
  reassignManager,
} from './reporting/service.js';
import { loadReportingUserResource } from './reporting/repository.js';
import {
  addTeamMemberSchema,
  createDepartmentSchema,
  createDesignationSchema,
  updateDesignationSchema,
  createTeamSchema,
  createPositionSchema,
  updateDepartmentSchema,
  updateTeamSchema,
  updatePositionSchema,
  updatePositionPoliciesSchema,
  confirmManagerReassignmentSchema,
  managerReassignmentSchema,
} from './validators.js';

/** Organization route bindings. Authorization is performed by the shared router. */
export function registerOrganizationRoutes(): void {
  route({
    method: 'POST',
    path: '/api/users/:id/manager-reassignment',
    action: 'users:manage',
    module: 'employee-directory',
    resourceParam: 'id',
    loadResource: loadReportingUserResource,
    handler: async ({ ctx, params, body }) =>
      reassignManager(ctx, params['id']!, managerReassignmentSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/users/:id/manager-reassignment/preview',
    action: 'users:manage',
    module: 'employee-directory',
    resourceParam: 'id',
    loadResource: loadReportingUserResource,
    handler: async ({ ctx, params, body }) => {
      const input = managerReassignmentSchema.parse(body);
      return input.operation === 'individual'
        ? previewManagerReassignment(ctx, params['id']!, input)
        : previewManagerReassignmentSubtree(ctx, params['id']!, input);
    },
  });
  route({
    method: 'POST',
    path: '/api/users/:id/manager-reassignment/confirm',
    action: 'users:manage',
    module: 'employee-directory',
    resourceParam: 'id',
    loadResource: loadReportingUserResource,
    handler: async ({ ctx, params, body }) =>
      confirmManagerReassignmentSubtree(
        ctx,
        params['id']!,
        confirmManagerReassignmentSchema.parse(body),
      ),
  });

  route({
    method: 'GET',
    path: '/api/org/departments',
    action: 'org:view-structure',
    module: 'organization',
    handler: async ({ ctx }) => listDepartments(ctx),
  });
  route({
    method: 'POST',
    path: '/api/org/departments',
    action: 'org:manage-departments',
    module: 'organization',
    status: 201,
    handler: async ({ ctx, body }) =>
      createDepartment(ctx, createDepartmentSchema.parse(body)),
  });
  route({
    method: 'PATCH',
    path: '/api/org/departments/:id',
    action: 'org:manage-departments',
    module: 'organization',
    resourceParam: 'id',
    loadResource: loadDepartmentResource,
    handler: async ({ ctx, params, body }) =>
      updateDepartment(ctx, params['id']!, updateDepartmentSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/org/teams',
    action: 'org:view-structure',
    module: 'organization',
    handler: async ({ ctx }) => listTeams(ctx),
  });
  route({
    method: 'GET',
    path: '/api/org/chart',
    action: 'org:view-structure',
    module: 'organization',
    handler: async ({ ctx }) => getOrganizationChart(ctx),
  });
  route({
    method: 'POST',
    path: '/api/org/teams',
    action: 'org:manage-teams',
    module: 'organization',
    status: 201,
    handler: async ({ ctx, body }) => createTeam(ctx, createTeamSchema.parse(body)),
  });
  route({
    method: 'PATCH',
    path: '/api/org/teams/:id',
    action: 'org:manage-teams',
    module: 'organization',
    resourceParam: 'id',
    loadResource: loadTeamResource,
    handler: async ({ ctx, params, body }) =>
      updateTeam(ctx, params['id']!, updateTeamSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/org/teams/:id/members',
    action: 'org:manage-teams',
    module: 'organization',
    resourceParam: 'id',
    loadResource: loadTeamResource,
    handler: async ({ ctx, params, body }) =>
      addTeamMember(ctx, params['id']!, addTeamMemberSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/org/designations',
    action: 'org:view-designations',
    module: 'organization',
    handler: async ({ ctx }) => listDesignations(ctx),
  });
  route({
    method: 'POST',
    path: '/api/org/designations',
    action: 'org:manage-designations',
    module: 'organization',
    status: 201,
    handler: async ({ ctx, body }) =>
      createDesignation(ctx, createDesignationSchema.parse(body)),
  });
  route({
    method: 'PATCH',
    path: '/api/org/designations/:id',
    action: 'org:manage-designations',
    module: 'organization',
    resourceParam: 'id',
    loadResource: loadDesignationResource,
    handler: async ({ ctx, params, body }) =>
      updateDesignationById(ctx, params['id']!, updateDesignationSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/org/ladder/:departmentCode',
    action: 'org:view-structure',
    module: 'organization',
    handler: async ({ ctx, params }) => getPositionLadder(ctx, params['departmentCode']!),
  });
  route({
    method: 'GET',
    path: '/api/org/positions/:id/holders',
    action: 'org:view-people',
    module: 'organization',
    resourceParam: 'id',
    loadResource: loadPositionResource,
    handler: async ({ ctx, params }) => getPositionHolders(ctx, params['id']!),
  });
  route({
    method: 'GET',
    path: '/api/org/positions/:id/policies',
    action: 'org:view-policies',
    module: 'organization',
    resourceParam: 'id',
    loadResource: loadPositionResource,
    handler: async ({ ctx, params }) => getPositionPolicies(ctx, params['id']!),
  });
  route({
    method: 'POST',
    path: '/api/org/positions',
    action: 'org:manage-positions',
    module: 'organization',
    status: 201,
    handler: async ({ ctx, body }) =>
      createPosition(ctx, createPositionSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/org/positions/preview',
    action: 'org:manage-positions',
    module: 'organization',
    handler: async ({ ctx, body }) =>
      previewCreatePosition(ctx, createPositionSchema.parse(body)),
  });
  route({
    method: 'PATCH',
    path: '/api/org/positions/:id',
    action: 'org:manage-positions',
    module: 'organization',
    resourceParam: 'id',
    loadResource: loadPositionResource,
    handler: async ({ ctx, params, body }) =>
      updatePositionById(ctx, params['id']!, updatePositionSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/org/positions/:id/policies/preview',
    action: 'org:manage-positions',
    module: 'organization',
    resourceParam: 'id',
    loadResource: loadPositionResource,
    handler: async ({ ctx, params, body }) =>
      previewPositionPolicies(
        ctx,
        params['id']!,
        updatePositionPoliciesSchema.parse(body),
      ),
  });
  route({
    method: 'PUT',
    path: '/api/org/positions/:id/policies',
    action: 'org:manage-positions',
    module: 'organization',
    resourceParam: 'id',
    loadResource: loadPositionResource,
    handler: async ({ ctx, params, body }) =>
      updatePositionPolicies(
        ctx,
        params['id']!,
        updatePositionPoliciesSchema.parse(body),
      ),
  });
}
