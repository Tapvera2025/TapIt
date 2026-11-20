import { identityRequest } from '../../../identity/api/authApi.js';

export interface ClaimsDistributionRow {
  readonly userId: string;
  readonly fullName: string;
  readonly claimsToday: number;
  readonly activeLeads: number;
}

export interface PoolHealthSnapshot {
  readonly openNow: number;
  readonly triageNow: number;
  readonly claimed24h: number;
  readonly fallback24h: number;
  readonly triaged24h: number;
  readonly timeoutRate: number;
}

export function getClaimsDistribution(): Promise<{ rows: ClaimsDistributionRow[] }> {
  return identityRequest('/api/sales/dashboard/claims-distribution');
}

export function getPoolHealth(): Promise<PoolHealthSnapshot> {
  return identityRequest('/api/sales/dashboard/pool-health');
}

export interface SalesOverviewMetrics {
  readonly statuses: ReadonlyArray<{ status: string; count: number; stalled: number }>;
  readonly dailyClaims: ReadonlyArray<{ date: string; count: number }>;
}

export function getSalesOverviewMetrics(): Promise<SalesOverviewMetrics> {
  return identityRequest('/api/sales/dashboard/pool-health?view=overview');
}
