import { peopleMutation, peopleRead } from '../../api/client.js';
import type { ExpenseCategory, ExpenseClaim, ExpensePage } from '../types.js';

const query = (values: Record<string, string | number | undefined>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
};
export const listMine = (params: Record<string, string | number | undefined> = {}) => peopleRead<ExpensePage>(`/api/payables/claims/mine?${query(params)}`);
export const listApprovals = (params: Record<string, string | number | undefined> = {}) => peopleRead<ExpensePage>(`/api/payables/claims/approvals?${query(params)}`);
export const getClaim = (id: string) => peopleRead<ExpenseClaim>(`/api/payables/claims/${encodeURIComponent(id)}`);
export const createClaim = (body: { expenseDate: string; amountPaise: number; category: ExpenseCategory; remarks: string; attachments: Array<{ originalFilename: string; mimeType: string; data: string }> }) => peopleMutation<ExpenseClaim>('/api/payables/claims', { method: 'POST', body: JSON.stringify(body) }, ['/api/payables/claims']);
export const updateClaim = (id: string, body: Partial<{ expenseDate: string; amountPaise: number; category: ExpenseCategory; remarks: string }>) => peopleMutation<ExpenseClaim>(`/api/payables/claims/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, ['/api/payables/claims']);
export const deleteClaim = (id: string) => peopleMutation<null>(`/api/payables/claims/${encodeURIComponent(id)}`, { method: 'DELETE' }, ['/api/payables/claims']);
export const approveClaim = (id: string) => peopleMutation<null>(`/api/payables/claims/${encodeURIComponent(id)}/approve`, { method: 'POST' }, ['/api/payables/claims']);
export const rejectClaim = (id: string, rejectionReason: string) => peopleMutation<null>(`/api/payables/claims/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ rejectionReason }) }, ['/api/payables/claims']);
export const attachmentUrl = (claimId: string, attachmentId: string) => `/api/payables/claims/${encodeURIComponent(claimId)}/attachments/${encodeURIComponent(attachmentId)}`;
