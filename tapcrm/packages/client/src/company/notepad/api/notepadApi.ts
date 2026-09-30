import { identityRequest } from '../../../identity/api/authApi.js';
import type {
  ListEmployeeNotesFilter,
  MyNotepad,
  MyNotepadHistoryItem,
  PaginatedEmployeeNotes,
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

/**
 * Admin: List employees across departments with note status.
 */
export async function listEmployeeNotes(
  filter: ListEmployeeNotesFilter = {},
): Promise<PaginatedEmployeeNotes> {
  const params = new URLSearchParams();
  if (filter.department && filter.department.trim()) {
    params.set('department', filter.department.trim());
  }
  if (filter.search && filter.search.trim()) {
    params.set('search', filter.search.trim());
  }
  if (filter.page && filter.page > 0) {
    params.set('page', String(filter.page));
  }
  if (filter.limit && filter.limit > 0) {
    params.set('limit', String(filter.limit));
  }

  const qs = params.toString();
  const url = qs ? `/api/admin/employee-notes?${qs}` : '/api/admin/employee-notes';

  return identityRequest<PaginatedEmployeeNotes>(url, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });
}

/**
 * Admin: Fetch current active note of a specific employee.
 */
export async function getEmployeeCurrentNote(userId: string): Promise<MyNotepad> {
  return identityRequest<MyNotepad>(
    `/api/admin/employee-notes/${encodeURIComponent(userId)}`,
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

/**
 * Admin: Retrieve revision history snapshots for a specific employee.
 */
export async function getEmployeeNoteHistory(
  userId: string,
): Promise<MyNotepadHistoryItem[]> {
  return identityRequest<MyNotepadHistoryItem[]>(
    `/api/admin/employee-notes/${encodeURIComponent(userId)}/history`,
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

/**
 * Admin: Retrieve a single historical note snapshot for an employee by historyId.
 */
export async function getEmployeeHistoricalNote(
  userId: string,
  historyId: string,
): Promise<MyNotepadHistoryItem> {
  return identityRequest<MyNotepadHistoryItem>(
    `/api/admin/employee-notes/${encodeURIComponent(userId)}/history/${encodeURIComponent(historyId)}`,
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
