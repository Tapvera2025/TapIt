import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Loading,
  Notice,
  Page,
  Select,
} from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';
import { LiquidGlassTabs } from '../../recruitment/components/RecruitmentTabs.js';
import { AccountingCompletionPanel } from './AccountingCompletionPanel.js';
import { AccountingReasonModal, JournalModal } from './AccountingWorkflowModals.js';
import { getOverview } from './completionApi.js';
import { APP_NAVIGATE_EVENT, type AppNavigateEvent } from '../../../navigationEvent.js';
import {
  closePeriod,
  createAccount,
  createJournal,
  createPeriod,
  downloadAccountingReport,
  downloadArtifact,
  exportTax,
  getBalanceSheet,
  getCashFlow,
  getGeneralLedger,
  getProfitAndLoss,
  getTrialBalance,
  importGstr2b,
  listAccounts,
  listArtifacts,
  listJournals,
  listPeriods,
  reconcileGstr2b,
  reopenPeriod,
  reverseJournal,
  updateAccount,
  updateChecklist,
  type AccountReportRow,
  type AccountingPeriod,
  type Artifact,
  type JournalEntry,
  type JournalLine,
  type LedgerAccount,
} from './accountingApi.js';

type Tab =
  | 'dashboard'
  | 'accounts'
  | 'journals'
  | 'periods'
  | 'ledger'
  | 'reports'
  | 'tax'
  | 'artifacts'
  | 'completion';
const tabs: Array<{
  id: Tab;
  label: string;
  icon: string;
  capability: 'view' | 'manage' | 'tax';
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid', capability: 'view' },
  { id: 'accounts', label: 'Chart of accounts', icon: 'layers', capability: 'manage' },
  { id: 'journals', label: 'Journals', icon: 'file-text', capability: 'view' },
  { id: 'periods', label: 'Periods', icon: 'calendar', capability: 'view' },
  { id: 'ledger', label: 'Ledger', icon: 'book', capability: 'view' },
  { id: 'reports', label: 'Reports', icon: 'chart', capability: 'view' },
  { id: 'tax', label: 'Tax & compliance', icon: 'shield', capability: 'tax' },
  { id: 'artifacts', label: 'Export artifacts', icon: 'download', capability: 'tax' },
  { id: 'completion', label: 'Completion', icon: 'layers', capability: 'view' },
];
const today = () => new Date().toISOString().slice(0, 10);
const containsDate = (period: AccountingPeriod, date: string) =>
  period.periodStart <= date && period.periodEnd >= date;
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to complete the accounting request.';
const amount = (value: string | undefined | null) => value ?? '0.00';
const tabFrom = (value: string | null): Tab =>
  tabs.some((tab) => tab.id === value) ? (value as Tab) : 'dashboard';

