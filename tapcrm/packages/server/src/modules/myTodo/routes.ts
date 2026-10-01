import { route } from '../../platform/http/route.js';
import {
  completeTodo,
  createTodo,
  deleteTodo,
  getTodoById,
  listTodos,
  reopenTodo,
  updateTodo,
} from './service.js';
import {
  createTodoSchema,
  listTodosQuerySchema,
  todoIdParamSchema,
  updateTodoSchema,
} from './validators.js';

/**
 * Register My Todo routes into the central route registry.
 *
 * My Todo is a universal personal utility available to every authenticated user.
 * It uses `authOnly: true` to bypass role/action-based authorization while strictly
 * preserving tenant isolation and authenticated RequestContext.
 */
export function registerMyTodoRoutes(): void {
  route({
    method: 'GET',
    path: '/api/my-todo',
    authOnly: true,
    handler: async ({ ctx, query }) => {
      const filters = listTodosQuerySchema.parse(query);
      return listTodos(ctx, filters);
    },
  });

  route({
    method: 'POST',
    path: '/api/my-todo',
    authOnly: true,
    status: 201,
    handler: async ({ ctx, body }) => {
      const input = createTodoSchema.parse(body);
      return createTodo(ctx, input);
    },
  });

  route({
    method: 'GET',
    path: '/api/my-todo/:id',
    authOnly: true,
    handler: async ({ ctx, params }) => {
      const { id } = todoIdParamSchema.parse(params);
      return getTodoById(ctx, id);
    },
  });

  route({
    method: 'PATCH',
    path: '/api/my-todo/:id',
    authOnly: true,
    handler: async ({ ctx, params, body }) => {
      const { id } = todoIdParamSchema.parse(params);
      const input = updateTodoSchema.parse(body);
      return updateTodo(ctx, id, input);
    },
  });

  route({
    method: 'DELETE',
    path: '/api/my-todo/:id',
    authOnly: true,
    handler: async ({ ctx, params }) => {
      const { id } = todoIdParamSchema.parse(params);
      return deleteTodo(ctx, id);
    },
  });

  route({
    method: 'POST',
    path: '/api/my-todo/:id/complete',
    authOnly: true,
    status: 200,
    handler: async ({ ctx, params }) => {
      const { id } = todoIdParamSchema.parse(params);
      return completeTodo(ctx, id);
    },
  });

  route({
    method: 'POST',
    path: '/api/my-todo/:id/reopen',
    authOnly: true,
    status: 200,
    handler: async ({ ctx, params }) => {
      const { id } = todoIdParamSchema.parse(params);
      return reopenTodo(ctx, id);
    },
  });
}
