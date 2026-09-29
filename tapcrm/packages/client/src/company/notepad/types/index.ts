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
