import type { Decimal } from './money.js';

export interface JournalLine {
  readonly id: string;
  readonly accountId: string;
  readonly debit: Decimal;
  readonly credit: Decimal;
  readonly description: string | null;
}

export interface JournalEntry {
  readonly id: string;
  readonly organizationId: string;
  readonly periodId: string;
  readonly entryDate: string;
  readonly description: string;
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly reason: string | null;
  readonly postedBy: string;
  readonly postedAt: Date;
  readonly reversalOfId: string | null;
  readonly lines: readonly JournalLine[];
  readonly debitTotal: Decimal;
  readonly creditTotal: Decimal;
}
