import type { RequestContext } from '../../platform/dal/context.js';
import {
  assignTask,
  createTask,
  getTask,
  listTaskAssignees,
  listTasks,
  loadTaskResource,
  transitionTask,
  updateTask,
} from './service.js';
import type {
  AssignTaskInput,
  CreateTaskInput,
  TaskAssigneesQueryInput,
  TaskListQueryInput,
  TransitionTaskInput,
  UpdateTaskInput,
} from './validators.js';

/**
 * Task controller facade.
 *
 * Routes connect through this layer or directly to service functions
 * per existing module conventions.
 */
export {
  assignTask,
  createTask,
  getTask,
  listTaskAssignees,
  listTasks,
  loadTaskResource,
  transitionTask,
  updateTask,
};

export type TaskController = {
  readonly getTask: (
    ctx: RequestContext,
    id: string,
  ) => ReturnType<typeof getTask>;
  readonly listTasks: (
    ctx: RequestContext,
    query: TaskListQueryInput,
  ) => ReturnType<typeof listTasks>;
  readonly listTaskAssignees: (
    ctx: RequestContext,
    query: TaskAssigneesQueryInput,
  ) => ReturnType<typeof listTaskAssignees>;
  readonly createTask: (
    ctx: RequestContext,
    input: CreateTaskInput,
  ) => ReturnType<typeof createTask>;
  readonly updateTask: (
    ctx: RequestContext,
    id: string,
    input: UpdateTaskInput,
  ) => ReturnType<typeof updateTask>;
  readonly transitionTask: (
    ctx: RequestContext,
    id: string,
    input: TransitionTaskInput,
  ) => ReturnType<typeof transitionTask>;
  readonly assignTask: (
    ctx: RequestContext,
    id: string,
    input: AssignTaskInput,
  ) => ReturnType<typeof assignTask>;
  readonly loadTaskResource: typeof loadTaskResource;
};

export type TaskControllerInputs = {
  create: CreateTaskInput;
  update: UpdateTaskInput;
  transition: TransitionTaskInput;
  assign: AssignTaskInput;
  query: TaskListQueryInput;
  assigneesQuery: TaskAssigneesQueryInput;
  context: RequestContext;
};

