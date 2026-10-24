import { visibilityFilter, type SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { AccountingValidationError, ACCOUNTING_ERROR_CODES } from './errors.js';

export interface ReportWindowQuery {
  readonly periodId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly comparePeriodId?: string | undefined;
  readonly compareFrom?: string | undefined;
  readonly compareTo?: string | undefined;
  readonly accountId?: string | undefined;
}

interface ReportWindow {
  readonly from: string;
  readonly to: string;
}

interface LedgerRow {
  readonly journalId: string;
  readonly entryDate: string;
  readonly description: string;
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountType: string;
  readonly systemKey: string | null;
  readonly debit: string;
  readonly credit: string;
}

interface AccountTotal {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountType: string;
  readonly systemKey: string | null;
  readonly debit: string;
  readonly credit: string;
}

type ReportKind =
  'general-ledger' | 'trial-balance' | 'pnl' | 'balance-sheet' | 'cash-flow';

function cents(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}

function amount(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function net(debit: string, credit: string): bigint {
  return cents(debit) - cents(credit);
}

function financialYearStart(date: string): string {
  const year = Number(date.slice(0, 4));
  return `${date.slice(5, 7) >= '04' ? year : year - 1}-04-01`;
}

function sum(rows: readonly { debit: string; credit: string }[]): {
  debit: string;
  credit: string;
  balance: string;
} {
  let debit = 0n;
  let credit = 0n;
  for (const row of rows) {
    debit += cents(row.debit);
    credit += cents(row.credit);
  }
  return {
    debit: amount(debit),
    credit: amount(credit),
    balance: amount(debit - credit),
  };
}

async function resolveWindow(
  ctx: RequestContext,
  query: ReportWindowQuery,
  prefix: 'current' | 'compare' = 'current',
): Promise<ReportWindow> {
  const periodId = prefix === 'current' ? query.periodId : query.comparePeriodId;
  const from = prefix === 'current' ? query.from : query.compareFrom;
  const to = prefix === 'current' ? query.to : query.compareTo;

  if (periodId) {
    const period = await db.maybeOne<{ periodStart: string; periodEnd: string }>(
      ctx,
      sql`
      SELECT period_start::text AS "periodStart", period_end::text AS "periodEnd"
      FROM accounting_period
      WHERE organization_id = ${ctx.organizationId} AND id = ${periodId}
    `,
    );
    if (!period)
      throw new AccountingValidationError(
        'The requested accounting period was not found.',
        ACCOUNTING_ERROR_CODES.PERIOD_NOT_FOUND,
      );
    return { from: period.periodStart, to: period.periodEnd };
  }

  if (!from || !to || from > to) {
    throw new AccountingValidationError(
      'A valid report date range is required.',
      ACCOUNTING_ERROR_CODES.INVALID_PERIOD,
    );
  }
  return { from, to };
}

async function reportFilter(ctx: RequestContext): Promise<SqlFragment> {
  return visibilityFilter(ctx, 'accounting:view-ledger', 'journalEntry');
}

async function ledgerRows(
  ctx: RequestContext,
  filter: SqlFragment,
  from: string | undefined,
  to: string,
  accountId?: string,
): Promise<LedgerRow[]> {
  const fromClause = from ? sql`AND je.entry_date >= ${from}::date` : sql``;
  const accountClause = accountId ? sql`AND la.id = ${accountId}` : sql``;
  return db.query<LedgerRow>(
    ctx,
    sql`
    SELECT je.id AS "journalId", je.entry_date::text AS "entryDate", je.description,
           je.source_type AS "sourceType", je.source_id AS "sourceId",
           la.id AS "accountId", la.code AS "accountCode", la.name AS "accountName",
           la.account_type AS "accountType", la.system_key AS "systemKey",
           jl.debit::text AS debit, jl.credit::text AS credit
    FROM journal_entry je
    JOIN journal_line jl ON jl.organization_id = je.organization_id AND jl.journal_entry_id = je.id
    JOIN ledger_account la ON la.organization_id = jl.organization_id AND la.id = jl.ledger_account_id
    WHERE je.organization_id = ${ctx.organizationId}
      AND (${filter}) ${fromClause} AND je.entry_date <= ${to}::date ${accountClause}
    ORDER BY je.entry_date, je.posted_at, je.id, jl.id
  `,
  );
}

async function accountTotals(
  ctx: RequestContext,
  filter: SqlFragment,
  from: string | undefined,
  to: string,
  accountTypes?: readonly string[],
): Promise<AccountTotal[]> {
  const fromClause = from ? sql`AND je.entry_date >= ${from}::date` : sql``;
  const typeClause = accountTypes
    ? sql`AND la.account_type = ANY(${accountTypes}::text[])`
    : sql``;
  return db.query<AccountTotal>(
    ctx,
    sql`
    SELECT la.id AS "accountId", la.code AS "accountCode", la.name AS "accountName",
           la.account_type AS "accountType", la.system_key AS "systemKey",
           COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.debit ELSE 0 END), 0)::text AS debit,
           COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.credit ELSE 0 END), 0)::text AS credit
    FROM ledger_account la
    LEFT JOIN journal_line jl ON jl.organization_id = la.organization_id AND jl.ledger_account_id = la.id
    LEFT JOIN journal_entry je ON je.organization_id = jl.organization_id AND je.id = jl.journal_entry_id
      AND je.entry_date <= ${to}::date ${fromClause}
    WHERE la.organization_id = ${ctx.organizationId} ${typeClause}
      AND (je.id IS NULL OR (${filter}))
    GROUP BY la.id
    ORDER BY la.code
  `,
  );
}

function comparative<T extends { accountId: string; balance: string }>(
  current: T[],
  prior: T[],
): Array<T & { comparativeBalance: string; variance: string }> {
  const priorMap = new Map(prior.map((row) => [row.accountId, row]));
  return current.map((row) => {
    const comparativeBalance = priorMap.get(row.accountId)?.balance ?? '0.00';
    return {
      ...row,
      comparativeBalance,
      variance: amount(cents(row.balance) - cents(comparativeBalance)),
    };
  });
}

export async function getGeneralLedger(
  ctx: RequestContext,
  query: ReportWindowQuery,
  accountId?: string,
) {
  const window = await resolveWindow(ctx, query);
  const filter = await reportFilter(ctx);
  const rows = await ledgerRows(ctx, filter, window.from, window.to, accountId);
  const openingRows = await ledgerRows(ctx, filter, undefined, window.from, accountId);
  const opening = sum(openingRows.filter((row) => row.entryDate < window.from));
  const running = new Map<string, bigint>();
  for (const row of openingRows.filter((item) => item.entryDate < window.from)) {
    running.set(
      row.accountId,
      (running.get(row.accountId) ?? 0n) + net(row.debit, row.credit),
    );
  }
  return {
    report: 'general-ledger' as const,
    from: window.from,
    to: window.to,
    accountId: accountId ?? null,
    openingBalance: opening.balance,
    entries: rows.map((row) => {
      const next = (running.get(row.accountId) ?? 0n) + net(row.debit, row.credit);
      running.set(row.accountId, next);
      return { ...row, runningBalance: amount(next) };
    }),
  };
}

async function statementTotals(
  ctx: RequestContext,
  query: ReportWindowQuery,
  types: readonly string[],
) {
  const window = await resolveWindow(ctx, query);
  const filter = await reportFilter(ctx);
  const current = await accountTotals(ctx, filter, window.from, window.to, types);
  const compareWindow =
    query.comparePeriodId || (query.compareFrom && query.compareTo)
      ? await resolveWindow(ctx, query, 'compare')
      : null;
  const prior = compareWindow
    ? await accountTotals(ctx, filter, compareWindow.from, compareWindow.to, types)
    : [];
  const rows = current.map((row) => ({
    ...row,
    balance: amount(net(row.debit, row.credit)),
  }));
  const priorRows = prior.map((row) => ({
    ...row,
    balance: amount(net(row.debit, row.credit)),
  }));
  return { window, rows: comparative(rows, priorRows) };
}

export async function getTrialBalance(ctx: RequestContext, query: ReportWindowQuery) {
  const result = await statementTotals(ctx, query, [
    'asset',
    'liability',
    'equity',
    'income',
    'expense',
  ]);
  const totals = sum(result.rows);
  return {
    report: 'trial-balance' as const,
    from: result.window.from,
    to: result.window.to,
    rows: result.rows,
    totals,
    balanced: totals.debit === totals.credit,
  };
}

export async function getProfitAndLoss(ctx: RequestContext, query: ReportWindowQuery) {
  const result = await statementTotals(ctx, query, ['income', 'expense']);
  const normalized = result.rows.map((row) => {
    const sign = row.accountType === 'income' ? -1n : 1n;
    const balance = amount(sign * cents(row.balance));
    const comparativeBalance = amount(sign * cents(row.comparativeBalance));
    return {
      ...row,
      balance,
      comparativeBalance,
      variance: amount(cents(balance) - cents(comparativeBalance)),
    };
  });
  const revenue = normalized.filter((row) => row.accountType === 'income');
  const expenses = normalized.filter((row) => row.accountType === 'expense');
  const revenueTotal = revenue.reduce((total, row) => total + cents(row.balance), 0n);
  const expenseTotal = expenses.reduce((total, row) => total + cents(row.balance), 0n);
  return {
    report: 'pnl' as const,
    from: result.window.from,
    to: result.window.to,
    revenue,
    expenses,
    revenueTotal: amount(revenueTotal),
    expenseTotal: amount(expenseTotal),
    netProfit: amount(revenueTotal - expenseTotal),
  };
}

export async function getBalanceSheet(ctx: RequestContext, query: ReportWindowQuery) {
  const window = await resolveWindow(ctx, query);
  const filter = await reportFilter(ctx);
  const current = await accountTotals(ctx, filter, undefined, window.to, [
    'asset',
    'liability',
    'equity',
  ]);
  const compareWindow =
    query.comparePeriodId || (query.compareFrom && query.compareTo)
      ? await resolveWindow(ctx, query, 'compare')
      : null;
  const prior = compareWindow
    ? await accountTotals(ctx, filter, undefined, compareWindow.to, [
        'asset',
        'liability',
        'equity',
      ])
    : [];
  const normalize = (row: AccountTotal) => ({
    ...row,
    balance: amount(
      row.accountType === 'asset'
        ? net(row.debit, row.credit)
        : -net(row.debit, row.credit),
    ),
  });
  const rows = current.map(normalize);
  const priorRows = prior.map(normalize);
  const assets = rows.filter((row) => row.accountType === 'asset');
  const liabilities = rows.filter((row) => row.accountType === 'liability');
  const equity = rows.filter((row) => row.accountType === 'equity');
  const currentProfitRows = await accountTotals(
    ctx,
    filter,
    financialYearStart(window.to),
    window.to,
    ['income', 'expense'],
  );
  const currentProfit = currentProfitRows.reduce(
    (total, row) =>
      total +
      (row.accountType === 'income'
        ? -net(row.debit, row.credit)
        : net(row.debit, row.credit)),
    0n,
  );
  const comparativeProfit = compareWindow
    ? (
        await accountTotals(
          ctx,
          filter,
          financialYearStart(compareWindow.to),
          compareWindow.to,
          ['income', 'expense'],
        )
      ).reduce(
        (total, row) =>
          total +
          (row.accountType === 'income'
            ? -net(row.debit, row.credit)
            : net(row.debit, row.credit)),
        0n,
      )
    : 0n;
  const assetTotal = assets.reduce((total, row) => total + cents(row.balance), 0n);
  const liabilityTotal = liabilities.reduce(
    (total, row) => total + cents(row.balance),
    0n,
  );
  const equityTotal = equity.reduce((total, row) => total + cents(row.balance), 0n);
  return {
    report: 'balance-sheet' as const,
    asOf: window.to,
    assets,
    liabilities,
    equity,
    comparative: compareWindow ? comparative(rows, priorRows) : [],
    currentPeriodProfit: amount(currentProfit),
    comparativeCurrentPeriodProfit: compareWindow ? amount(comparativeProfit) : null,
    balanced: assetTotal === liabilityTotal + equityTotal + currentProfit,
    totals: {
      assets: amount(assetTotal),
      liabilities: amount(liabilityTotal),
      equity: amount(equityTotal + currentProfit),
    },
  };
}

function cashFlowClass(
  accountType: string,
  systemKey: string | null,
): 'operating' | 'investing' | 'financing' {
  if (systemKey === 'retained-earnings' || accountType === 'equity') return 'financing';
  if (
    accountType === 'asset' &&
    !['accounts-receivable', 'cash', 'bank', 'tds-receivable', 'input-gst'].includes(
      systemKey ?? '',
    )
  )
    return 'investing';
  return 'operating';
}

async function buildCashFlow(
  ctx: RequestContext,
  query: ReportWindowQuery,
  window: ReportWindow,
) {
  const filter = await reportFilter(ctx);
  const rows = await ledgerRows(ctx, filter, window.from, window.to);
  const cashRows = rows.filter(
    (row) => row.systemKey === 'cash' || row.systemKey === 'bank',
  );
  const grouped = new Map<
    string,
    { category: 'operating' | 'investing' | 'financing'; amount: bigint }
  >();
  for (const row of cashRows) {
    const key = `${row.accountId}:${row.journalId}`;
    const category = cashFlowClass(row.accountType, row.systemKey);
    const current = grouped.get(key) ?? { category, amount: 0n };
    current.amount += net(row.debit, row.credit);
    grouped.set(key, current);
  }
  const sections = { operating: 0n, investing: 0n, financing: 0n };
  for (const row of grouped.values()) sections[row.category] += row.amount;
  const openingRows = await ledgerRows(ctx, filter, undefined, window.from);
  const openingCash = openingRows
    .filter(
      (row) =>
        row.entryDate < window.from &&
        (row.systemKey === 'cash' || row.systemKey === 'bank'),
    )
    .reduce((total, row) => total + net(row.debit, row.credit), 0n);
  return {
    sections: Object.fromEntries(
      Object.entries(sections).map(([key, value]) => [key, amount(value)]),
    ),
    openingCash: amount(openingCash),
    netChange: amount(sections.operating + sections.investing + sections.financing),
    closingCash: amount(
      openingCash + sections.operating + sections.investing + sections.financing,
    ),
  };
}

export async function getCashFlow(ctx: RequestContext, query: ReportWindowQuery) {
  const window = await resolveWindow(ctx, query);
  const current = await buildCashFlow(ctx, query, window);
  const compareWindow =
    query.comparePeriodId || (query.compareFrom && query.compareTo)
      ? await resolveWindow(ctx, query, 'compare')
      : null;
  return {
    report: 'cash-flow' as const,
    from: window.from,
    to: window.to,
    ...current,
    comparative: compareWindow ? await buildCashFlow(ctx, query, compareWindow) : null,
  };
}

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'bigint' ||
            typeof value === 'boolean'
          ? String(value)
          : '';
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function exportAccountingReport(
  ctx: RequestContext,
  kind: ReportKind,
  query: ReportWindowQuery,
  accountId?: string,
): Promise<{ filename: string; body: Buffer }> {
  const report =
    kind === 'general-ledger'
      ? await getGeneralLedger(ctx, query, accountId)
      : kind === 'trial-balance'
        ? await getTrialBalance(ctx, query)
        : kind === 'pnl'
          ? await getProfitAndLoss(ctx, query)
          : kind === 'balance-sheet'
            ? await getBalanceSheet(ctx, query)
            : await getCashFlow(ctx, query);
  const rows =
    'entries' in report
      ? report.entries
      : 'rows' in report
        ? report.rows
        : 'revenue' in report
          ? [...report.revenue, ...report.expenses]
          : 'assets' in report
            ? [...report.assets, ...report.liabilities, ...report.equity]
            : [
                {
                  ...report.sections,
                  openingCash: report.openingCash,
                  netChange: report.netChange,
                  closingCash: report.closingCash,
                },
              ];
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const csv = [
    columns,
    ...rows.map((row) =>
      columns.map((column) => (row as Record<string, unknown>)[column]),
    ),
  ]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');
  return {
    filename: `tapvera-${kind}-${Date.now()}.csv`,
    body: Buffer.from(`${csv}\n`, 'utf8'),
  };
}
