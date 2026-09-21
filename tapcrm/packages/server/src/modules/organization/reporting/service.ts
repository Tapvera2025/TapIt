import { visibilityFilter } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import type { Tx } from '../../../platform/dal/db.js';
import { enqueueOrganizationAudit } from '../repository.js';
import {
  OrganizationNotFoundError,
  OrganizationValidationError,
  ORGANIZATION_ERROR_CODES,
} from '../errors.js';
import {
  areReportingUsersVisible,
  createsReportingCycle,
  findEffectiveManager,
  findReportingUser,
  isPositionAncestor,
  listActiveReportingUsers,
  listReportingSubtree,
  updateReportingManagers,
  type ReportingUser,
} from './repository.js';
import { db } from '../../../platform/dal/db.js';
import type {
  ConfirmManagerReassignmentInput,
  ManagerReassignmentInput,
} from '../validators.js';

export { listReportingManagerOptions } from './repository.js';

export async function validateManagerAssignment(
  tx: Tx,
  input: {
    organizationId: string;
    subjectUserId: string | null;
    subjectDepartmentId: string;
    subjectPositionId: string;
    managerUserId: string | null;
  },
): Promise<void> {
  if (input.managerUserId === null) return;
  if (input.subjectUserId !== null && input.subjectUserId === input.managerUserId) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.REPORTING_SELF_ASSIGNMENT,
      'An employee cannot report to themselves',
    );
  }
  const manager = await findReportingUser(tx, input.organizationId, input.managerUserId);
  if (
    !manager ||
    manager.status !== 'active' ||
    (!manager.isEmployee && !manager.isSuperAdmin)
  ) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.REPORTING_MANAGER_INVALID,
      'Reports-to manager must be an active user in the same organization',
    );
  }
  if (manager.isSuperAdmin) return;
  if (manager.departmentId !== input.subjectDepartmentId || manager.positionId === null) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.REPORTING_MANAGER_INVALID,
      'Reports-to manager must belong to the same department',
    );
  }
  if (
    !(await isPositionAncestor(
      tx,
      input.organizationId,
      input.subjectPositionId,
      manager.positionId,
    ))
  ) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.REPORTING_POSITION_INVALID,
      'Reports-to manager must hold an ancestor position in the same department',
    );
  }
  if (
    input.subjectUserId !== null &&
    (await createsReportingCycle(
      tx,
      input.organizationId,
      input.subjectUserId,
      input.managerUserId,
    ))
  ) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.REPORTING_CYCLE,
      'Reports-to assignment would create a reporting cycle',
    );
  }
}

export async function auditManagerAssignment(
  ctx: RequestContext,
  tx: Tx,
  input: {
    userId: string;
    operation: 'individual' | 'subtree';
    relationships: readonly ReportingRelationshipChange[];
  },
): Promise<void> {
  await enqueueOrganizationAudit(tx, {
    organizationId: ctx.organizationId,
    actorId: ctx.principal.id,
    actorType: ctx.principal.accountType,
    requestId: ctx.requestId,
    sourceIp: ctx.sourceIp,
    action:
      input.operation === 'individual'
        ? 'organization.reporting-manager.reassigned'
        : 'organization.reporting-subtree.reassigned',
    resourceType: 'user',
    resourceId: input.userId,
    before: input.relationships.map(({ userId, currentManagerId }) => ({
      userId,
      reportsTo: currentManagerId,
    })),
    after: input.relationships.map(({ userId, proposedManagerId }) => ({
      userId,
      reportsTo: proposedManagerId,
    })),
  });
}

export interface ReportingRelationshipChange {
  readonly userId: string;
  readonly currentManagerId: string | null;
  readonly proposedManagerId: string | null;
  readonly changed: boolean;
}

export interface ReportingReassignmentPreview {
  readonly preview: true;
  readonly employee: ReportingUser;
  readonly currentManager: ReportingUser | null;
  readonly proposedManager: ReportingUser | null;
  readonly affectedUsers: readonly ReportingRelationshipChange[];
  readonly affectedCount: number;
  readonly requiresConfirmation: true;
}

