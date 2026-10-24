import { route } from '../../../platform/http/route.js';
import { decimal } from '@tapcrm/contracts';
import {
  createAccount,
  closePeriod,
  createJournal,
  createPeriod,
  getAccountBalances,
  getPeriods,
  loadAccountingPeriodResource,
  loadJournalEntryResource,
  loadLedgerAccountResource,
  listAccounts,
  listJournals,
  reopenPeriod,
  reverseJournal,
  updateAccount,
  updateChecklist,
} from './service.js';
import {
  getBalanceSheet,
  getCashFlow,
  getGeneralLedger,
  getProfitAndLoss,
  getTrialBalance,
  exportAccountingReport,
} from './reports.js';
import {
  accountIdSchema,
  accountListQuerySchema,
  balanceQuerySchema,
  closeChecklistSchema,
  createAccountSchema,
  createJournalSchema,
  createPeriodSchema,
  journalListQuerySchema,
  periodListQuerySchema,
  reopenPeriodSchema,
  reverseJournalSchema,
  updateAccountSchema,
  reportWindowQuerySchema,
  statementReportKindSchema,
  gstr2bImportSchema,
} from './validators.js';
import {
  downloadTaxArtifact,
  exportGstr1,
  exportGstr3b,
  exportTds,
  exportTdsReceivableReconciliation,
  importGstr2b,
  listTaxArtifacts,
  reconcileGstr2b,
} from './tax.js';

