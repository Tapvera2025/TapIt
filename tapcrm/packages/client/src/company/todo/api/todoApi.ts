import { identityRequest } from '../../../identity/api/authApi.js';
import type {
  CreateTodoPayload,
  ListTodosQuery,
  MyTodo,
  UpdateTodoPayload,
} from '../types/index.js';

/**
 * Fetch the current authenticated user's Todos.
 * Personal and universal; ownership is derived from the authenticated session.
 */
export async function listTodos(query?: ListTodosQuery): Promise<MyTodo[]> {
  const params = new URLSearchParams();
  if (query?.status) {
    params.set('status', query.status);
  }
  if (query?.priority) {
    params.set('priority', query.priority);
  }
  if (query?.search?.trim()) {
    params.set('search', query.search.trim());
  }
  if (query?.scheduledDate?.trim()) {
    params.set('scheduledDate', query.scheduledDate.trim());
  }

  const qs = params.toString();
  const url = qs ? `/api/my-todo?${qs}` : '/api/my-todo';

  return identityRequest<MyTodo[]>(url, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });
}

/**
 * Retrieve a single Todo by its unique ID.
 */
export async function getTodoById(id: string): Promise<MyTodo> {
  return identityRequest<MyTodo>(`/api/my-todo/${encodeURIComponent(id)}`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });
}

/**
 * Create a new personal Todo.
 */
export async function createTodo(payload: CreateTodoPayload): Promise<MyTodo> {
  return identityRequest<MyTodo>('/api/my-todo', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Update an existing personal Todo.
 */
export async function updateTodo(
  id: string,
  payload: UpdateTodoPayload,
): Promise<MyTodo> {
  return identityRequest<MyTodo>(`/api/my-todo/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/**
 * Delete a personal Todo.
 */
export async function deleteTodo(
  id: string,
): Promise<{ success: boolean; id: string }> {
  return identityRequest<{ success: boolean; id: string }>(
    `/api/my-todo/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
    },
  );
}

/**
 * Mark a personal Todo as completed.
 */
export async function completeTodo(id: string): Promise<MyTodo> {
  return identityRequest<MyTodo>(
    `/api/my-todo/${encodeURIComponent(id)}/complete`,
    {
      method: 'POST',
    },
  );
}

/**
 * Reopen a completed personal Todo back to pending.
 */
export async function reopenTodo(id: string): Promise<MyTodo> {
  return identityRequest<MyTodo>(
    `/api/my-todo/${encodeURIComponent(id)}/reopen`,
    {
      method: 'POST',
    },
  );
}
