export const EXPENSE_CATEGORIES = [
  'travel', 'food', 'accommodation', 'fuel', 'office_supplies',
  'communication', 'client_expense', 'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type ExpenseStatus = 'pending' | 'approved' | 'rejected';

export interface ExpenseSummary {
  totalCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
}

export interface ExpenseAttachment {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ExpenseClaimRow {
  id: string;
  organizationId: string;
  claimedBy: string;
  employeeCode: string | null;
  employeeName: string;
  departmentName: string | null;
  positionName: string | null;
  expenseDate: string;
  amountPaise: string;
  currency: string;
  category: ExpenseCategory;
  remarks: string;
  status: ExpenseStatus;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewerName: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: ExpenseAttachment[];
}