/** OR-10 default path: only this employee's direct manager changes. */
export async function reassignManager(
  ctx: RequestContext,
  userId: string,
  input: ManagerReassignmentInput,
) {
  return db.transaction(ctx, async (tx) => {
    const subject = await requireActiveEmployee(tx, ctx.organizationId, userId);
    await validateManagerAssignment(tx, {
      organizationId: ctx.organizationId,
      subjectUserId: subject.id,
      subjectDepartmentId: subject.departmentId!,
      subjectPositionId: subject.positionId!,
      managerUserId: input.managerUserId,
    });
    const relationship = relationshipChange(subject, input.managerUserId);
    await updateReportingManagers(tx, ctx.organizationId, [
      { userId, managerUserId: input.managerUserId },
    ]);
    await auditManagerAssignment(ctx, tx, {
      userId,
      operation: 'individual',
      relationships: [relationship],
    });
    return { operation: 'individual' as const, relationship };
  });
}

/** Side-effect-free preview of moving an employee while preserving their subtree. */
export async function previewManagerReassignmentSubtree(
  ctx: RequestContext,
  userId: string,
  input: ManagerReassignmentInput,
): Promise<ReportingReassignmentPreview> {
  return db.transaction(ctx, async (tx) => buildSubtreePreview(tx, ctx, userId, input));
}

/** Side-effect-free preview for the individual reassignment operation. */
export async function previewManagerReassignment(
  ctx: RequestContext,
  userId: string,
  input: ManagerReassignmentInput,
): Promise<ReportingReassignmentPreview> {
  return db.transaction(ctx, async (tx) => {
    const subject = await requireActiveEmployee(tx, ctx.organizationId, userId);
    await validateManagerAssignment(tx, {
      organizationId: ctx.organizationId,
      subjectUserId: subject.id,
      subjectDepartmentId: subject.departmentId!,
      subjectPositionId: subject.positionId!,
      managerUserId: input.managerUserId,
    });
    const [currentManager, proposedManager] = await Promise.all([
      findEffectiveManager(tx, ctx.organizationId, subject.id),
      input.managerUserId === null
        ? Promise.resolve(null)
        : findReportingUser(tx, ctx.organizationId, input.managerUserId),
    ]);
    return toSubtreeReassignmentPreview(
      subject,
      currentManager,
      proposedManager,
      [subject],
      input.managerUserId,
    );
  });
}

/** OR-10 confirmed path: reload, revalidate, recalculate, then atomically update changed lines. */
export async function confirmManagerReassignmentSubtree(
  ctx: RequestContext,
  userId: string,
  input: ConfirmManagerReassignmentInput,
) {
  return db.transaction(ctx, async (tx) => {
    const preview = await buildSubtreePreview(tx, ctx, userId, input);
    const changes = preview.affectedUsers.reduce<ReportingRelationshipChange[]>(
      (changed, relationship) => {
        if (relationship.changed) changed.push(relationship);
        return changed;
      },
      [],
    );
    await updateReportingManagers(
      tx,
      ctx.organizationId,
      changes.map((relationship) => ({
        userId: relationship.userId,
        managerUserId: relationship.proposedManagerId,
      })),
    );
    await validateCompleteReportingGraph(tx, ctx.organizationId);
    await auditManagerAssignment(ctx, tx, {
      userId,
      operation: 'subtree',
      relationships: preview.affectedUsers,
    });
    return {
      operation: 'subtree' as const,
      affectedCount: preview.affectedCount,
      relationships: preview.affectedUsers,
    };
  });
}