export function AccountingPage({
  initialTab = 'dashboard',
  onNavigate,
  canManageAccounts,
  canPost,
  canClose,
  canManagePeriods,
  canViewStatements,
  canTax,
}: {
  initialTab?: string;
  onNavigate: (path: string) => void;
  canManageAccounts: boolean;
  canPost: boolean;
  canClose: boolean;
  canManagePeriods: boolean;
  canViewStatements: boolean;
  canTax: boolean;
}): React.JSX.Element {
  const initialRouteTab =
    new URLSearchParams(window.location.search).get('tab') ?? initialTab;
  const [routeTab, setRouteTab] = useState(initialRouteTab);
  useEffect(() => {
    const onNavigate = (event: Event) => {
      const detail = (event as AppNavigateEvent).detail;
      if (!detail.startsWith('/company/finance/accounting')) return;
      setRouteTab(
        new URLSearchParams(detail.split('?')[1] ?? '').get('tab') ?? 'dashboard',
      );
    };
    window.addEventListener(APP_NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(APP_NAVIGATE_EVENT, onNavigate);
  }, []);
  const requestedTab = tabFrom(routeTab);
  const allowedTabs = tabs.filter(
    (item) =>
      item.capability === 'view' ||
      (item.capability === 'manage' && canManageAccounts) ||
      (item.capability === 'tax' && canTax),
  );
  const tab = allowedTabs.some((item) => item.id === requestedTab)
    ? requestedTab
    : 'dashboard';
  const liquidTabs = allowedTabs.map((item) => ({
    id: item.id,
    label: item.label,
    path: `/company/finance/accounting?tab=${item.id}`,
    iconName: item.icon,
  }));
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [entities, setEntities] = useState<Array<{ id: string; code: string; legalName: string; baseCurrency: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    void listPeriods()
      .then((result) => {
        setPeriods(result.periods);
        setSelectedPeriod(
          (current) =>
            current ||
            result.periods.find((period) => containsDate(period, today()))?.id ||
            result.periods.find((period) => period.status !== 'closed')?.id ||
            result.periods[0]?.id ||
            '',
        );
      })
      .catch((cause) => setError(messageOf(cause)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { void getOverview().then((result) => setEntities(result.entities)).catch(() => undefined); }, []);
  const period = periods.find((item) => item.id === selectedPeriod);
  const refreshPeriods = () => {
    void listPeriods()
      .then((result) => setPeriods(result.periods))
      .catch((cause) => setError(messageOf(cause)));
  };
  return (
    <Page
      eyebrow="Finance · Accounting"
      title="Accounting"
      description="Manage the ledger, close periods, financial reports, and statutory tax exports."
    >
      <LiquidGlassTabs
        items={liquidTabs}
        activeId={tab}
        onNavigate={onNavigate}
        ariaLabel="Accounting sections"
      />
      {error && <Notice error>{error}</Notice>}
      {loading ? (
        <Loading />
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-end gap-3">
              <Select
                label="Accounting period"
                value={selectedPeriod}
                onChange={setSelectedPeriod}
                options={periods.map((item) => ({
                  value: item.id,
                  label: `${item.periodStart} → ${item.periodEnd} · ${item.status}`,
                }))}
              />
              <span className="rounded-lg border border-app-border px-3 py-2.5 text-xs text-app-muted">
                All figures are posted ledger data
              </span>
            </div>
          </Card>
          <AccountingTab
            tab={tab}
            period={period}
            selectedPeriod={selectedPeriod}
            periods={periods}
            canPost={canPost}
            canClose={canClose}
            canManagePeriods={canManagePeriods}
            canViewStatements={canViewStatements}
            canTax={canTax}
            onError={setError}
            onRefreshPeriods={refreshPeriods}
            entities={entities}
          />
        </>
      )}
    </Page>
  );
}

function AccountingTab({
  tab,
  period,
  selectedPeriod,
  periods,
  canPost,
  canClose,
  canManagePeriods,
  canViewStatements,
  canTax,
  onError,
  onRefreshPeriods,
  entities,
}: {
  tab: Tab;
  period?: AccountingPeriod | undefined;
  selectedPeriod: string;
  periods: AccountingPeriod[];
  canPost: boolean;
  canClose: boolean;
  canManagePeriods: boolean;
  canViewStatements: boolean;
  canTax: boolean;
  onError: (value: string) => void;
  onRefreshPeriods: () => void;
  entities: Array<{ id: string; code: string; legalName: string; baseCurrency: string }>;
}): React.JSX.Element {
  if (tab === 'dashboard')
    return (
      <DashboardTab
        period={period}
        canViewStatements={canViewStatements}
        onError={onError}
      />
    );
  if (tab === 'completion') return <AccountingCompletionPanel />;
  if (tab === 'accounts') return <AccountsTab onError={onError} />;
  if (tab === 'journals')
    return (
      <JournalsTab period={period} canManage={canPost} onError={onError} entities={entities} />
    );
  if (tab === 'periods')
    return (
      <PeriodsTab
        periods={periods}
        canManage={canClose}
        canManagePeriods={canManagePeriods}
        onError={onError}
        onRefresh={onRefreshPeriods}
      />
    );
  if (tab === 'ledger') return <LedgerTab periodId={selectedPeriod} onError={onError} />;
  if (tab === 'reports')
    return (
      <ReportsTab
        periodId={selectedPeriod}
        periods={periods}
        canViewStatements={canViewStatements}
        onError={onError}
      />
    );
  if (tab === 'tax')
    return <TaxTab periodId={selectedPeriod} period={period} canTax={canTax} onError={onError} />;
  return <ArtifactsTab onError={onError} />;
}

function DashboardTab({
  period,
  canViewStatements,
  onError,
}: {
  period?: AccountingPeriod | undefined;
  canViewStatements: boolean;
  onError: (value: string) => void;
}): React.JSX.Element {
  const [data, setData] = useState<{
    trial?: Awaited<ReturnType<typeof getTrialBalance>>;
    pnl?: Awaited<ReturnType<typeof getProfitAndLoss>>;
    balance?: Awaited<ReturnType<typeof getBalanceSheet>>;
  }>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!period) return;
    let active = true;
    setData(undefined);
    setLoading(true);
    setFailed(false);
    onError('');
    void Promise.all([
      getTrialBalance({ periodId: period.id }),
      canViewStatements ? getProfitAndLoss({ periodId: period.id }) : Promise.resolve(undefined),
      canViewStatements ? getBalanceSheet({ periodId: period.id }) : Promise.resolve(undefined),
    ])
      .then(([trial, pnl, balance]) => {
        if (!active) return;
        setData({
          trial,
          ...(pnl ? { pnl } : {}),
          ...(balance ? { balance } : {}),
        });
      })
      .catch((cause) => {
        if (active) {
          setFailed(true);
          onError(messageOf(cause));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [period, canViewStatements, onError]);
  if (!period) return <Empty>No accounting periods are available.</Empty>;
  if (failed) return <Empty>Dashboard reports could not be loaded for this period.</Empty>;
  if (loading || !data) return <Loading />;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Net profit" value={amount(data?.pnl?.netProfit)} icon="chart" />
        <Metric
          label="Total assets"
          value={amount(data?.balance?.totals.assets)}
          icon="wallet"
        />
        <Metric
          label="Trial balance"
          value={data?.trial?.balanced ? 'Balanced' : 'Review'}
          icon={data?.trial?.balanced ? 'check' : 'alert-circle'}
        />
        <Metric label="Period status" value={period.status} icon="calendar" />
      </div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">Close readiness</h2>
            <p className="mt-1 text-sm text-app-muted">
              Complete the checklist before closing {period.periodStart} to{' '}
              {period.periodEnd}.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${period.status === 'closed' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}
          >
            {period.status}
          </span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['Bank', period.bankReconciled],
            ['Aging', period.agingReconciled],
            ['Payables', period.payablesReconciled],
            ['GST', period.gstReconciled],
            ['Trial balance', period.trialBalanceReconciled],
          ].map(([label, complete]) => (
            <div
              key={String(label)}
              className="rounded-xl border border-app-border p-3 text-sm"
            >
              <span
                className={`mr-2 inline-block size-2 rounded-full ${complete ? 'bg-emerald-500' : 'bg-amber-500'}`}
              />
              {label}
              <span className="mt-1 block text-xs text-app-muted">
                {complete ? 'Complete' : 'Pending'}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: string;
}): React.JSX.Element {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-app-accent/10 text-app-accent">
          <Icon name={icon} className="size-5" />
        </span>
        <div>
          <p className="text-xs text-app-muted">{label}</p>
          <p className="mt-1 text-xl font-bold capitalize">{value}</p>
        </div>
      </div>
    </Card>
  );
}

function AccountsTab({
  onError,
}: {
  onError: (value: string) => void;
}): React.JSX.Element {
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState<{
    code: string;
    name: string;
    accountType: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
    normalBalance: 'debit' | 'credit';
  }>({ code: '', name: '', accountType: 'asset', normalBalance: 'debit' });
  const [saving, setSaving] = useState(false);
  const load = () => {
    void listAccounts(showInactive ? 'all' : 'active')
      .then((result) => setAccounts(result.accounts))
      .catch((cause) => onError(messageOf(cause)));
  };
  useEffect(load, [showInactive, onError]);
  async function save(): Promise<void> {
    setSaving(true);
    try {
      await createAccount(form);
      setForm({ code: '', name: '', accountType: 'asset', normalBalance: 'debit' });
      load();
    } catch (cause) {
      onError(messageOf(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label="Code"
            value={form.code}
            onChange={(value) => setForm({ ...form, code: value })}
          />
          <Field
            label="Account name"
            value={form.name}
            onChange={(value) => setForm({ ...form, name: value })}
          />
          <Select
            label="Type"
            value={form.accountType}
            onChange={(value) =>
              setForm({
                ...form,
                accountType: value as typeof form.accountType,
              })
            }
            options={['asset', 'liability', 'equity', 'income', 'expense'].map(
              (value) => ({ value, label: value }),
            )}
          />
          <Select
            label="Normal balance"
            value={form.normalBalance}
            onChange={(value) =>
              setForm({
                ...form,
                normalBalance: value as typeof form.normalBalance,
              })
            }
            options={[
              { value: 'debit', label: 'Debit' },
              { value: 'credit', label: 'Credit' },
            ]}
          />
          <Button
            disabled={saving || !form.code || !form.name}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Add account'}
          </Button>
          <label className="flex items-center gap-2 pb-2 text-sm text-app-muted">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
            />
            Show inactive
          </label>
        </div>
      </Card>
      <AccountTable
        accounts={accounts}
        onToggle={(account) =>
          void updateAccount(account.id, { isActive: !account.isActive })
            .then(load)
            .catch((cause) => onError(messageOf(cause)))
        }
      />
    </div>
  );
}
function AccountTable({
  accounts,
  onToggle,
}: {
  accounts: LedgerAccount[];
  onToggle: (account: LedgerAccount) => void;
}): React.JSX.Element {
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-app-border bg-app-surface-raised text-left text-xs text-app-muted">
            {['Code', 'Account', 'Type', 'Normal balance', 'System', 'Status', ''].map(
              (item) => (
                <th key={item} className="px-4 py-3">
                  {item}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id} className="border-b border-app-border last:border-0">
              <td className="px-4 py-3 font-mono">{account.code}</td>
              <td className="px-4 py-3 font-semibold">{account.name}</td>
              <td className="px-4 py-3 capitalize">{account.accountType}</td>
              <td className="px-4 py-3 capitalize">{account.normalBalance}</td>
              <td className="px-4 py-3">{account.isSystemAccount ? 'Yes' : 'No'}</td>
              <td className="px-4 py-3">{account.isActive ? 'Active' : 'Inactive'}</td>
              <td className="px-4 py-3 text-right">
                {!account.isSystemAccount && (
                  <Button kind="secondary" onClick={() => onToggle(account)}>
                    {account.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {accounts.length === 0 && <Empty>No accounts found.</Empty>}
    </Card>
  );
}

function JournalsTab({
  period,
  canManage,
  onError,
  entities,
}: {
  period?: AccountingPeriod | undefined;
  canManage: boolean;
  onError: (value: string) => void;
  entities: Array<{ id: string; code: string; legalName: string; baseCurrency: string }>;
}): React.JSX.Element {
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [open, setOpen] = useState(false);
  const [journalModalOpen, setJournalModalOpen] = useState(false);
  const [reversalJournal, setReversalJournal] = useState<JournalEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState([
    { accountId: '', debit: '', credit: '' },
    { accountId: '', debit: '', credit: '' },
  ]);
  const load = useCallback(async (): Promise<void> => {
    if (!period?.id) return;
    try {
      const result = await listJournals({ periodId: period.id });
      setJournals(result.journals);
    } catch (cause) {
      onError(messageOf(cause));
    }
  }, [period?.id, onError]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (canManage)
      void listAccounts()
        .then((result) => setAccounts(result.accounts))
        .catch(() => undefined);
  }, [canManage]);
  const totalDebit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  async function post(): Promise<void> {
    setBusy(true);
    try {
      await createJournal({
        entryDate: date,
        description,
        sourceType: 'manual',
        lines: lines.map((line) => ({
          ...line,
          debit: line.debit || '0',
          credit: line.credit || '0',
        })),
      });
      setOpen(false);
      setDescription('');
      await load();
    } catch (cause) {
      onError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">Posted journals</h2>
            <p className="text-sm text-app-muted">
              Posted entries are immutable; corrections use reversal journals.
            </p>
          </div>
          {canManage && (
            <Button onClick={() => setJournalModalOpen(true)}>
              Create journal
            </Button>
          )}
        </div>
        {open && (
          <div className="mt-5 rounded-xl border border-app-accent/20 bg-app-accent/5 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Entry date" type="date" value={date} onChange={setDate} />
              <Field label="Description" value={description} onChange={setDescription} />
            </div>
            <div className="mt-4 space-y-2">
              {lines.map((line, index) => (
                <div
                  key={index}
                  className="grid gap-2 sm:grid-cols-[1fr_150px_150px_auto]"
                >
                  <Select
                    label={index === 0 ? 'Account' : ''}
                    value={line.accountId}
                    onChange={(value) =>
                      setLines(
                        lines.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, accountId: value } : item,
                        ),
                      )
                    }
                    options={[
                      { value: '', label: 'Select account' },
                      ...accounts.map((account) => ({
                        value: account.id,
                        label: `${account.code} · ${account.name}`,
                      })),
                    ]}
                  />
                  <Field
                    label={index === 0 ? 'Debit' : ''}
                    value={line.debit}
                    onChange={(value) =>
                      setLines(
                        lines.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, debit: value, credit: value ? '' : item.credit }
                            : item,
                        ),
                      )
                    }
                  />
                  <Field
                    label={index === 0 ? 'Credit' : ''}
                    value={line.credit}
                    onChange={(value) =>
                      setLines(
                        lines.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, credit: value, debit: value ? '' : item.debit }
                            : item,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="self-end pb-2 text-sm text-app-danger disabled:opacity-30"
                    disabled={lines.length <= 2}
                    onClick={() =>
                      setLines(lines.filter((_, itemIndex) => itemIndex !== index))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
              <Button
                kind="secondary"
                onClick={() =>
                  setLines([...lines, { accountId: '', debit: '', credit: '' }])
                }
              >
                Add line
              </Button>
              <span
                className={
                  Math.abs(totalDebit - totalCredit) < 0.005
                    ? 'text-emerald-500'
                    : 'text-app-danger'
                }
              >
                Debit {totalDebit.toFixed(2)} · Credit {totalCredit.toFixed(2)}
              </span>
              <Button
                disabled={
                  busy || !description || Math.abs(totalDebit - totalCredit) >= 0.005
                }
                onClick={() => void post()}
              >
                {busy ? 'Posting…' : 'Post journal'}
              </Button>
            </div>
          </div>
        )}
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-app-border bg-app-surface-raised text-left text-xs text-app-muted">
              {['Date', 'Description', 'Source', 'Debit', 'Credit', ''].map((item) => (
                <th key={item} className="px-4 py-3">
                  {item}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {journals.map((journal) => (
              <tr key={journal.id} className="border-b border-app-border last:border-0">
                <td className="px-4 py-3">{journal.entryDate}</td>
                <td className="px-4 py-3 font-semibold">{journal.description}</td>
                <td className="px-4 py-3">{journal.sourceType}</td>
                <td className="px-4 py-3">{journal.debitTotal}</td>
                <td className="px-4 py-3">{journal.creditTotal}</td>
                <td className="px-4 py-3 text-right">
                  {canManage && (
                    <Button
                      kind="secondary"
                      onClick={() => {
                        setReversalJournal(journal);
                      }}
                    >
                      Reverse
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {journals.length === 0 && <Empty>No journals posted in this period.</Empty>}
      </Card>
      {journalModalOpen && <JournalModal accounts={accounts} entities={entities} defaultDate={today()} periodStart={period?.periodStart} periodEnd={period?.periodEnd} onClose={() => setJournalModalOpen(false)} onSubmit={async (body) => { await createJournal(body); setJournalModalOpen(false); await load(); }} />}
      {reversalJournal && <AccountingReasonModal title="Reverse journal" description={`This creates an immutable reversing journal for “${reversalJournal.description}”.`} submitLabel="Post reversal" onClose={() => setReversalJournal(null)} onSubmit={async (reason) => { await reverseJournal(reversalJournal.id, today(), reason); setReversalJournal(null); await load(); }} />}
    </div>
  );
}

function PeriodsTab({
  periods,
  canManage,
  canManagePeriods,
  onError,
  onRefresh,
}: {
  periods: AccountingPeriod[];
  canManage: boolean;
  canManagePeriods: boolean;
  onError: (value: string) => void;
  onRefresh: () => void;
}): React.JSX.Element {
  const [form, setForm] = useState({ financialYear: '', periodStart: '', periodEnd: '' });
  const [selected, setSelected] = useState<AccountingPeriod | null>(null);
  const [reopenTarget, setReopenTarget] = useState<AccountingPeriod | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(): Promise<void> {
    setBusy(true);
    try {
      await createPeriod(form);
      setForm({ financialYear: '', periodStart: '', periodEnd: '' });
      onRefresh();
    } catch (cause) {
      onError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }
  async function close(): Promise<void> {
    if (!selected) return;
    setBusy(true);
    try {
      await updateChecklist(selected.id, {
        bankReconciled: selected.bankReconciled,
        agingReconciled: selected.agingReconciled,
        payablesReconciled: selected.payablesReconciled,
        gstReconciled: selected.gstReconciled,
        trialBalanceReconciled: selected.trialBalanceReconciled,
      });
      await closePeriod(selected.id);
      setSelected(null);
      onRefresh();
    } catch (cause) {
      onError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      {canManagePeriods && (
        <Card>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field
              label="Financial year"
              placeholder="2026-2027"
              value={form.financialYear}
              onChange={(value) => setForm({ ...form, financialYear: value })}
            />
            <Field
              label="Start"
              type="date"
              value={form.periodStart}
              onChange={(value) => setForm({ ...form, periodStart: value })}
            />
            <Field
              label="End"
              type="date"
              value={form.periodEnd}
              onChange={(value) => setForm({ ...form, periodEnd: value })}
            />
            <Button
              disabled={
                busy || !form.financialYear || !form.periodStart || !form.periodEnd
              }
              onClick={() => void save()}
            >
              Create period
            </Button>
          </div>
        </Card>
      )}
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[950px] text-sm">
          <thead>
            <tr className="border-b border-app-border bg-app-surface-raised text-left text-xs text-app-muted">
              <th className="px-4 py-3">Period</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Checklist</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {periods.map((item) => {
              const complete = [
                item.bankReconciled,
                item.agingReconciled,
                item.payablesReconciled,
                item.gstReconciled,
                item.trialBalanceReconciled,
              ].filter(Boolean).length;
              return (
                <tr key={item.id} className="border-b border-app-border last:border-0">
                  <td className="px-4 py-3 font-semibold">
                    {item.periodStart} → {item.periodEnd}
                  </td>
                  <td className="px-4 py-3 capitalize">{item.status}</td>
                  <td className="px-4 py-3">{complete}/5 complete</td>
                  <td className="px-4 py-3 text-right">
                    {canManage && item.status !== 'closed' && (
                      <Button kind="secondary" onClick={() => setSelected(item)}>
                        Review / close
                      </Button>
                    )}
                    {canManagePeriods && item.status === 'closed' && <Button kind="secondary" onClick={() => setReopenTarget(item)}>Reopen</Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {selected && (
        <ClosePeriodDialog
          period={selected}
          busy={busy}
          onClose={() => setSelected(null)}
          onChange={setSelected}
          onClosePeriod={() => void close()}
        />
      )}
      {reopenTarget && <AccountingReasonModal title="Reopen accounting period" description={`Reopening ${reopenTarget.periodStart} → ${reopenTarget.periodEnd} is a protected Super Admin action. New postings remain blocked until the period is reopened.`} submitLabel="Reopen period" onClose={() => setReopenTarget(null)} onSubmit={async (reason) => { await reopenPeriod(reopenTarget.id, reason); setReopenTarget(null); onRefresh(); }} />}
    </div>
  );
}
function ClosePeriodDialog({
  period,
  busy,
  onClose,
  onChange,
  onClosePeriod,
}: {
  period: AccountingPeriod;
  busy: boolean;
  onClose: () => void;
  onChange: (period: AccountingPeriod) => void;
  onClosePeriod: () => void;
}): React.JSX.Element {
  const fields: Array<[keyof AccountingPeriod, string]> = [
    ['bankReconciled', 'Bank reconciled'],
    ['agingReconciled', 'Aging reconciled'],
    ['payablesReconciled', 'Payables reconciled'],
    ['gstReconciled', 'GST reconciled'],
    ['trialBalanceReconciled', 'Trial balance reconciled'],
  ];
  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4 backdrop-blur-[2px]"
      role="presentation"
    >
      <Card className="w-full max-w-lg">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Close accounting period</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <p className="mt-2 text-sm text-app-muted">
          All checklist items must be complete. Segregation-of-duties rules are enforced
          by the server.
        </p>
        <div className="mt-4 space-y-2">
          {fields.map(([key, label]) => (
            <label
              key={String(key)}
              className="flex items-center gap-3 rounded-lg border border-app-border p-3 text-sm"
            >
              <input
                type="checkbox"
                checked={Boolean(period[key])}
                onChange={(event) => onChange({ ...period, [key]: event.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || fields.some(([key]) => !period[key])}
            onClick={onClosePeriod}
          >
            Close period
          </Button>
        </div>
      </Card>
    </div>
  );
}

function LedgerTab({
  periodId,
  onError,
}: {
  periodId: string;
  onError: (value: string) => void;
}): React.JSX.Element {
  const [rows, setRows] = useState<
    Array<JournalEntry & JournalLine & { journalId?: string; runningBalance: string }>
  >([]);
  const [accountOptions, setAccountOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [accountId, setAccountId] = useState('');
  const [exporting, setExporting] = useState(false);
  async function exportLedger(): Promise<void> {
    setExporting(true);
    try {
      await saveBlob(
        await downloadAccountingReport('general-ledger', {
          periodId,
          ...(accountId ? { accountId } : {}),
        }),
        `general-ledger-${periodId}${accountId ? `-${accountId}` : ''}.csv`,
      );
    } catch (cause) {
      onError(messageOf(cause));
    } finally {
      setExporting(false);
    }
  }
  useEffect(() => {
    if (periodId)
      void getGeneralLedger({
        periodId,
        ...(accountId ? { accountId } : {}),
      })
        .then((result) => {
          setRows(result.entries);
          if (!accountId) {
            setAccountOptions(
              Array.from(
                new Map(
                  result.entries.map((entry) => [
                    entry.accountId,
                    {
                      value: entry.accountId,
                      label: `${entry.accountCode} · ${entry.accountName}`,
                    },
                  ]),
                ).values(),
              ),
            );
          }
        })
        .catch((cause) => onError(messageOf(cause)));
  }, [periodId, accountId, onError]);
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">General ledger</h2>
            <p className="text-sm text-app-muted">
              Transaction drill-through for the selected period.
            </p>
          </div>
          <Select
            label="Account drill-through"
            value={accountId}
            onChange={setAccountId}
            options={[{ value: '', label: 'All accounts' }, ...accountOptions]}
          />
          <Button
            kind="secondary"
            disabled={exporting}
            onClick={() => void exportLedger()}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </div>
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="border-b border-app-border bg-app-surface-raised text-left text-xs text-app-muted">
              {[
                'Date',
                'Account',
                'Description',
                'Source',
                'Debit',
                'Credit',
                'Running balance',
              ].map((item) => (
                <th key={item} className="px-4 py-3">
                  {item}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={`${row.id ?? row.journalId}-${index}`}
                className="border-b border-app-border last:border-0"
              >
                <td className="px-4 py-3">{row.entryDate}</td>
                <td className="px-4 py-3 font-semibold">
                  {row.accountCode} · {row.accountName}
                  <button type="button" className="ml-2 text-xs font-normal text-app-accent underline" onClick={() => setAccountId(row.accountId)}>Drill through</button>
                </td>
                <td className="px-4 py-3">{row.description}</td>
                <td className="px-4 py-3">{row.sourceType}</td>
                <td className="px-4 py-3">{row.debit}</td>
                <td className="px-4 py-3">{row.credit}</td>
                <td className="px-4 py-3 font-semibold">{row.runningBalance}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>No ledger entries in this period.</Empty>}
      </Card>
    </div>
  );
}

function ReportsTab({
  periodId,
  periods,
  canViewStatements,
  onError,
}: {
  periodId: string;
  periods: AccountingPeriod[];
  canViewStatements: boolean;
  onError: (value: string) => void;
}): React.JSX.Element {
  const [kind, setKind] = useState<'trial' | 'pnl' | 'balance' | 'cash'>('trial');
  const [comparePeriodId, setComparePeriodId] = useState('');
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [exporting, setExporting] = useState(false);
  async function exportReport(): Promise<void> {
    setExporting(true);
    try {
      const exportKind =
        kind === 'trial'
          ? 'trial-balance'
          : kind === 'pnl'
            ? 'pnl'
            : kind === 'balance'
              ? 'balance-sheet'
              : 'cash-flow';
      await saveBlob(
        await downloadAccountingReport(exportKind, { periodId }),
        `accounting-${exportKind}-${periodId}.csv`,
      );
    } catch (cause) {
      onError(messageOf(cause));
    } finally {
      setExporting(false);
    }
  }
  useEffect(() => {
    if (!periodId) return;
    let active = true;
    setData(null);
    setLoading(true);
    setReportError('');
    const load =
      kind === 'trial'
        ? getTrialBalance({ periodId, comparePeriodId: comparePeriodId || undefined })
        : kind === 'pnl'
          ? getProfitAndLoss({ periodId, comparePeriodId: comparePeriodId || undefined })
          : kind === 'balance'
            ? getBalanceSheet({ periodId, comparePeriodId: comparePeriodId || undefined })
            : getCashFlow({ periodId, comparePeriodId: comparePeriodId || undefined });
    void load
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause) => {
        if (!active) return;
        const message = messageOf(cause);
        setReportError(message);
        onError(message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [periodId, kind, comparePeriodId, onError]);
  const trialData = kind === 'trial' && data && Array.isArray((data as { rows?: unknown }).rows)
    ? data as Awaited<ReturnType<typeof getTrialBalance>>
    : null;
  const pnlData = kind === 'pnl' && data && Array.isArray((data as { revenue?: unknown }).revenue) && Array.isArray((data as { expenses?: unknown }).expenses)
    ? data as Awaited<ReturnType<typeof getProfitAndLoss>>
    : null;
  const balanceData = kind === 'balance' && data && Array.isArray((data as { assets?: unknown }).assets) && Array.isArray((data as { liabilities?: unknown }).liabilities) && Array.isArray((data as { equity?: unknown }).equity)
    ? data as Awaited<ReturnType<typeof getBalanceSheet>>
    : null;
  const cashData = kind === 'cash' && data && typeof (data as { sections?: unknown }).sections === 'object' && (data as { sections?: unknown }).sections !== null
    ? data as Awaited<ReturnType<typeof getCashFlow>>
    : null;
  const invalidData = !loading && !reportError && data !== null && !trialData && !pnlData && !balanceData && !cashData;
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Statement"
            value={kind}
            onChange={(value) => setKind(value as typeof kind)}
            options={[
              { value: 'trial', label: 'Trial balance' },
              ...(canViewStatements
                ? [
                    { value: 'pnl', label: 'Profit & loss' },
                    { value: 'balance', label: 'Balance sheet' },
                    { value: 'cash', label: 'Cash flow' },
                  ]
                : []),
            ]}
          />
          <Select
            label="Compare with"
            value={comparePeriodId}
            onChange={setComparePeriodId}
            options={[
              { value: '', label: 'No comparison' },
              ...periods
                .filter((item) => item.id !== periodId)
                .map((item) => ({
                  value: item.id,
                  label: `${item.periodStart} → ${item.periodEnd}`,
                })),
            ]}
          />
          <Button
            kind="secondary"
            disabled={exporting}
            onClick={() => void exportReport()}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </div>
      </Card>
      {loading && <Loading />}
      {!loading && reportError && <Notice error>{reportError}</Notice>}
      {!loading && !reportError && data === null && <Empty>No report data is available for this period.</Empty>}
      {invalidData && <Notice error>The report returned an invalid response. Refresh the page and try again.</Notice>}
      {trialData && (
        <ReportRows
          title="Trial balance"
          rows={trialData.rows}
          footer={`Balanced: ${trialData.balanced ? 'Yes' : 'No'} · Debit ${trialData.totals?.debit ?? '0.00'} · Credit ${trialData.totals?.credit ?? '0.00'}`}
        />
      )}
      {pnlData && (
        <>
          <ReportRows
            title="Revenue"
            rows={pnlData.revenue}
          />
          <ReportRows
            title="Expenses"
            rows={pnlData.expenses}
            footer={`Net profit: ${pnlData.netProfit ?? '0.00'}`}
          />
        </>
      )}
      {balanceData && (
        <>
          <ReportRows
            title="Assets"
            rows={balanceData.assets}
          />
          <ReportRows
            title="Liabilities & equity"
            rows={[...balanceData.liabilities, ...balanceData.equity]}
            footer={`Balanced: ${balanceData.balanced ? 'Yes' : 'No'}`}
          />
        </>
      )}
      {cashData && (
        <Card>
          <h2 className="font-display text-lg font-bold">Cash flow</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {Object.entries(
              cashData.sections,
            ).map(([key, value]) => (
              <Metric key={key} label={key} value={String(value)} icon="chart" />
            ))}
            <Metric
              label="Closing cash"
              value={cashData.closingCash ?? '0.00'}
              icon="wallet"
            />
          </div>
          {cashData.comparative && <p className="mt-4 border-t border-app-border pt-3 text-sm text-app-muted">Comparative closing cash: {cashData.comparative.closingCash} · comparative net change: {cashData.comparative.netChange}</p>}
        </Card>
      )}
    </div>
  );
}
function ReportRows({
  title,
  rows,
  footer,
}: {
  title: string;
  rows: AccountReportRow[];
  footer?: string;
}): React.JSX.Element {
  const hasComparison = rows.some((row) => row.comparativeBalance !== undefined);
  return (
    <Card className="overflow-x-auto p-0">
      <div className="border-b border-app-border px-5 py-4">
        <h2 className="font-display text-lg font-bold">{title}</h2>
      </div>
      <table className="w-full min-w-[700px] text-sm">
        <thead>
          <tr className="border-b border-app-border bg-app-surface-raised text-left text-xs text-app-muted">
            <th className="px-4 py-3">Account</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Debit</th>
            <th className="px-4 py-3">Credit</th>
            <th className="px-4 py-3">Balance</th>
            {hasComparison && <th className="px-4 py-3">Comparative</th>}
            {hasComparison && <th className="px-4 py-3">Variance</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.accountId} className="border-b border-app-border last:border-0">
              <td className="px-4 py-3 font-semibold">
                {row.accountCode} · {row.accountName}
              </td>
              <td className="px-4 py-3 capitalize">{row.accountType}</td>
              <td className="px-4 py-3">{amount(row.debit)}</td>
              <td className="px-4 py-3">{amount(row.credit)}</td>
              <td className="px-4 py-3 font-semibold">{row.balance}</td>
              {hasComparison && (
                <td className="px-4 py-3">{amount(row.comparativeBalance)}</td>
              )}
              {hasComparison && (
                <td className="px-4 py-3">{amount(row.variance)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {footer && (
        <p className="border-t border-app-border px-5 py-3 text-sm font-semibold text-app-accent">
          {footer}
        </p>
      )}
      {rows.length === 0 && <Empty>No report data available.</Empty>}
    </Card>
  );
}

function TaxTab({
  periodId,
  period,
  canTax,
  onError,
}: {
  periodId: string;
  period?: AccountingPeriod | undefined;
  canTax: boolean;
  onError: (value: string) => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Artifact | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDates, setImportDates] = useState({ periodStart: period?.periodStart ?? '', periodEnd: period?.periodEnd ?? '' });
  const [taxError, setTaxError] = useState('');
  const selectedPeriodStart = period?.periodStart;
  const selectedPeriodEnd = period?.periodEnd;
  useEffect(() => {
    if (selectedPeriodStart && selectedPeriodEnd) setImportDates({ periodStart: selectedPeriodStart, periodEnd: selectedPeriodEnd });
  }, [selectedPeriodStart, selectedPeriodEnd]);
  const run = async (
    kind: 'gstr1' | 'gstr3b' | 'tds' | 'tds-receivable/reconciliation',
  ) => {
    setBusy(true);
    setTaxError('');
    try {
      setResult(await exportTax(kind, { periodId }));
    } catch (cause) {
      const message = messageOf(cause);
      setTaxError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  };
  async function importFileNow(): Promise<void> {
    if (!importFile) { setTaxError('Select a CSV file first.'); return; }
    if (!importDates.periodStart || !importDates.periodEnd) { setTaxError('Enter both import period dates.'); return; }
    if (importDates.periodStart > importDates.periodEnd) { setTaxError('Period start cannot be after period end.'); return; }
    if (importFile.size === 0) { setTaxError('The selected CSV file is empty.'); return; }
    if (importFile.size > 10 * 1024 * 1024) { setTaxError('The CSV file must not exceed 10 MB.'); return; }
    setBusy(true);
    setTaxError('');
    try {
      const contentBase64 = await readFileBase64(importFile);
      const imported = await importGstr2b({
        filename: importFile.name,
        periodStart: importDates.periodStart,
        periodEnd: importDates.periodEnd,
        contentBase64,
      });
      setResult(imported.artifact);
    } catch (cause) {
      const message = messageOf(cause);
      setTaxError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      {taxError && <Notice error>{taxError}</Notice>}
      <Card>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !canTax} onClick={() => void run('gstr1')}>
            Generate GSTR-1
          </Button>
          <Button disabled={busy || !canTax} onClick={() => void run('gstr3b')}>
            Generate GSTR-3B
          </Button>
          <Button disabled={busy || !canTax} onClick={() => void run('tds')}>
            Generate TDS export
          </Button>
          <Button
            disabled={busy || !canTax}
            onClick={() => void run('tds-receivable/reconciliation')}
          >
            TDS receivable reconciliation
          </Button>
        </div>
        {result && (
          <p className="mt-4 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-500">
            Created {result.filename} with {result.rowCount} row(s). Download it from
            Export artifacts.
          </p>
        )}
      </Card>
      <Card>
        <h2 className="font-display text-lg font-bold">Import GSTR-2B</h2>
        <p className="mt-1 text-sm text-app-muted">
          CSV headers: supplier GSTIN, invoice number, invoice date (YYYY-MM-DD), taxable
          value, IGST, CGST, SGST, cess.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field
            label="Period start"
            type="date"
            value={importDates.periodStart}
            onChange={(value) => setImportDates({ ...importDates, periodStart: value })}
          />
          <Field
            label="Period end"
            type="date"
            value={importDates.periodEnd}
            onChange={(value) => setImportDates({ ...importDates, periodEnd: value })}
          />
          <label className="text-xs font-semibold text-app-muted">
            <span className="mb-2 block">CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
              className="block w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm"
            />
          </label>
        </div>
        <Button
          className="mt-4"
          disabled={
            busy || !importFile || !importDates.periodStart || !importDates.periodEnd
          }
          onClick={() => void importFileNow()}
        >
          Import GSTR-2B
        </Button>
      </Card>
    </div>
  );
}
function ArtifactsTab({
  onError,
}: {
  onError: (value: string) => void;
}): React.JSX.Element {
  const [items, setItems] = useState<Artifact[]>([]);
  const [notice, setNotice] = useState('');
  const load = () => {
    void listArtifacts()
      .then((result) => setItems(result.artifacts))
      .catch((cause) => onError(messageOf(cause)));
  };
  useEffect(load, [onError]);
  async function download(item: Artifact): Promise<void> {
    try {
      const blob = await downloadArtifact(item.id);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = item.filename;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (cause) {
      onError(messageOf(cause));
    }
  }
  return (
    <div className="space-y-3">{notice && <Notice>{notice}</Notice>}<Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[850px] text-sm">
        <thead>
          <tr className="border-b border-app-border bg-app-surface-raised text-left text-xs text-app-muted">
            {['Type', 'File', 'Period', 'Rows', 'Created', ''].map((item) => (
              <th key={item} className="px-4 py-3">
                {item}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-app-border last:border-0">
              <td className="px-4 py-3 font-semibold">{item.kind}</td>
              <td className="px-4 py-3">{item.filename}</td>
              <td className="px-4 py-3">
                {item.periodStart} → {item.periodEnd}
              </td>
              <td className="px-4 py-3">{item.rowCount}</td>
              <td className="px-4 py-3">
                {new Date(item.createdAt).toLocaleString('en-IN')}
              </td>
              <td className="px-4 py-3 text-right">
                <Button kind="secondary" onClick={() => void download(item)}>
                  Download
                </Button>
                {item.kind === 'gstr2b-import' && item.importId && (
                  <Button
                    className="ml-2"
                    kind="secondary"
                    onClick={() =>
                      void reconcileGstr2b(item.importId!)
                        .then((result) =>
                          setNotice(`GSTR-2B ${result.status}; variance ${result.variance}`),
                        )
                        .catch((cause) => onError(messageOf(cause)))
                    }
                  >
                    Reconcile
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && <Empty>No export artifacts yet.</Empty>}
    </Card></div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}): React.JSX.Element {
  return (
    <label className="text-xs font-semibold text-app-muted">
      <span className="mb-2 block">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="block w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent focus:ring-2 focus:ring-app-accent/20"
      />
    </label>
  );
}
function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Unable to read the selected CSV file.'));
    };
    reader.onerror = () => reject(new Error('Unable to read the selected CSV file.'));
    reader.readAsDataURL(file);
  });
}
function saveBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return Promise.resolve();
}
