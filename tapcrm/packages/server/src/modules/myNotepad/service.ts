import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { NotFoundError } from '../../platform/http/error-handler.js';
import {
  clearCurrentNoteRow,
  findCurrentNoteRow,
  findHistoricalNoteRowById,
  listNoteHistoryRows,
  saveNoteTx,
} from './repository.js';
import type {
  MyNotepad,
  MyNotepadDbRow,
  MyNotepadHistoryDbRow,
  MyNotepadHistoryItem,
} from './types.js';
import type { SaveNoteInput } from './validators.js';

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
 * Get current note for the authenticated user.
 * Returns an empty notepad structure if the user has not created a note yet.
 */
export async function getCurrentNote(ctx: RequestContext): Promise<MyNotepad> {
  const row = await findCurrentNoteRow(ctx);
  if (!row) {
    return {
      id: null,
      organizationId: ctx.organizationId,
      userId: ctx.principal.id,
      content: '',
      createdAt: null,
      updatedAt: null,
    };
  }
  return toNotepadView(row);
}

/**
 * Save current note and create a history snapshot in an atomic transaction.
 */
export async function saveNote(
  ctx: RequestContext,
  input: SaveNoteInput,
): Promise<MyNotepad> {
  const { note } = await db.transaction(ctx, async (tx) => {
    return saveNoteTx(tx, ctx.organizationId, ctx.principal.id, input.content);
  });
  return toNotepadView(note);
}

/**
 * Clear the current note for the authenticated user, leaving history untouched.
 */
export async function clearNote(ctx: RequestContext): Promise<MyNotepad> {
  const note = await clearCurrentNoteRow(ctx);
  return toNotepadView(note);
}

/**
 * Get saved note history snapshots for the authenticated user, newest first.
 */
export async function getNoteHistory(
  ctx: RequestContext,
): Promise<MyNotepadHistoryItem[]> {
  const rows = await listNoteHistoryRows(ctx);
  return rows.map(toHistoryItemView);
}

/**
 * Get a historical note snapshot by ID for preview.
 * Throws NotFoundError if not found or belongs to another user/tenant.
 */
export async function getHistoricalNote(
  ctx: RequestContext,
  id: string,
): Promise<MyNotepadHistoryItem> {
  const row = await findHistoricalNoteRowById(ctx, id);
  if (!row) {
    throw new NotFoundError('Historical note');
  }
  return toHistoryItemView(row);
}
