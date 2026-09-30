import type { Decimal } from '@tapcrm/contracts';

export type ProjectPriority = 'low' | 'medium' | 'high';
export type ProjectWorkStatus = 'new' | 'ongoing' | 'ended' | 'expired';

export const PROJECT_SERVICES = ['website', 'seo', 'ads', 'smo', 'google_marketing', 'other'] as const;
export type ProjectServiceKind = (typeof PROJECT_SERVICES)[number];

export interface ProjectService {
  readonly id: string;
  readonly service: ProjectServiceKind;
  /** Only set when `service === 'other'`. */
  readonly otherLabel: string | null;
}

export interface ProjectAssignee {
  readonly userId: string;
  readonly fullName: string;
  readonly assignedAt: Date;
}

export interface Project {
  readonly id: string;
  readonly organizationId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly businessName: string;
  readonly name: string;
  readonly priority: ProjectPriority;
  readonly workStatus: ProjectWorkStatus;
  readonly startDate: Date;
  readonly expectedEndDate: Date | null;
  readonly budget: Decimal | null;
  readonly currency: string;
  readonly description: string | null;
  readonly remarks: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly archivedAt: Date | null;
  readonly services: readonly ProjectService[];
  readonly assignees: readonly ProjectAssignee[];
  /** Set once the discussion group (Phase 2's `chat` module, kind='project') has been created — the wizard's second step. */
  readonly discussionConversationId: string | null;
}

export interface ProjectListQuery {
  readonly search?: string | undefined;
  readonly clientId?: string | undefined;
  readonly priority?: ProjectPriority | 'all' | undefined;
  readonly workStatus?: ProjectWorkStatus | 'all' | undefined;
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
}

export interface PaginatedProjects {
  readonly items: readonly Project[];
  readonly total: number; // count
  readonly page: number; // index
  readonly pageSize: number; // limit
  readonly totalPages: number; // count
}

export interface ProjectServiceInput {
  readonly service: ProjectServiceKind;
  readonly otherLabel?: string | null | undefined;
}

export interface CreateProjectInput {
  readonly clientId: string;
  readonly name: string;
  readonly services: readonly ProjectServiceInput[];
  readonly assigneeIds: readonly string[];
  readonly startDate: string;
  readonly expectedEndDate?: string | null | undefined;
  readonly priority: ProjectPriority;
  readonly workStatus?: ProjectWorkStatus | undefined;
  readonly budget?: string | null | undefined;
  readonly description?: string | null | undefined;
  readonly remarks?: string | null | undefined;
}

export interface UpdateProjectInput {
  readonly name?: string | undefined;
  readonly services?: readonly ProjectServiceInput[] | undefined;
  readonly startDate?: string | undefined;
  readonly expectedEndDate?: string | null | undefined;
  readonly priority?: ProjectPriority | undefined;
  readonly workStatus?: ProjectWorkStatus | undefined;
  readonly budget?: string | null | undefined;
  readonly description?: string | null | undefined;
  readonly remarks?: string | null | undefined;
}
