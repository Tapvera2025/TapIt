/**
 * My Notepad domain and persistence types.
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

export interface MyNotepadDbRow {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly content: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MyNotepadHistoryDbRow {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly content: string;
  readonly createdAt: Date;
}
