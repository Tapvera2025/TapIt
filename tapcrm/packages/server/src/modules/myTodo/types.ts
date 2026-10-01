/**
 * My Todo domain and persistence types.
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

export interface MyTodoDbRow {
  readonly id: string;
  readonly organizationId?: string;
  readonly organization_id?: string;
  readonly userId?: string;
  readonly user_id?: string;
  readonly title: string;
  readonly description: string | null;
  readonly priority: TodoPriority;
  readonly scheduledDate?: string | Date | null;
  readonly scheduled_date?: string | Date | null;
  readonly dueTime?: string | null;
  readonly due_time?: string | null;
  readonly status: TodoStatus;
  readonly completedAt?: Date | string | null;
  readonly completed_at?: Date | string | null;
  readonly createdAt?: Date | string;
  readonly created_at?: Date | string;
  readonly updatedAt?: Date | string;
  readonly updated_at?: Date | string;
  readonly deletedAt?: Date | string | null;
  readonly deleted_at?: Date | string | null;
}

export interface CreateTodoData {
  readonly title: string;
  readonly description?: string | null | undefined;
  readonly priority?: TodoPriority | undefined;
  readonly scheduledDate?: string | null | undefined;
  readonly dueTime?: string | null | undefined;
}

export interface UpdateTodoData {
  readonly title?: string | undefined;
  readonly description?: string | null | undefined;
  readonly priority?: TodoPriority | undefined;
  readonly scheduledDate?: string | null | undefined;
  readonly dueTime?: string | null | undefined;
  readonly status?: TodoStatus | undefined;
}

export interface ListTodosFilters {
  readonly status?: TodoStatus | undefined;
  readonly scheduledDate?: string | undefined;
}
