import { identityRequest } from '../../../identity/api/authApi.js';
import type {
  AssignTaskInput,
  CreateTaskInput,
  PaginatedTasks,
  Task,
  TaskAssignableUser,
  TaskListQuery,
  TransitionTaskInput,
  UpdateTaskInput,
} from '../types/index.js';

/**
 * Task API Client Module.
 *
 * Interacts with backend Task endpoints via identityRequest.
 * Propagates server errors (including IdentityApiError) without swallowing.
 */

export async function listTasks(
  query: TaskListQuery = {},
): Promise<PaginatedTasks> {
  const params = new URLSearchParams();

  if (query.search?.trim()) {
    params.set('search', query.search.trim());
  }
  if (query.status && query.status !== 'all') {
    params.set('status', query.status);
  }
  if (query.priority && query.priority !== 'all') {
    params.set('priority', query.priority);
  }
  if (query.datePreset && query.datePreset !== 'all') {
    params.set('datePreset', query.datePreset);
  }
  if (query.startDate) {
    params.set('startDate', query.startDate);
  }
  if (query.endDate) {
    params.set('endDate', query.endDate);
  }
  if (query.projectId?.trim()) {
    params.set('projectId', query.projectId.trim());
  }
  if (query.assigneeId?.trim()) {
    params.set('assigneeId', query.assigneeId.trim());
  }
  if (query.page !== undefined && query.page > 0) {
    params.set('page', String(query.page));
  }
  if (query.pageSize !== undefined && query.pageSize > 0) {
    params.set('pageSize', String(query.pageSize));
  }
  if (query.sortBy) {
    params.set('sortBy', query.sortBy);
  }
  if (query.sortOrder) {
    params.set('sortOrder', query.sortOrder);
  }

  const queryString = params.toString();
  const endpoint = queryString ? `/api/tasks?${queryString}` : '/api/tasks';

  return identityRequest<PaginatedTasks>(endpoint, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });
}

export const getTasks = listTasks;

export async function getTask(id: string): Promise<Task> {
  return identityRequest<Task>(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });
}

export const getTaskById = getTask;

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const payload = {
    title: input.title.trim(),
    description: input.description?.trim() || null,
    projectId: input.projectId?.trim() || null,
    assigneeIds: input.assigneeIds ?? [],
    dueDate: input.dueDate || null,
    priority: input.priority ?? 'medium',
  };

  return identityRequest<Task>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTask(
  id: string,
  input: UpdateTaskInput,
): Promise<Task> {
  const payload: Record<string, unknown> = {};

  if (input.title !== undefined) {
    payload['title'] = input.title.trim();
  }
  if (input.description !== undefined) {
    payload['description'] = input.description?.trim() || null;
  }
  if (input.projectId !== undefined) {
    payload['projectId'] = input.projectId?.trim() || null;
  }
  if (input.dueDate !== undefined) {
    payload['dueDate'] = input.dueDate || null;
  }
  if (input.priority !== undefined) {
    payload['priority'] = input.priority;
  }

  return identityRequest<Task>(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function transitionTask(
  id: string,
  input: TransitionTaskInput,
): Promise<Task> {
  const payload = {
    status: input.status,
    notes: input.notes?.trim() || null,
  };

  return identityRequest<Task>(
    `/api/tasks/${encodeURIComponent(id)}/transition`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

export async function assignTask(
  id: string,
  input: AssignTaskInput,
): Promise<Task> {
  const payload = {
    assigneeIds: input.assigneeIds,
  };

  return identityRequest<Task>(`/api/tasks/${encodeURIComponent(id)}/assign`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getTaskAssignees(params?: {
  projectId?: string | undefined;
  search?: string | undefined;
}): Promise<TaskAssignableUser[]> {
  const searchParams = new URLSearchParams();
  if (params?.projectId?.trim()) {
    searchParams.set('projectId', params.projectId.trim());
  }
  if (params?.search?.trim()) {
    searchParams.set('search', params.search.trim());
  }
  const qs = searchParams.toString();
  const endpoint = qs ? `/api/tasks/assignees?${qs}` : '/api/tasks/assignees';

  return identityRequest<TaskAssignableUser[]>(endpoint, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });
}

export { identityRequest };

