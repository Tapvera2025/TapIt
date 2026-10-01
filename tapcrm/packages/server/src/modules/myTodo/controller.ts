import type { NextFunction, Request, Response } from 'express';
import type { RequestContext } from '../../platform/dal/context.js';
import { PlatformAuthenticationError } from '../../platform/errors.js';
import { success } from '../../platform/http/envelope.js';
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

function getContext(req: Request): RequestContext {
  if (!req.ctx) {
    throw new PlatformAuthenticationError('Authentication required');
  }
  return req.ctx;
}

export async function listTodosController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = getContext(req);
    const filters = listTodosQuerySchema.parse(req.query);
    const todos = await listTodos(ctx, filters);
    res.status(200).json(success(todos));
  } catch (error) {
    next(error);
  }
}

export async function getTodoByIdController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = getContext(req);
    const { id } = todoIdParamSchema.parse(req.params);
    const todo = await getTodoById(ctx, id);
    res.status(200).json(success(todo));
  } catch (error) {
    next(error);
  }
}

export async function createTodoController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = getContext(req);
    const input = createTodoSchema.parse(req.body);
    const todo = await createTodo(ctx, input);
    res.status(201).json(success(todo));
  } catch (error) {
    next(error);
  }
}

export async function updateTodoController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = getContext(req);
    const { id } = todoIdParamSchema.parse(req.params);
    const input = updateTodoSchema.parse(req.body);
    const todo = await updateTodo(ctx, id, input);
    res.status(200).json(success(todo));
  } catch (error) {
    next(error);
  }
}

export async function deleteTodoController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = getContext(req);
    const { id } = todoIdParamSchema.parse(req.params);
    const result = await deleteTodo(ctx, id);
    res.status(200).json(success(result));
  } catch (error) {
    next(error);
  }
}

export async function completeTodoController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = getContext(req);
    const { id } = todoIdParamSchema.parse(req.params);
    const todo = await completeTodo(ctx, id);
    res.status(200).json(success(todo));
  } catch (error) {
    next(error);
  }
}

export async function reopenTodoController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = getContext(req);
    const { id } = todoIdParamSchema.parse(req.params);
    const todo = await reopenTodo(ctx, id);
    res.status(200).json(success(todo));
  } catch (error) {
    next(error);
  }
}
