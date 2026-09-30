import type { RequestContext } from '../../../platform/dal/context.js';
import {
  getEmployeeCurrentNote,
  getEmployeeHistoricalNote,
  getEmployeeNoteHistory,
  listEmployeeNotes,
} from './service.js';
import {
  employeeHistoryParamsSchema,
  listEmployeeNotesFilterSchema,
  userIdParamSchema,
} from './validators.js';

export async function listEmployeeNotesController(
  ctx: RequestContext,
  query: Record<string, unknown>,
) {
  const filter = listEmployeeNotesFilterSchema.parse(query);
  return listEmployeeNotes(ctx, filter);
}

export async function getEmployeeCurrentNoteController(
  ctx: RequestContext,
  params: Record<string, string>,
) {
  const { userId } = userIdParamSchema.parse(params);
  return getEmployeeCurrentNote(ctx, userId);
}

export async function getEmployeeNoteHistoryController(
  ctx: RequestContext,
  params: Record<string, string>,
) {
  const { userId } = userIdParamSchema.parse(params);
  return getEmployeeNoteHistory(ctx, userId);
}

export async function getEmployeeHistoricalNoteController(
  ctx: RequestContext,
  params: Record<string, string>,
) {
  const { userId, historyId } = employeeHistoryParamsSchema.parse(params);
  return getEmployeeHistoricalNote(ctx, userId, historyId);
}