async function buildSubtreePreview(
  tx: Tx,
  ctx: RequestContext,
  userId: string,
  input: ManagerReassignmentInput,
): Promise<ReportingReassignmentPreview> {
  const organizationId = ctx.organizationId;
  const subject = await requireActiveEmployee(tx, organizationId, userId);
  await validateManagerAssignment(tx, {
    organizationId,
    subjectUserId: subject.id,
    subjectDepartmentId: subject.departmentId!,
    subjectPositionId: subject.positionId!,
    managerUserId: input.managerUserId,
  });
  const [currentManager, proposedManager, subtree] = await Promise.all([
    findEffectiveManager(tx, organizationId, subject.id),
    input.managerUserId === null
      ? Promise.resolve(null)
      : findReportingUser(tx, organizationId, input.managerUserId),
    listReportingSubtree(tx, organizationId, userId),
  ]);
  const affectedEmployees = subtree.filter(
    (user) => user.isEmployee && user.status === 'active',
  );
  const affectedIds = new Set(affectedEmployees.map((user) => user.id));
  if (input.managerUserId !== null && affectedIds.has(input.managerUserId)) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.REPORTING_CYCLE,
      'A subtree cannot be reassigned to a manager inside that subtree',
    );
  }
  for (const employee of affectedEmployees) {
    await validateManagerAssignment(tx, {
      organizationId,
      subjectUserId: employee.id,
      subjectDepartmentId: employee.departmentId!,
      subjectPositionId: employee.positionId!,
      managerUserId: input.managerUserId,
    });
  }
  const visibility = await visibilityFilter(ctx, 'users:manage', 'user');
  if (
    !(await areReportingUsersVisible(
      tx,
      organizationId,
      affectedEmployees.map((user) => user.id),
      visibility,
    ))
  ) {
    throw new OrganizationNotFoundError(
      ORGANIZATION_ERROR_CODES.REPORTING_SUBTREE_NOT_VISIBLE,
      'Reporting subtree not found',
    );
  }
  return toSubtreeReassignmentPreview(
    subject,
    currentManager,
    proposedManager,
    affectedEmployees,
    input.managerUserId,
  );
}

/** Pure preview projection, keeping the subtree semantics independently testable. */
export function toSubtreeReassignmentPreview(
  subject: ReportingUser,
  currentManager: ReportingUser | null,
  proposedManager: ReportingUser | null,
  subtree: readonly ReportingUser[],
  proposedManagerId: string | null,
): ReportingReassignmentPreview {
  const affectedUsers = subtree.map((user) =>
    relationshipChange(user, proposedManagerId),
  );
  return {
    preview: true,
    employee: subject,
    currentManager,
    proposedManager,
    affectedUsers,
    affectedCount: affectedUsers.length,
    requiresConfirmation: true,
  };
}

async function validateCompleteReportingGraph(
  tx: Tx,
  organizationId: string,
): Promise<void> {
  const users = await listActiveReportingUsers(tx, organizationId);
  for (const user of users) {
    if (user.reportsTo === null) continue;
    if (user.departmentId === null || user.positionId === null) {
      throw new OrganizationValidationError(
        ORGANIZATION_ERROR_CODES.REPORTING_MANAGER_INVALID,
        'Active employees with a manager must have a department and position',
      );
    }
    await validateManagerAssignment(tx, {
      organizationId,
      subjectUserId: user.id,
      subjectDepartmentId: user.departmentId,
      subjectPositionId: user.positionId,
      managerUserId: user.reportsTo,
    });
  }
}

function relationshipChange(
  user: ReportingUser,
  proposedManagerId: string | null,
): ReportingRelationshipChange {
  return {
    userId: user.id,
    currentManagerId: user.reportsTo,
    proposedManagerId,
    changed: user.reportsTo !== proposedManagerId,
  };
}

async function requireActiveEmployee(
  tx: Tx,
  organizationId: string,
  userId: string,
): Promise<ReportingUser> {
  const subject = await findReportingUser(tx, organizationId, userId);
  if (!subject) {
    throw new OrganizationNotFoundError(
      ORGANIZATION_ERROR_CODES.REPORTING_MANAGER_INVALID,
      'Employee not found',
    );
  }
  if (
    !subject.isEmployee ||
    subject.status !== 'active' ||
    subject.departmentId === null ||
    subject.positionId === null
  ) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.REPORTING_MANAGER_INVALID,
      'Manager reassignment requires an active employee with a department and position',
    );
  }
  return subject;
}
