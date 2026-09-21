import type { RequestContext } from '../../platform/dal/context.js';
import {
  createDepartment,
  listDepartments,
  loadDepartmentResource,
  updateDepartment,
} from './departments/service.js';
import {
  addTeamMember,
  createTeam,
  listTeams,
  loadTeamResource,
  updateTeam,
} from './teams/service.js';
import {
  createDesignation,
  listDesignations,
  loadDesignationResource,
  updateDesignationById,
} from './designations/service.js';
import type {
  AddTeamMemberInput,
  CreateDepartmentInput,
  CreateDesignationInput,
  CreateTeamInput,
  UpdateDepartmentInput,
  UpdateTeamInput,
  UpdateDesignationInput,
} from './validators.js';

/** Thin route-facing facade; domain rules remain in the domain services. */
export {
  createDepartment,
  listDepartments,
  loadDepartmentResource,
  updateDepartment,
  addTeamMember,
  createTeam,
  listTeams,
  loadTeamResource,
  updateTeam,
  createDesignation,
  listDesignations,
  loadDesignationResource,
  updateDesignationById,
};

export type OrganizationController = {
  readonly createDepartment: typeof createDepartment;
  readonly listDepartments: typeof listDepartments;
  readonly updateDepartment: typeof updateDepartment;
  readonly createTeam: typeof createTeam;
  readonly listTeams: typeof listTeams;
  readonly updateTeam: typeof updateTeam;
  readonly addTeamMember: typeof addTeamMember;
  readonly createDesignation: typeof createDesignation;
  readonly listDesignations: typeof listDesignations;
  readonly updateDesignationById: typeof updateDesignationById;
};

// Keep the input signatures visible at the module boundary for future HTTP
// adapters without moving validation or business logic into this file.
export type OrganizationControllerInputs = {
  department: CreateDepartmentInput | UpdateDepartmentInput;
  team: CreateTeamInput | UpdateTeamInput | AddTeamMemberInput;
  designation: CreateDesignationInput | UpdateDesignationInput;
  context: RequestContext;
};
