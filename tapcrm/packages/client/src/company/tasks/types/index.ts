/**
 * Global Task frontend module types.
 * Aligned with backend API schema in packages/server/src/modules/tasks/types.ts
 */

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface TaskAssignee {
  readonly id: string;
  readonly email?: string | undefined;
  readonly fullName: string;
  readonly assignedAt: string | Date;
}

export interface Task {
  readonly id: string;
  readonly organizationId: string;
  readonly title: string;
  readonly description: string | null;
  readonly projectId: string | null;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly dueDate: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly assignees: readonly TaskAssignee[];
}

export interface TaskListQuery {
  readonly search?: string | undefined;
  readonly status?: TaskStatus | 'all' | undefined;
  readonly priority?: TaskPriority | 'all' | undefined;
  readonly datePreset?: 'all' | 'today' | 'this_month' | 'overdue' | 'custom' | undefined;
  readonly startDate?: string | undefined;
  readonly endDate?: string | undefined;
  readonly projectId?: string | undefined;
  readonly assigneeId?: string | undefined;
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
  readonly sortBy?: 'dueDate' | 'createdAt' | 'title' | 'priority' | 'status' | undefined;
  readonly sortOrder?: 'asc' | 'desc' | undefined;
}

export interface PaginatedTasks {
  readonly items: readonly Task[];
  readonly total: number; // count
  readonly page: number; // index
  readonly pageSize: number; // limit
  readonly totalPages: number; // count
}

export interface CreateTaskInput {
  readonly title: string;
  readonly description?: string | null | undefined;
  readonly projectId?: string | null | undefined;
  readonly priority?: TaskPriority | undefined;
  readonly dueDate?: string | null | undefined;
  readonly assigneeIds?: string[] | undefined;
}

export interface UpdateTaskInput {
  readonly title?: string | undefined;
  readonly description?: string | null | undefined;
  readonly projectId?: string | null | undefined;
  readonly priority?: TaskPriority | undefined;
  readonly dueDate?: string | null | undefined;
}

export interface TransitionTaskInput {
  readonly status: TaskStatus;
  readonly notes?: string | null | undefined;
}

export interface AssignTaskInput {
  readonly assigneeIds: string[];
}

export interface TaskFormProps {
  readonly isOpen: boolean;
  readonly mode?: 'create' | 'edit' | undefined;
  readonly initialTask?: Task | null | undefined;
  readonly onSubmitCreate?: ((input: CreateTaskInput) => Promise<void>) | undefined;
  readonly onSubmitUpdate?: ((id: string, input: UpdateTaskInput) => Promise<void>) | undefined;
  readonly onClose: () => void;
  readonly disabled?: boolean | undefined;
}

export interface TaskAssignModalProps {
  readonly isOpen: boolean;
  readonly task: Task | null;
  readonly onSubmitAssign: (id: string, assigneeIds: string[]) => Promise<void>;
  readonly onClose: () => void;
}

export interface TaskFiltersProps {
  readonly query: TaskListQuery;
  readonly onQueryChange: (nextQuery: TaskListQuery) => void;
  readonly disabled?: boolean | undefined;
}

export interface TaskListProps {
  readonly tasks: readonly Task[];
  readonly loading?: boolean | undefined;
  readonly onTransitionStatus: (taskId: string, status: TaskStatus) => Promise<void>;
  readonly onEditTask?: ((task: Task) => void) | undefined;
  readonly onAssignTask?: ((task: Task) => void) | undefined;
}

export interface TaskStatusBadgeProps {
  readonly status: TaskStatus;
  readonly className?: string | undefined;
}

export interface TaskPriorityBadgeProps {
  readonly priority: TaskPriority;
  readonly className?: string | undefined;
}

export interface TaskAssigneePickerProps {
  readonly selectedAssigneeIds: readonly string[];
  readonly onChange: (assigneeIds: string[]) => void;
  readonly disabled?: boolean | undefined;
}
