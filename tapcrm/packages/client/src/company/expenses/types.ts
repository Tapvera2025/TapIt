export const EXPENSE_CATEGORIES = ['travel','food','accommodation','fuel','office_supplies','communication','client_expense','other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type ExpenseStatus = 'pending' | 'approved' | 'rejected';
export const CATEGORY_LABELS: Record<ExpenseCategory, string> = { travel: 'Travel', food: 'Food', accommodation: 'Accommodation', fuel: 'Fuel', office_supplies: 'Office Supplies', communication: 'Communication', client_expense: 'Client Expense', other: 'Other' };
export interface ExpenseAttachment { id: string; originalFilename: string; mimeType: string; sizeBytes: number; createdAt: string; }
export interface ExpenseClaim { id: string; claimedBy: string; employeeCode: string | null; employeeName: string; departmentName: string | null; positionName: string | null; expenseDate: string; amountPaise: string; currency: string; category: ExpenseCategory; remarks: string; status: ExpenseStatus; rejectionReason: string | null; reviewerName: string | null; reviewedAt: string | null; createdAt: string; updatedAt: string; attachments: ExpenseAttachment[]; }
export interface ExpensePage {
  rows: ExpenseClaim[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: { totalCount: number; pendingCount: number; approvedCount: number; rejectedCount: number };
}
