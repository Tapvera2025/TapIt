import { identityRequest } from '../../../identity/api/authApi.js';

export interface Budget { id: string; projectId: string; projectName: string; name: string; currency: string; periodStart: string; periodEnd: string; status: string; budgetTotal: string; }
export interface Margin { id: string; projectId: string; projectName: string; clientName: string; currency: string; revenue: string; directCost: string; sharedCost: string; advertisingCost: string; contribution: string; contributionPercent: string | null; }
export interface Leakage { id: string; projectId: string; projectName: string; clientName: string; findingType: string; severity: string; amount: string; status: string; evidence: Record<string, unknown>; }
export interface Metric { id: string; projectId: string; projectName: string; billableHours: string; availableHours: string; utilizationPercent: string | null; realizationPercent: string | null; }
export interface AdvertisingAccount { id: string; provider: string; externalAccountId: string; name: string; fundingModel: string; currency: string; status: string; lastSyncAt: string | null; lastSyncStatus: string | null; stale: boolean; }
export interface AllocationRun { id: string; periodStart: string; periodEnd: string; driver: string; status: string; manifestSha256: string; createdBy: string; approvedBy: string | null; }

export const listBudgets = () => identityRequest<Budget[]>('/api/profitability/budgets');
export const listMargins = (periodStart: string, periodEnd: string) => identityRequest<Margin[]>(`/api/profitability/margins?periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`);
export const listLeakage = () => identityRequest<Leakage[]>('/api/profitability/leakage');
export const listMetrics = () => identityRequest<Metric[]>('/api/profitability/metrics');
export const listAdvertisingAccounts = () => identityRequest<AdvertisingAccount[]>('/api/profitability/advertising/accounts');
export const listAllocationRuns = () => identityRequest<AllocationRun[]>('/api/profitability/allocation-runs');
export const scanLeakage = (periodStart: string, periodEnd: string) => identityRequest('/api/profitability/leakage/scan', { method: 'POST', body: JSON.stringify({ periodStart, periodEnd }) });
export const createBudget = (body: Record<string, unknown>) => identityRequest('/api/profitability/budgets', { method: 'POST', body: JSON.stringify(body) });
export const approveBudget = (id: string) => identityRequest(`/api/profitability/budgets/${id}/approve`, { method: 'POST', body: JSON.stringify({ reason: 'Budget approved by Finance.' }) });
export const createCostRate = (body: Record<string, unknown>) => identityRequest('/api/profitability/cost-rates', { method: 'POST', body: JSON.stringify(body) });
export const createTimeCost = (body: Record<string, unknown>) => identityRequest('/api/profitability/time-costs', { method: 'POST', body: JSON.stringify(body) });
export const createDirectCost = (body: Record<string, unknown>) => identityRequest('/api/profitability/direct-costs', { method: 'POST', body: JSON.stringify(body) });
export const importPayrollCosts = (body: Record<string, unknown>) => identityRequest('/api/profitability/payroll-costs/import', { method: 'POST', body: JSON.stringify(body) });
export const recordRevenue = (body: Record<string, unknown>) => identityRequest('/api/profitability/revenue', { method: 'POST', body: JSON.stringify(body) });
export const createAllocation = (body: Record<string, unknown>) => identityRequest('/api/profitability/allocations', { method: 'POST', body: JSON.stringify(body) });
export const approveAllocation = (id: string) => identityRequest(`/api/profitability/allocations/${id}/approve`, { method: 'POST', body: JSON.stringify({ reason: 'Allocation approved by Finance.' }) });
export const refreshMetric = (body: Record<string, unknown>) => identityRequest('/api/profitability/metrics/refresh', { method: 'POST', body: JSON.stringify(body) });
export const refreshMargin = (body: Record<string, unknown>) => identityRequest('/api/profitability/margins/refresh', { method: 'POST', body: JSON.stringify(body) });
export const decideLeakage = (id: string, status: 'acknowledged' | 'resolved') => identityRequest(`/api/profitability/leakage/${id}/decision`, { method: 'POST', body: JSON.stringify({ status, resolution: 'Reviewed by Finance.' }) });
export const createAdvertisingAccount = (body: Record<string, unknown>) => identityRequest('/api/profitability/advertising/accounts', { method: 'POST', body: JSON.stringify(body) });
export const syncAdvertisingAccount = (id: string, periodStart: string, periodEnd: string) => identityRequest(`/api/profitability/advertising/accounts/${id}/sync`, { method: 'POST', body: JSON.stringify({ periodStart, periodEnd }) });
export const addManualSpend = (id: string, body: Record<string, unknown>) => identityRequest(`/api/profitability/advertising/accounts/${id}/manual-spend`, { method: 'POST', body: JSON.stringify(body) });
export const configureAdvertisingCredentials = (id: string, credentials: Record<string, string>) => identityRequest(`/api/profitability/advertising/accounts/${id}/credentials`, { method: 'POST', body: JSON.stringify({ credentials, reason: 'Advertising credentials configured by Finance.' }) });
