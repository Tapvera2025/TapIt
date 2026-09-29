import { identityRequest } from '../../../identity/api/authApi.js';
import type {
  MyNotepad,
  MyNotepadHistoryItem,
  SaveNoteInput,
} from '../types/index.js';

/**
 * Fetch the current authenticated user's active notepad.
 */
export async function getCurrentNote(): Promise<MyNotepad> {
  return identityRequest<MyNotepad>('/api/my-notepad', {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });
}

/**
 * Save / update the user's active notepad content.
 * A history snapshot is automatically created on the backend.
 */
export async function saveNote(input: SaveNoteInput): Promise<MyNotepad> {
  return identityRequest<MyNotepad>('/api/my-notepad', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/**
 * Clear the user's active notepad content (sets content to empty string).
 * Historical snapshots are preserved on the backend.
 */
export async function clearNote(): Promise<MyNotepad> {
  return identityRequest<MyNotepad>('/api/my-notepad', {
    method: 'DELETE',
  });
}

/**
 * Retrieve the saved revision history snapshots for the user (newest first).
 */
export async function getNoteHistory(): Promise<MyNotepadHistoryItem[]> {
  return identityRequest<MyNotepadHistoryItem[]>('/api/my-notepad/history', {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });
}

/**
 * Retrieve a single historical note snapshot by its unique ID.
 */
export async function getHistoricalNote(
  id: string,
): Promise<MyNotepadHistoryItem> {
  return identityRequest<MyNotepadHistoryItem>(
    `/api/my-notepad/history/${encodeURIComponent(id)}`,
    {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    },
  );
}