export function registerAccountingRoutes(): void {
  route({ method: 'POST', path: '/api/accounting/tax/gstr1', action: 'accounting:tax-export', module: 'accounting', handler: async ({ ctx, query }) => exportGstr1(ctx, reportWindowQuerySchema.parse(query)) });
  route({ method: 'POST', path: '/api/accounting/tax/gstr3b', action: 'accounting:tax-export', module: 'accounting', handler: async ({ ctx, query }) => exportGstr3b(ctx, reportWindowQuerySchema.parse(query)) });
  route({ method: 'POST', path: '/api/accounting/tax/tds', action: 'accounting:tax-export', module: 'accounting', handler: async ({ ctx, query }) => exportTds(ctx, reportWindowQuerySchema.parse(query)) });
  route({ method: 'POST', path: '/api/accounting/tax/tds-receivable/reconciliation', action: 'accounting:tax-export', module: 'accounting', handler: async ({ ctx, query }) => exportTdsReceivableReconciliation(ctx, reportWindowQuerySchema.parse(query)) });
  route({ method: 'POST', path: '/api/accounting/tax/gstr2b/import', action: 'accounting:tax-export', module: 'accounting', status: 201, handler: async ({ ctx, body }) => importGstr2b(ctx, gstr2bImportSchema.parse(body)) });
  route({ method: 'GET', path: '/api/accounting/tax/gstr2b/:id/reconciliation', action: 'accounting:tax-export', module: 'accounting', handler: async ({ ctx, params }) => reconcileGstr2b(ctx, params['id'] as string) });
  route({ method: 'GET', path: '/api/accounting/tax/artifacts', action: 'accounting:tax-export', module: 'accounting', handler: async ({ ctx }) => listTaxArtifacts(ctx) });
  route({ method: 'GET', path: '/api/accounting/tax/artifacts/:id/download', action: 'accounting:tax-export', module: 'accounting', handler: async ({ ctx, params, res }) => { const file = await downloadTaxArtifact(ctx, params['id'] as string); res.setHeader('Content-Type', file.row.mimeType); res.setHeader('Content-Disposition', `attachment; filename="${file.row.filename.replaceAll('"', '')}"`); res.send(file.body); return null; } });
  route({
    method: 'GET',
    path: '/api/accounting/ledger',
    action: 'accounting:view-ledger',
    module: 'accounting',
    handler: async ({ ctx, query }) =>
      getAccountBalances(ctx, balanceQuerySchema.parse(query)),
  });
  route({
    method: 'GET',
    path: '/api/accounting/trial-balance',
    action: 'accounting:view-ledger',
    module: 'accounting',
    handler: async ({ ctx, query }) =>
      getTrialBalance(ctx, reportWindowQuerySchema.parse(query)),
  });
  route({
    method: 'GET',
    path: '/api/accounting/general-ledger',
    action: 'accounting:view-ledger',
    module: 'accounting',
    handler: async ({ ctx, query }) =>
      getGeneralLedger(ctx, reportWindowQuerySchema.parse(query)),
  });
  route({
    method: 'GET',
    path: '/api/accounting/reports/trial-balance',
    action: 'accounting:view-ledger',
    module: 'accounting',
    handler: async ({ ctx, query }) =>
      getTrialBalance(ctx, reportWindowQuerySchema.parse(query)),
  });
  route({
    method: 'GET',
    path: '/api/accounting/reports/pnl',
    action: 'accounting:view-statements',
    module: 'accounting',
    handler: async ({ ctx, query }) =>
      getProfitAndLoss(ctx, reportWindowQuerySchema.parse(query)),
  });
  route({
    method: 'GET',
    path: '/api/accounting/reports/balance-sheet',
    action: 'accounting:view-statements',
    module: 'accounting',
    handler: async ({ ctx, query }) =>
      getBalanceSheet(ctx, reportWindowQuerySchema.parse(query)),
  });
  route({
    method: 'GET',
    path: '/api/accounting/reports/cash-flow',
    action: 'accounting:view-statements',
    module: 'accounting',
    handler: async ({ ctx, query }) =>
      getCashFlow(ctx, reportWindowQuerySchema.parse(query)),
  });
  route({
    method: 'GET',
    path: '/api/accounting/accounts/:id/drill-through',
    action: 'accounting:view-ledger',
    module: 'accounting',
    resourceParam: 'id',
    loadResource: loadLedgerAccountResource,
    handler: async ({ ctx, params, query }) =>
      getGeneralLedger(
        ctx,
        reportWindowQuerySchema.parse(query),
        accountIdSchema.parse(params).id,
      ),
  });
  route({
    method: 'GET',
    path: '/api/accounting/general-ledger/export',
    action: 'accounting:view-ledger',
    module: 'accounting',
    handler: async ({ ctx, query, res }) => {
      const parsed = reportWindowQuerySchema.parse(query);
      const file = await exportAccountingReport(
        ctx,
        'general-ledger',
        parsed,
        parsed.accountId,
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.send(file.body);
      return null;
    },
  });
  route({
    method: 'GET',
    path: '/api/accounting/trial-balance/export',
    action: 'accounting:view-ledger',
    module: 'accounting',
    handler: async ({ ctx, query, res }) => {
      const file = await exportAccountingReport(
        ctx,
        'trial-balance',
        reportWindowQuerySchema.parse(query),
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.send(file.body);
      return null;
    },
  });
  route({
    method: 'GET',
    path: '/api/accounting/reports/:kind/export',
    action: 'accounting:view-statements',
    module: 'accounting',
    handler: async ({ ctx, params, query, res }) => {
      const kind = statementReportKindSchema.parse(params['kind']);
      const file = await exportAccountingReport(
        ctx,
        kind,
        reportWindowQuerySchema.parse(query),
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.send(file.body);
      return null;
    },
  });
  route({
    method: 'GET',
    path: '/api/accounting/journals',
    action: 'accounting:view-ledger',
    module: 'accounting',
    handler: async ({ ctx, query }) =>
      listJournals(ctx, journalListQuerySchema.parse(query)),
  });
  route({
    method: 'POST',
    path: '/api/accounting/journals',
    action: 'accounting:post-journal',
    module: 'accounting',
    status: 201,
    handler: async ({ ctx, body }) => {
      const input = createJournalSchema.parse(body);
      return createJournal(ctx, {
        ...input,
        lines: input.lines.map((line) => ({
          ...line,
          debit: decimal(line.debit),
          credit: decimal(line.credit),
        })),
      });
    },
  });
  route({
    method: 'POST',
    path: '/api/accounting/journals/:id/reverse',
    action: 'accounting:post-journal',
    module: 'accounting',
    resourceParam: 'id',
    loadResource: loadJournalEntryResource,
    handler: async ({ ctx, params, body }) =>
      reverseJournal(ctx, params['id'] as string, reverseJournalSchema.parse(body)),
  });
  route({
    method: 'GET',
    path: '/api/accounting/accounts',
    action: 'accounting:view-ledger',
    module: 'accounting',
    handler: async ({ ctx, query }) =>
      listAccounts(ctx, accountListQuerySchema.parse(query).status),
  });
  route({
    method: 'POST',
    path: '/api/accounting/accounts',
    action: 'accounting:manage-accounts',
    module: 'accounting',
    status: 201,
    handler: async ({ ctx, body }) => createAccount(ctx, createAccountSchema.parse(body)),
  });
  route({
    method: 'PATCH',
    path: '/api/accounting/accounts/:id',
    action: 'accounting:manage-accounts',
    module: 'accounting',
    resourceParam: 'id',
    loadResource: loadLedgerAccountResource,
    handler: async ({ ctx, params, body }) =>
      updateAccount(
        ctx,
        accountIdSchema.parse(params).id,
        updateAccountSchema.parse(body),
      ),
  });
  route({
    method: 'GET',
    path: '/api/accounting/periods',
    action: 'accounting:view-ledger',
    module: 'accounting',
    handler: async ({ ctx, query }) =>
      getPeriods(ctx, periodListQuerySchema.parse(query)),
  });
  route({
    method: 'POST',
    path: '/api/accounting/periods',
    action: 'accounting:close-period',
    module: 'accounting',
    status: 201,
    handler: async ({ ctx, body }) => createPeriod(ctx, createPeriodSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/accounting/periods/:id/checklist',
    action: 'accounting:close-period',
    module: 'accounting',
    resourceParam: 'id',
    loadResource: loadAccountingPeriodResource,
    handler: async ({ ctx, params, body }) =>
      updateChecklist(
        ctx,
        accountIdSchema.parse(params).id,
        closeChecklistSchema.parse(body),
      ),
  });
  route({
    method: 'POST',
    path: '/api/accounting/periods/:id/close',
    action: 'accounting:close-period',
    module: 'accounting',
    resourceParam: 'id',
    loadResource: loadAccountingPeriodResource,
    handler: async ({ ctx, params }) =>
      closePeriod(ctx, accountIdSchema.parse(params).id),
  });
  route({
    method: 'POST',
    path: '/api/accounting/periods/:id/reopen',
    action: 'accounting:reopen-period',
    module: 'accounting',
    resourceParam: 'id',
    loadResource: loadAccountingPeriodResource,
    handler: async ({ ctx, params, body }) =>
      reopenPeriod(
        ctx,
        accountIdSchema.parse(params).id,
        reopenPeriodSchema.parse(body).reason,
      ),
  });
}
