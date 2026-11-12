import { identityRequest } from '../../../identity/api/authApi.js';

export interface Paginated<T> { items: T[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }

export interface Budget { id: string; projectId: string; projectName: string; name: string; currency: string; periodStart: string; periodEnd: string; status: string; budgetTotal: string; }
export interface CostRate { id: string; userId: string | null; employeeName: string | null; roleCode: string | null; currency: string; hourlyRate: string; effectiveFrom: string; effectiveTo: string | null; status: string; }
export interface CostSource { id: string; label: string; vendorName: string | null; invoiceNumber: string; amount: string; currency: string; sourceType: string; }
export interface RevenueSource { id: string; label: string; invoiceNumber: string; amount: string; currency: string; }
export interface CostEntry { id: string; projectId: string | null; projectName: string | null; category: string; allocationMode: string; sourceType: string; sourceId: string; workDate: string; hours: string | null; billableHours: string | null; hourlyRate: string | null; amount: string; currency: string; description: string; }
export interface RevenueEntry { id: string; projectId: string; projectName: string; clientId: string; clientName: string; sourceType: string; sourceId: string; invoiceNumber: string | null; periodStart: string; amount: string; currency: string; reason: string; }
export interface Margin { id: string; projectId: string; projectName: string; clientName: string; currency: string; revenue: string; directCost: string; sharedCost: string; advertisingCost: string; contribution: string; contributionPercent: string | null; }
export interface Leakage { id: string; projectId: string; projectName: string; clientName: string; findingType: string; severity: string; amount: string; status: string; evidence: Record<string, unknown>; }
export interface Metric { id: string; projectId: string; projectName: string; periodStart: string; periodEnd: string; currency: string; billableHours: string; availableHours: string; recognizedRevenue: string; theoreticalValue: string; utilizationPercent: string | null; realizationPercent: string | null; }
export interface AdvertisingAccount { id: string; provider: string; externalAccountId: string; name: string; fundingModel: string; currency: string; status: string; lastSyncAt: string | null; lastSyncStatus: string | null; stale: boolean; }
export interface AdvertisingSpend { id: string; externalSpendId: string; spendDate: string; campaignName: string | null; amount: string; currency: string; projectId: string | null; projectName: string | null; clientId: string | null; clientName: string | null; importedAt: string; }
export interface AllocationRun { id: string; periodStart: string; periodEnd: string; driver: string; status: string; manifestSha256: string; createdBy: string; approvedBy: string | null; }

const pageQuery = (page: number, pageSize: number) => `page=${page}&pageSize=${pageSize}`;
export const listBudgets = (page = 1, pageSize = 6) => identityRequest<Paginated<Budget>>(`/api/profitability/budgets?${pageQuery(page, pageSize)}`);
export const listCostRates = (page = 1, pageSize = 6) => identityRequest<Paginated<CostRate>>(`/api/profitability/cost-rates?${pageQuery(page, pageSize)}`);
export const listEligibleCostSources = () => identityRequest<CostSource[]>('/api/profitability/eligible-cost-sources');
export const listEligibleRevenueSources = () => identityRequest<RevenueSource[]>('/api/profitability/eligible-revenue-sources');
export const listCostEntries = (page = 1, pageSize = 6) => identityRequest<Paginated<CostEntry>>(`/api/profitability/cost-entries?${pageQuery(page, pageSize)}`);
export const listRevenueEntries = (page = 1, pageSize = 6) => identityRequest<Paginated<RevenueEntry>>(`/api/profitability/revenue-entries?${pageQuery(page, pageSize)}`);
export const listMargins = (periodStart: string, periodEnd: string, page = 1, pageSize = 6) => identityRequest<Paginated<Margin>>(`/api/profitability/margins?periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}&${pageQuery(page, pageSize)}`);
export const listLeakage = (page = 1, pageSize = 6) => identityRequest<Paginated<Leakage>>(`/api/profitability/leakage?${pageQuery(page, pageSize)}`);
export const listMetrics = (page = 1, pageSize = 6) => identityRequest<Paginated<Metric>>(`/api/profitability/metrics?${pageQuery(page, pageSize)}`);
export const listAdvertisingAccounts = (page = 1, pageSize = 6) => identityRequest<Paginated<AdvertisingAccount>>(`/api/profitability/advertising/accounts?${pageQuery(page, pageSize)}`);
export const listAdvertisingSpends = (accountId: string) => identityRequest<AdvertisingSpend[]>(`/api/profitability/advertising/accounts/${accountId}/spend`);
export const listAllocationRuns = (page = 1, pageSize = 6) => identityRequest<Paginated<AllocationRun>>(`/api/profitability/allocation-runs?${pageQuery(page, pageSize)}`);
export const scanLeakage = (periodStart: string, periodEnd: string) => identityRequest('/api/profitability/leakage/scan', { method: 'POST', body: JSON.stringify({ periodStart, periodEnd }) });
export const createBudget = (body: Record<string, unknown>) => identityRequest('/api/profitability/budgets', { method: 'POST', body: JSON.stringify(body) });
export const approveBudget = (id: string, reason: string) => identityRequest(`/api/profitability/budgets/${id}/approve`, { method: 'POST', body: JSON.stringify({ reason }) });
export const createCostRate = (body: Record<string, unknown>) => identityRequest('/api/profitability/cost-rates', { method: 'POST', body: JSON.stringify(body) });
export const createTimeCost = (body: Record<string, unknown>) => identityRequest('/api/profitability/time-costs', { method: 'POST', body: JSON.stringify(body) });
export const createDirectCost = (body: Record<string, unknown>) => identityRequest('/api/profitability/direct-costs', { method: 'POST', body: JSON.stringify(body) });
export const importPayrollCosts = (body: Record<string, unknown>) => identityRequest('/api/profitability/payroll-costs/import', { method: 'POST', body: JSON.stringify(body) });
export const recordRevenue = (body: Record<string, unknown>) => identityRequest('/api/profitability/revenue', { method: 'POST', body: JSON.stringify(body) });
export const createAllocation = (body: Record<string, unknown>) => identityRequest('/api/profitability/allocations', { method: 'POST', body: JSON.stringify(body) });
export const approveAllocation = (id: string, reason: string) => identityRequest(`/api/profitability/allocations/${id}/approve`, { method: 'POST', body: JSON.stringify({ reason }) });
export const refreshMetric = (body: Record<string, unknown>) => identityRequest('/api/profitability/metrics/refresh', { method: 'POST', body: JSON.stringify(body) });
export const refreshMargin = (body: Record<string, unknown>) => identityRequest('/api/profitability/margins/refresh', { method: 'POST', body: JSON.stringify(body) });
export const decideLeakage = (id: string, status: 'acknowledged' | 'resolved', resolution = 'Reviewed by Finance.') => identityRequest(`/api/profitability/leakage/${id}/decision`, { method: 'POST', body: JSON.stringify({ status, resolution }) });
export const createAdvertisingAccount = (body: Record<string, unknown>) => identityRequest('/api/profitability/advertising/accounts', { method: 'POST', body: JSON.stringify(body) });
export const syncAdvertisingAccount = (id: string, periodStart: string, periodEnd: string) => identityRequest(`/api/profitability/advertising/accounts/${id}/sync`, { method: 'POST', body: JSON.stringify({ periodStart, periodEnd }) });
export const addManualSpend = (id: string, body: Record<string, unknown>) => identityRequest(`/api/profitability/advertising/accounts/${id}/manual-spend`, { method: 'POST', body: JSON.stringify(body) });
export const configureAdvertisingCredentials = (id: string, credentials: Record<string, string>, reason = 'Advertising credentials configured by Finance.') => identityRequest(`/api/profitability/advertising/accounts/${id}/credentials`, { method: 'POST', body: JSON.stringify({ credentials, reason }) });
