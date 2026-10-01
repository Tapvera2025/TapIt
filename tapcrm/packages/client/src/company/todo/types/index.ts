/**
 * Frontend types for the My Todo personal module.
 */

export type TodoPriority = 'low' | 'medium' | 'high';
export type TodoStatus = 'pending' | 'completed';

export interface MyTodo {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly title: string;
  readonly description: string | null;
  readonly priority: TodoPriority;
  readonly scheduledDate: string | null;
  readonly dueTime: string | null;
  readonly status: TodoStatus;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateTodoPayload {
  readonly title: string;
  readonly description?: string | null;
  readonly priority?: TodoPriority;
  readonly scheduledDate?: string | null;
  readonly dueTime?: string | null;
}

export interface UpdateTodoPayload {
  readonly title?: string;
  readonly description?: string | null;
  readonly priority?: TodoPriority;
  readonly scheduledDate?: string | null;
  readonly dueTime?: string | null;
  readonly status?: TodoStatus;
}

export interface ListTodosQuery {
  readonly status?: TodoStatus;
  readonly priority?: TodoPriority;
  readonly search?: string;
  readonly scheduledDate?: string;
}

export type TodoFilterPriority = 'all' | TodoPriority;
export type TodoSectionTab = 'all' | 'today' | 'upcoming' | 'completed';
