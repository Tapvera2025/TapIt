import { identityRequest } from '../../../identity/api/authApi.js';

export interface ReceivableAging {
  id: string;
  invoiceNumber: string;
  clientId: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  total: string;
  status: string;
  paidMinor: string;
  outstandingMinor: string;
  daysOverdue: number;
}
export interface AgingBucket {
  currency: string;
  bucket: string;
  invoiceCount: number;
  outstandingMinor: string;
}
export interface CollectionActivity {
  id: string;
  clientId: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  activityType: string;
  channel: string | null;
  status: string;
  scheduledFor: string | null;
  reason: string;
  createdAt: string;
}
export interface Dispute {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  holdCollections: boolean;
  reason: string;
  resolution: string | null;
  createdAt: string;
}
export interface PromiseToPay {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  promisedAmount: string;
  promisedFor: string;
  status: string;
  reason: string;
  createdAt: string;
}
export interface CollectionTask {
  id: string;
  clientId: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  taskType: string;
  status: string;
  dueAt: string;
  title: string;
  reason: string;
  createdAt: string;
}
export interface StatementClient {
  id: string;
  clientName: string;
  businessName: string;
  currency: string;
  invoiceCount: number;
  outstandingMinor: string;
}
export interface StatementLine {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  total: string;
  status: string;
  paidMinor: string;
  outstandingMinor: string;
}
export interface Reminder {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  reminderDate: string;
  localTimezone: string;
  status: string;
  createdAt: string;
}
export interface WriteOff {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  amount: string;
  reason: string;
  status: string;
  journalId: string | null;
}
export const listAging = () =>
  identityRequest<ReceivableAging[]>('/api/receivables/aging');
export const listAgingBuckets = () =>
  identityRequest<AgingBucket[]>('/api/receivables/aging/buckets');
export const listCollections = () =>
  identityRequest<CollectionActivity[]>('/api/receivables/collections');
export const listDisputes = () => identityRequest<Dispute[]>('/api/receivables/disputes');
export const listPromises = () =>
  identityRequest<PromiseToPay[]>('/api/receivables/promises');
export const listTasks = () =>
  identityRequest<CollectionTask[]>('/api/receivables/tasks');
export const listStatementClients = () =>
  identityRequest<StatementClient[]>('/api/receivables/statements');
export const getStatement = (clientId: string) =>
  identityRequest<StatementLine[]>(`/api/receivables/statement/${clientId}`);
export const listReminders = () =>
  identityRequest<Reminder[]>('/api/receivables/reminders');
export const listWriteOffs = () =>
  identityRequest<WriteOff[]>('/api/receivables/write-offs');
export const setDunningSchedule = (body: Record<string, unknown>) =>
  identityRequest('/api/receivables/dunning-schedule', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
export const dunInvoice = (invoiceId: string, reason: string) =>
  identityRequest(`/api/receivables/${invoiceId}/dun`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
export const createDispute = (invoiceId: string, body: Record<string, unknown>) =>
  identityRequest(`/api/receivables/${invoiceId}/disputes`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const createPromise = (invoiceId: string, body: Record<string, unknown>) =>
  identityRequest(`/api/receivables/${invoiceId}/promises`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const updateTask = (id: string, body: Record<string, unknown>) =>
  identityRequest(`/api/receivables/tasks/${id}/status`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const createTask = (body: Record<string, unknown>) =>
  identityRequest('/api/receivables/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const resolveDispute = (id: string, body: Record<string, unknown>) =>
  identityRequest(`/api/receivables/disputes/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const resolvePromise = (id: string, body: Record<string, unknown>) =>
  identityRequest(`/api/receivables/promises/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const proposeWriteOff = (invoiceId: string, body: Record<string, unknown>) =>
  identityRequest(`/api/receivables/${invoiceId}/write-off`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const approveWriteOff = (id: string, reason: string) =>
  identityRequest(`/api/receivables/write-offs/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
