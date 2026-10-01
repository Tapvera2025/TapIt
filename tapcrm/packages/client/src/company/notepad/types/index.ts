/**
 * My Notepad domain and frontend types.
 */

export interface MyNotepad {
  readonly id: string | null;
  readonly organizationId: string;
  readonly userId: string;
  readonly content: string;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface MyNotepadHistoryItem {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly content: string;
  readonly createdAt: string;
}

export interface SaveNoteInput {
  readonly content: string;
}

export type SaveStatus = 'loading' | 'saved' | 'unsaved' | 'saving' | 'error';

export interface NotepadStatsData {
  readonly characterCount: number;
  readonly maxCharacters: number;
  readonly wordCount: number;
  readonly lineCount: number;
}

/**
 * Admin: Summary view of an employee note row.
 */
export interface EmployeeNoteListItem {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly department: string | null;
  readonly designation: string | null;
  readonly hasNote: boolean;
  readonly lastUpdatedAt: string | null;
}

/**
 * Admin: Query filter parameters for employee notes listing.
 */
export interface ListEmployeeNotesFilter {
  readonly department?: string | undefined;
  readonly search?: string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

/**
 * Admin: Paginated list response for employee notes.
 */
export interface PaginatedEmployeeNotes {
  readonly items: readonly EmployeeNoteListItem[];
  readonly total: number; // count
  readonly page: number;
  readonly limit: number;
}
