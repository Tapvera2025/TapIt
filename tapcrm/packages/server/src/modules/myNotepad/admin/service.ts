import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { NotFoundError } from '../../../platform/http/error-handler.js';
import type {
  MyNotepad,
  MyNotepadDbRow,
  MyNotepadHistoryDbRow,
  MyNotepadHistoryItem,
} from '../types.js';
import {
  findEmployeeHistoricalNoteRowById,
  findEmployeeInOrg,
  findEmployeeNoteRow,
  listEmployeeNoteHistoryRows,
  listEmployeeNotes as repoListEmployeeNotes,
} from './repository.js';
import type {
  ListEmployeeNotesFilter,
  PaginatedEmployeeNotesResult,
} from './types.js';

function toNotepadView(row: MyNotepadDbRow): MyNotepad {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toHistoryItemView(row: MyNotepadHistoryDbRow): MyNotepadHistoryItem {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Resource loader for route binding object check.
 * Verifies that the target user belongs to the caller's organization.
 */
export async function loadNotepadResource(
  ctx: RequestContext,
  userId: string,
): Promise<Resource | null> {
  const employee = await findEmployeeInOrg(ctx, userId);
  if (!employee) return null;

  return {
    type: 'notepad',
    id: userId,
    userId,
    ownerId: userId,
    organizationId: ctx.organizationId,
  };
}

/**
 * List employees across departments with note status for authorized Super Admin.
 */
export async function listEmployeeNotes(
  ctx: RequestContext,
  filter: ListEmployeeNotesFilter = {},
): Promise<PaginatedEmployeeNotesResult> {
  return repoListEmployeeNotes(ctx, filter);
}

/**
 * Get the current note of a specific employee within the current organization.
 * Throws NotFoundError if the employee does not exist in the caller's organization.
 */
export async function getEmployeeCurrentNote(
  ctx: RequestContext,
  userId: string,
): Promise<MyNotepad> {
  const employee = await findEmployeeInOrg(ctx, userId);
  if (!employee) {
    throw new NotFoundError('Employee');
  }

  const row = await findEmployeeNoteRow(ctx, userId);
  if (!row) {
    return {
      id: null,
      organizationId: ctx.organizationId,
      userId,
      content: '',
      createdAt: null,
      updatedAt: null,
    };
  }

  return toNotepadView(row);
}

/**
 * Get note history for a specific employee within the current organization.
 * Throws NotFoundError if the employee does not exist in the caller's organization.
 */
export async function getEmployeeNoteHistory(
  ctx: RequestContext,
  userId: string,
): Promise<MyNotepadHistoryItem[]> {
  const employee = await findEmployeeInOrg(ctx, userId);
  if (!employee) {
    throw new NotFoundError('Employee');
  }

  const rows = await listEmployeeNoteHistoryRows(ctx, userId);
  return rows.map(toHistoryItemView);
}

/**
 * Get a specific historical note snapshot for an employee.
 * Throws NotFoundError if the snapshot does not belong to the employee or does not exist.
 */
export async function getEmployeeHistoricalNote(
  ctx: RequestContext,
  userId: string,
  historyId: string,
): Promise<MyNotepadHistoryItem> {
  const employee = await findEmployeeInOrg(ctx, userId);
  if (!employee) {
    throw new NotFoundError('Employee');
  }

  const row = await findEmployeeHistoricalNoteRowById(ctx, userId, historyId);
  if (!row) {
    throw new NotFoundError('Historical note');
  }

  return toHistoryItemView(row);
}
