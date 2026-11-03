import type { Action } from '@tapcrm/contracts';
import { route } from '../../platform/http/route.js';
import { loadSiteResource } from './policy.js';
import * as service from './service.js';
import { generateSeoReport } from './report.js';
import { registerContentRoutes } from './content-routes.js';
import {
  createSiteSchema,
  updateSiteSchema,
  gscSyncSchema,
  findingQuerySchema,
  findingsTrendQuerySchema,
  updateFindingSchema,
  gscMetricsQuerySchema,
  paginationQuery,
  fixProposalStatusQuery,
  updateFixProposalSchema,
  updateRuleSchema,
  alertIdParam,
  siteIdParam,
  scanRunIdParam,
  findingIdParam,
  fixProposalIdParam,
  ruleIdParam,
} from './validators.js';

const MODULE = 'seo-intelligence';

export function registerSeoRoutes(): void {
  registerContentRoutes();
  // ─── Sites ───────────────────────────────────────────────────────────────

  route({
    method: 'GET',
    path: '/api/seo/sites',
    action: 'seo:list-sites' as Action,
    module: MODULE,
    handler: async ({ ctx }) => {
      return service.getSiteList(ctx);
    },
  });

  route({
    method: 'POST',
    path: '/api/seo/sites',
    action: 'seo:create-site' as Action,
    module: MODULE,
    status: 201,
    handler: async ({ ctx, body }) => {
      const input = createSiteSchema.parse(body);
      return service.registerSite(ctx, input);
    },
  });

  route({
    method: 'GET',
    path: '/api/seo/sites/:siteId',
    action: 'seo:read-site' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, siteId) => loadSiteResource(ctx, siteId),
    handler: async ({ ctx, params }) => {
      const { siteId } = siteIdParam.parse(params);
      return service.getSiteDetail(ctx, siteId);
    },
  });

  route({
    method: 'PATCH',
    path: '/api/seo/sites/:siteId',
    action: 'seo:update-site' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, siteId) => loadSiteResource(ctx, siteId),
    handler: async ({ ctx, params, body }) => {
      const { siteId } = siteIdParam.parse(params);
      const patch = updateSiteSchema.parse(body);
      return service.patchSite(ctx, siteId, {
        ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
        ...(patch.businessIntents !== undefined
          ? { business_intents: patch.businessIntents }
          : {}),
        ...(patch.stackNotes !== undefined ? { stack_notes: patch.stackNotes } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
      });
    },
  });

  // ─── Scans ───────────────────────────────────────────────────────────────

  route({
    method: 'GET',
    path: '/api/seo/sites/:siteId/scans',
    action: 'seo:list-scans' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, siteId) => loadSiteResource(ctx, siteId),
    handler: async ({ ctx, params }) => {
      const { siteId } = siteIdParam.parse(params);
      return service.getScanList(ctx, siteId);
    },
  });

  route({
    method: 'POST',
    path: '/api/seo/sites/:siteId/scans',
    action: 'seo:trigger-scan' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, siteId) => loadSiteResource(ctx, siteId),
    status: 202,
    handler: async ({ ctx, params }) => {
      const { siteId } = siteIdParam.parse(params);
      const triggeredBy =
        ctx.principal.accountType !== 'service' ? ctx.principal.id : 'system';
      return service.triggerScan(ctx, siteId, triggeredBy);
    },
  });

  route({
    method: 'GET',
    path: '/api/seo/scans/:scanRunId',
    action: 'seo:read-scan' as Action,
    module: MODULE,
    handler: async ({ ctx, params }) => {
      const { scanRunId } = scanRunIdParam.parse(params);
      return service.getScanDetail(ctx, scanRunId);
    },
  });

  // ─── Findings ─────────────────────────────────────────────────────────────

  route({
    method: 'GET',
    path: '/api/seo/sites/:siteId/findings',
    action: 'seo:list-findings' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, siteId) => loadSiteResource(ctx, siteId),
    handler: async ({ ctx, params, query }) => {
      const { siteId } = siteIdParam.parse(params);
      const opts = findingQuerySchema.omit({ siteId: true }).parse(query);
      return service.getFindings(ctx, siteId, opts);
    },
  });

  route({
    method: 'GET',
    path: '/api/seo/sites/:siteId/finding-groups',
    action: 'seo:list-finding-groups' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, siteId) => loadSiteResource(ctx, siteId),
    handler: async ({ ctx, params }) => {
      const { siteId } = siteIdParam.parse(params);
      return service.getFindingGroups(ctx, siteId);
    },
  });

  route({
    method: 'GET',
    path: '/api/seo/sites/:siteId/findings-trend',
    action: 'seo:read-findings-trend' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, siteId) => loadSiteResource(ctx, siteId),
    handler: async ({ ctx, params, query }) => {
      const { siteId } = siteIdParam.parse(params);
      const { days } = findingsTrendQuerySchema.parse(query);
      return service.getFindingsTrend(ctx, siteId, days);
    },
  });

  route({
    method: 'GET',
    path: '/api/seo/findings/:findingId',
    action: 'seo:read-finding' as Action,
    module: MODULE,
    handler: async ({ ctx, params }) => {
      const { findingId } = findingIdParam.parse(params);
      return service.getFindingDetail(ctx, findingId);
    },
  });

  route({
    method: 'PATCH',
    path: '/api/seo/findings/:findingId',
    action: 'seo:update-finding' as Action,
    module: MODULE,
    handler: async ({ ctx, params, body }) => {
      const { findingId } = findingIdParam.parse(params);
      const patch = updateFindingSchema.parse(body);
      return service.updateFindingStatus(ctx, findingId, patch);
    },
  });

  // ─── GSC / Search Performance ─────────────────────────────────────────────

  route({
    method: 'GET',
    path: '/api/seo/sites/:siteId/gsc-metrics',
    action: 'seo:read-search-performance' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, siteId) => loadSiteResource(ctx, siteId),
    handler: async ({ ctx, params, query }) => {
      const { siteId } = siteIdParam.parse(params);
      const opts = gscMetricsQuerySchema.omit({ siteId: true }).parse(query);
      return service.getGscMetrics(ctx, siteId, opts);
    },
  });

  route({
    method: 'POST',
    path: '/api/seo/sites/:siteId/gsc-sync',
    action: 'seo:sync-search-performance' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, siteId) => loadSiteResource(ctx, siteId),
    status: 202,
    handler: async ({ ctx, params, body }) => {
      const { siteId } = siteIdParam.parse(params);
      const input = gscSyncSchema.omit({ siteId: true }).parse(body);
      return service.syncGscData(
        ctx,
        siteId,
        input.propertyUrl,
        input.startDate,
        input.endDate,
      );
    },
  });

  // ─── Keywords ─────────────────────────────────────────────────────────────

  route({
    method: 'GET',
    path: '/api/seo/sites/:siteId/keywords',
    action: 'seo:list-keywords' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, siteId) => loadSiteResource(ctx, siteId),
    handler: async ({ ctx, params }) => {
      const { siteId } = siteIdParam.parse(params);
      return service.getKeywords(ctx, siteId);
    },
  });

  // ─── Rank Tracking ────────────────────────────────────────────────────────

  route({
    method: 'GET',
    path: '/api/seo/sites/:siteId/rank-status',
    action: 'seo:read-rank-tracking' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, id) => loadSiteResource(ctx, id),
    handler: async ({ ctx, params }) =>
      service.getRankStatus(ctx, siteIdParam.parse(params).siteId),
  });
  route({
    method: 'POST',
    path: '/api/seo/sites/:siteId/rank-checks',
    action: 'seo:sync-search-performance' as Action,
    module: MODULE,
    status: 202,
    resourceParam: 'siteId',
    loadResource: (ctx, id) => loadSiteResource(ctx, id),
    handler: async ({ ctx, params }) =>
      service.queueRankCheck(ctx, siteIdParam.parse(params).siteId),
  });

  route({
    method: 'GET',
    path: '/api/seo/sites/:siteId/serp-observations',
    action: 'seo:read-rank-tracking' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, siteId) => loadSiteResource(ctx, siteId),
    handler: async ({ ctx, params, query }) => {
      const { siteId } = siteIdParam.parse(params);
      const opts = paginationQuery.parse(query);
      return service.getSerpObservations(ctx, siteId, opts);
    },
  });

  // ─── AI Visibility ────────────────────────────────────────────────────────

  route({
    method: 'GET',
    path: '/api/seo/sites/:siteId/ai-observations',
    action: 'seo:read-ai-visibility' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, siteId) => loadSiteResource(ctx, siteId),
    handler: async ({ ctx, params, query }) => {
      const { siteId } = siteIdParam.parse(params);
      const opts = paginationQuery.parse(query);
      return service.getAiObservations(ctx, siteId, opts);
    },
  });

  // ─── Backlinks ────────────────────────────────────────────────────────────

  route({
    method: 'GET',
    path: '/api/seo/sites/:siteId/backlinks',
    action: 'seo:read-backlinks' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, siteId) => loadSiteResource(ctx, siteId),
    handler: async ({ ctx, params, query }) => {
      const { siteId } = siteIdParam.parse(params);
      const opts = paginationQuery.parse(query);
      return service.getBacklinks(ctx, siteId, opts);
    },
  });

  // ─── Core Web Vitals ──────────────────────────────────────────────────────

  route({
    method: 'GET',
    path: '/api/seo/sites/:siteId/performance-status',
    action: 'seo:read-cwv' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, id) => loadSiteResource(ctx, id),
    handler: async ({ ctx, params }) =>
      service.getSitePerformanceStatus(ctx, siteIdParam.parse(params).siteId),
  });
  route({
    method: 'POST',
    path: '/api/seo/sites/:siteId/performance-refresh',
    action: 'seo:trigger-scan' as Action,
    module: MODULE,
    status: 202,
    resourceParam: 'siteId',
    loadResource: (ctx, id) => loadSiteResource(ctx, id),
    handler: async ({ ctx, params }) =>
      service.queuePerformanceRefresh(ctx, siteIdParam.parse(params).siteId),
  });

  route({
    method: 'GET',
    path: '/api/seo/sites/:siteId/cwv-observations',
    action: 'seo:read-cwv' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, siteId) => loadSiteResource(ctx, siteId),
    handler: async ({ ctx, params, query }) => {
      const { siteId } = siteIdParam.parse(params);
      const opts = paginationQuery.parse(query);
      return service.getCwvObservations(ctx, siteId, opts);
    },
  });

  // ─── Fix Proposals ────────────────────────────────────────────────────────

  route({
    method: 'GET',
    path: '/api/seo/sites/:siteId/fix-proposals',
    action: 'seo:list-fixes' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, siteId) => loadSiteResource(ctx, siteId),
    handler: async ({ ctx, params, query }) => {
      const { siteId } = siteIdParam.parse(params);
      const opts = fixProposalStatusQuery.parse(query);
      return service.getFixProposals(ctx, siteId, opts);
    },
  });

  route({
    method: 'PATCH',
    path: '/api/seo/fix-proposals/:proposalId',
    action: 'seo:update-fix' as Action,
    module: MODULE,
    handler: async ({ ctx, params, body }) => {
      const { proposalId } = fixProposalIdParam.parse(params);
      const patch = updateFixProposalSchema.parse(body);
      return service.patchFixProposal(ctx, proposalId, patch);
    },
  });

  // ─── Monitoring / Alerts ──────────────────────────────────────────────────

  route({
    method: 'GET',
    path: '/api/seo/sites/:siteId/alerts',
    action: 'seo:list-alerts' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, siteId) => loadSiteResource(ctx, siteId),
    handler: async ({ ctx, params }) => {
      const { siteId } = siteIdParam.parse(params);
      return service.getAlerts(ctx, siteId);
    },
  });

  route({
    method: 'PATCH',
    path: '/api/seo/alerts/:alertId',
    action: 'seo:acknowledge-alert' as Action,
    module: MODULE,
    handler: async ({ ctx, params }) => {
      const { alertId } = alertIdParam.parse(params);
      const actorId =
        ctx.principal.accountType !== 'service' ? ctx.principal.id : 'system';
      return service.acknowledgeAlert(ctx, alertId, actorId);
    },
  });

  // ─── Report Export ────────────────────────────────────────────────────────

  route({
    method: 'POST',
    path: '/api/seo/sites/:siteId/report',
    action: 'seo:export-report' as Action,
    module: MODULE,
    resourceParam: 'siteId',
    loadResource: (ctx, siteId) => loadSiteResource(ctx, siteId),
    handler: async ({ ctx, params, res }) => {
      const { siteId } = siteIdParam.parse(params);
      const pdf = await generateSeoReport(ctx, siteId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="tapvera-seo-report-${siteId}.pdf"`,
      );
      res.send(pdf);
      return null;
    },
  });

  // ─── Rules ────────────────────────────────────────────────────────────────

  route({
    method: 'GET',
    path: '/api/seo/rules',
    action: 'seo:list-rules' as Action,
    module: MODULE,
    handler: async ({ ctx }) => {
      return service.getRules(ctx);
    },
  });

  route({
    method: 'PATCH',
    path: '/api/seo/rules/:ruleId',
    action: 'seo:update-rule' as Action,
    module: MODULE,
    handler: async ({ ctx, params, body }) => {
      const { ruleId } = ruleIdParam.parse(params);
      const patch = updateRuleSchema.parse(body);
      return service.patchRule(ctx, ruleId, patch);
    },
  });
}
