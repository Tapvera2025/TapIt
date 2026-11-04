import { identityRequest } from '../../../identity/api/authApi.js';

export interface Entity { id: string; code: string; legalName: string; baseCurrency: string; timezone: string; taxRegistration: Record<string, string>; isActive: boolean; }
export interface Schedule { id: string; scheduleType: string; description: string; totalAmount: string; recognizedAmount: string; currency: string; startDate: string; endDate: string; nextRecognitionDate: string; status: string; }
export interface SyncItem { id: string; provider: string; sourceType: string; sourceId: string; status: string; attempts: number; lastError: string | null; createdAt: string; }
export interface CompletionOverview { entities: Entity[]; schedules: Schedule[]; syncQueue: SyncItem[]; advisory: boolean; storage: string; }
export const getOverview = () => identityRequest<CompletionOverview>('/api/accounting/completion/overview');
export const createEntity = (body: Record<string, unknown>) => identityRequest<Entity>('/api/accounting/completion/entities', { method: 'POST', body: JSON.stringify(body) });
