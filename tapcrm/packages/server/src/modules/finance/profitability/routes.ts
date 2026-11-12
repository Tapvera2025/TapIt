import { route } from '../../../platform/http/route.js';
import * as service from './service.js';
import * as advertising from './advertising/service.js';
import { parsePagination } from '../pagination.js';
import { advertisingAccountSchema, advertisingCredentialsSchema, advertisingSyncSchema, allocationSchema, budgetSchema, decisionSchema, directCostSchema, leakageDecisionSchema, leakageSchema, marginSchema, metricSchema, manualSpendSchema, payrollImportSchema, rateSchema, revenueSchema, timeCostSchema } from './validators.js';

export function registerProfitabilityRoutes(): void {
  route({ method: 'GET', path: '/api/profitability/budgets', action: 'projects:view-financials', module: 'projects', handler: async ({ ctx, query }) => service.listBudgets(ctx, parsePagination(query)) });
  route({ method: 'GET', path: '/api/profitability/cost-rates', action: 'projects:view-financials', module: 'projects', handler: async ({ ctx, query }) => service.listCostRates(ctx, parsePagination(query)) });
  route({ method: 'GET', path: '/api/profitability/eligible-cost-sources', action: 'projects:view-financials', module: 'projects', handler: async ({ ctx }) => service.listEligibleCostSources(ctx) });
  route({ method: 'GET', path: '/api/profitability/eligible-revenue-sources', action: 'projects:view-financials', module: 'projects', handler: async ({ ctx }) => service.listEligibleRevenueSources(ctx) });
  route({ method: 'GET', path: '/api/profitability/cost-entries', action: 'projects:view-financials', module: 'projects', handler: async ({ ctx, query }) => service.listCostEntries(ctx, parsePagination(query)) });
  route({ method: 'GET', path: '/api/profitability/revenue-entries', action: 'projects:view-financials', module: 'projects', handler: async ({ ctx, query }) => service.listRevenueEntries(ctx, parsePagination(query)) });
  route({ method: 'POST', path: '/api/profitability/budgets', action: 'projects:manage', module: 'projects', status: 201, handler: async ({ ctx, body }) => service.createBudget(ctx, budgetSchema.parse(body)) });
  route({ method: 'POST', path: '/api/profitability/budgets/:id/approve', action: 'projects:manage', module: 'projects', handler: async ({ ctx, params, body }) => service.approveBudget(ctx, params['id']!, decisionSchema.parse(body)) });
  route({ method: 'POST', path: '/api/profitability/cost-rates', action: 'projects:manage', module: 'projects', status: 201, handler: async ({ ctx, body }) => service.createCostRate(ctx, rateSchema.parse(body)) });
  route({ method: 'POST', path: '/api/profitability/time-costs', action: 'projects:manage', module: 'projects', status: 201, handler: async ({ ctx, body }) => service.createTimeCost(ctx, timeCostSchema.parse(body)) });
  route({ method: 'POST', path: '/api/profitability/direct-costs', action: 'projects:manage', module: 'projects', status: 201, handler: async ({ ctx, body }) => service.createDirectCost(ctx, directCostSchema.parse(body)) });
  route({ method: 'POST', path: '/api/profitability/payroll-costs/import', action: 'projects:manage', module: 'projects', status: 201, handler: async ({ ctx, body }) => service.importPublishedPayrollCosts(ctx, payrollImportSchema.parse(body)) });
  route({ method: 'POST', path: '/api/profitability/revenue', action: 'projects:manage', module: 'projects', status: 201, handler: async ({ ctx, body }) => service.recordRevenue(ctx, revenueSchema.parse(body)) });
  route({ method: 'GET', path: '/api/profitability/allocation-runs', action: 'projects:view-financials', module: 'projects', handler: async ({ ctx, query }) => service.listAllocationRuns(ctx, parsePagination(query)) });
  route({ method: 'POST', path: '/api/profitability/allocations', action: 'projects:manage', module: 'projects', status: 201, handler: async ({ ctx, body }) => service.createAllocationRun(ctx, allocationSchema.parse(body)) });
  route({ method: 'POST', path: '/api/profitability/allocations/:id/approve', action: 'projects:manage', module: 'projects', handler: async ({ ctx, params, body }) => service.approveAllocationRun(ctx, params['id']!, decisionSchema.parse(body)) });
  route({ method: 'GET', path: '/api/profitability/margins', action: 'projects:view-financials', module: 'projects', handler: async ({ ctx, query }) => service.listMargins(ctx, typeof query['periodStart'] === 'string' ? query['periodStart'] : '', typeof query['periodEnd'] === 'string' ? query['periodEnd'] : '', parsePagination(query)) });
  route({ method: 'POST', path: '/api/profitability/margins/refresh', action: 'projects:manage', module: 'projects', handler: async ({ ctx, body }) => service.refreshMargin(ctx, marginSchema.parse(body)) });
  route({ method: 'GET', path: '/api/profitability/metrics', action: 'projects:view-financials', module: 'projects', handler: async ({ ctx, query }) => service.listMetrics(ctx, parsePagination(query)) });
  route({ method: 'POST', path: '/api/profitability/metrics/refresh', action: 'projects:manage', module: 'projects', handler: async ({ ctx, body }) => service.refreshMetric(ctx, metricSchema.parse(body)) });
  route({ method: 'GET', path: '/api/profitability/leakage', action: 'projects:view-financials', module: 'projects', handler: async ({ ctx, query }) => service.listLeakage(ctx, parsePagination(query)) });
  route({ method: 'POST', path: '/api/profitability/leakage/scan', action: 'projects:manage', module: 'projects', handler: async ({ ctx, body }) => { const input = leakageSchema.parse(body); return service.scanLeakage(ctx, input.periodStart, input.periodEnd, 'Manual revenue-leakage scan.'); } });
  route({ method: 'POST', path: '/api/profitability/leakage/:id/decision', action: 'projects:manage', module: 'projects', handler: async ({ ctx, params, body }) => service.decideLeakage(ctx, params['id']!, leakageDecisionSchema.parse(body)) });
  route({ method: 'GET', path: '/api/profitability/advertising/accounts', action: 'projects:view-financials', module: 'projects', handler: async ({ ctx, query }) => service.listAdvertisingAccounts(ctx, parsePagination(query)) });
  route({ method: 'GET', path: '/api/profitability/advertising/accounts/:id/spend', action: 'projects:view-financials', module: 'projects', handler: async ({ ctx, params }) => advertising.listManualSpend(ctx, params['id']!) });
  route({ method: 'POST', path: '/api/profitability/advertising/accounts', action: 'projects:manage', module: 'projects', status: 201, handler: async ({ ctx, body }) => advertising.createAccount(ctx, advertisingAccountSchema.parse(body)) });
  route({ method: 'POST', path: '/api/profitability/advertising/accounts/:id/credentials', action: 'projects:manage', module: 'projects', handler: async ({ ctx, params, body }) => advertising.configureCredentials(ctx, params['id']!, advertisingCredentialsSchema.parse(body)) });
  route({ method: 'POST', path: '/api/profitability/advertising/accounts/:id/sync', action: 'projects:manage', module: 'projects', handler: async ({ ctx, params, body }) => advertising.syncAccount(ctx, params['id']!, advertisingSyncSchema.parse(body)) });
  route({ method: 'POST', path: '/api/profitability/advertising/accounts/:id/manual-spend', action: 'projects:manage', module: 'projects', status: 201, handler: async ({ ctx, params, body }) => advertising.createManualSpend(ctx, params['id']!, manualSpendSchema.parse(body)) });
}
