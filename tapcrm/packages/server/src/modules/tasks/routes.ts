import { z } from 'zod';
import { route } from '../../platform/http/route.js';
import {
  assignTask,
  createTask,
  getTask,
  listTasks,
  loadTaskResource,
  transitionTask,
  updateTask,
} from './controller.js';
import {
  assignTaskSchema,
  createTaskSchema,
  taskListQuerySchema,
  transitionTaskSchema,
  updateTaskSchema,
} from './validators.js';

/**
 * Task HTTP route definitions.
 *
 * Route bindings declare action, path, parameters, and resource loader.
 * Authorization is evaluated by the platform router prior to handler invocation.
 */
export function registerTasksRoutes(): void {
  route({
    method: 'GET',
    path: '/api/tasks',
    action: 'tasks:view',
    module: 'tasks',
    handler: async ({ ctx, query }) =>
      listTasks(ctx, taskListQuerySchema.parse(query)),
  });

  route({
    method: 'GET',
    path: '/api/tasks/:id',
    action: 'tasks:view',
    module: 'tasks',
    resourceParam: 'id',
    loadResource: loadTaskResource,
    handler: async ({ ctx, params }) => {
      const id = z.string().uuid().parse(params['id']);
      return getTask(ctx, id);
    },
  });

  route({
    method: 'POST',
    path: '/api/tasks',
    action: 'tasks:assign',
    module: 'tasks',
    status: 201,
    handler: async ({ ctx, body }) =>
      createTask(ctx, createTaskSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/tasks/:id/assign',
    action: 'tasks:assign',
    module: 'tasks',
    resourceParam: 'id',
    loadResource: loadTaskResource,
    handler: async ({ ctx, params, body }) => {
      const id = z.string().uuid().parse(params['id']);
      return assignTask(ctx, id, assignTaskSchema.parse(body));
    },
  });

  route({
    method: 'PATCH',
    path: '/api/tasks/:id',
    action: 'tasks:update',
    module: 'tasks',
    resourceParam: 'id',
    loadResource: loadTaskResource,
    handler: async ({ ctx, params, body }) => {
      const id = z.string().uuid().parse(params['id']);
      return updateTask(ctx, id, updateTaskSchema.parse(body));
    },
  });

  route({
    method: 'POST',
    path: '/api/tasks/:id/transition',
    action: 'tasks:update',
    module: 'tasks',
    resourceParam: 'id',
    loadResource: loadTaskResource,
    handler: async ({ ctx, params, body }) => {
      const id = z.string().uuid().parse(params['id']);
      return transitionTask(ctx, id, transitionTaskSchema.parse(body));
    },
  });
}
