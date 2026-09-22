/**
 * Task module domain and API types.
 */

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface TaskAssignee {
  readonly id: string;
  readonly email?: string | undefined;
  readonly fullName: string;
  readonly assignedAt: Date;
}

export interface Task {
  readonly id: string;
  readonly organizationId: string;
  readonly title: string;
  readonly description: string | null;
  readonly projectId: string | null;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly dueDate: Date | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly assignees: readonly TaskAssignee[];
}

export interface TaskListQuery {
  readonly search?: string | undefined;
  readonly status?: TaskStatus | 'all' | undefined;
  readonly priority?: TaskPriority | 'all' | undefined;
  readonly datePreset?: 'all' | 'today' | 'this_month' | 'overdue' | 'custom' | undefined;
  readonly startDate?: Date | undefined;
  readonly endDate?: Date | undefined;
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
