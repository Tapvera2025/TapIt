import { identityRequest } from '../../../identity/api/authApi.js';

export interface Entity {
  id: string;
  code: string;
  legalName: string;
  baseCurrency: string;
  timezone: string;
  taxRegistration: Record<string, string>;
  isActive: boolean;
}
export interface Schedule {
  id: string;
  legalEntityId?: string | null;
  debitAccountId: string;
  creditAccountId: string;
  scheduleType: string;
  description: string;
  totalAmount: string;
  recognizedAmount: string;
  currency: string;
  startDate: string;
  endDate: string;
  nextRecognitionDate: string;
  status: string;
}
export interface SyncItem {
  id: string;
  provider: string;
  sourceType: string;
  sourceId: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}
export interface SyncSource {
  id: string;
  sourceType: string;
  label: string;
  payload: Record<string, unknown>;
}
export interface Revaluation {
  id: string;
  legalEntityId: string | null;
  asOfDate: string;
  baseCurrency: string;
  status: string;
  rates: Array<{
    accountId: string;
    currency: string;
    foreignAmount: string;
    oldBaseAmount: string;
    newBaseAmount: string;
    rate: string;
  }>;
  journalId: string | null;
  createdAt: string;
}
export interface CompletionOverview {
  entities: Entity[];
  schedules: Schedule[];
  revaluations: Revaluation[];
  syncQueue: SyncItem[];
  advisory: boolean;
  storage: string;
}
export interface Paginated<T> {
  items: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}
export const getOverview = () =>
  identityRequest<CompletionOverview>('/api/accounting/completion/overview');
export const listLegalEntities = () =>
  identityRequest<Entity[]>('/api/accounting/completion/entities');
export const listSchedulesPage = (page = 1, pageSize = 6) =>
  identityRequest<Paginated<Schedule>>(
    `/api/accounting/completion/schedules/page?page=${page}&pageSize=${pageSize}`,
  );
export const listRevaluationsPage = (page = 1, pageSize = 6) =>
  identityRequest<Paginated<Revaluation>>(
    `/api/accounting/completion/fx-revaluations?page=${page}&pageSize=${pageSize}`,
  );
export const listSyncQueuePage = (page = 1, pageSize = 6) =>
  identityRequest<Paginated<SyncItem>>(
    `/api/accounting/completion/sync-queue/page?page=${page}&pageSize=${pageSize}`,
  );
export const createEntity = (body: Record<string, unknown>) =>
  identityRequest<Entity>('/api/accounting/completion/entities', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const createSchedule = (body: Record<string, unknown>) =>
  identityRequest('/api/accounting/completion/schedules', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const recognizeSchedule = (id: string, body: Record<string, unknown>) =>
  identityRequest(`/api/accounting/completion/schedules/${id}/recognize`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const createRevaluation = (body: Record<string, unknown>) =>
  identityRequest('/api/accounting/completion/fx-revaluations', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const enqueueSync = (body: Record<string, unknown>) =>
  identityRequest('/api/accounting/completion/sync-queue', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const listSyncSources = (sourceType: 'journal' | 'accounting-schedule') =>
  identityRequest<SyncSource[]>(
    `/api/accounting/completion/sync-sources?sourceType=${encodeURIComponent(sourceType)}`,
  );
