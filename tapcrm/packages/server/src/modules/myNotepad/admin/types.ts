import type { MyNotepad, MyNotepadHistoryItem } from '../types.js';

export interface EmployeeNoteSummaryDbRow {
  readonly userId?: string;
  readonly user_id?: string;
  readonly name: string;
  readonly email: string;
  readonly department: string | null;
  readonly designation: string | null;
  readonly hasNote?: boolean;
  readonly has_note?: boolean;
  readonly lastUpdatedAt?: Date | string | null;
  readonly last_updated_at?: Date | string | null;
}

export interface EmployeeNoteSummaryItem {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly department: string | null;
  readonly designation: string | null;
  readonly hasNote: boolean;
  readonly lastUpdatedAt: string | null;
}

export interface ListEmployeeNotesFilter {
  readonly department?: string | undefined;
  readonly search?: string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

export interface PaginatedEmployeeNotesResult {
  readonly items: readonly EmployeeNoteSummaryItem[];
  readonly total: number; // count
  readonly page: number;
  readonly limit: number;
}

export type { MyNotepad, MyNotepadHistoryItem };
