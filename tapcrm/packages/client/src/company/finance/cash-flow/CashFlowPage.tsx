import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Empty, Loading, Notice, Page } from '../../../ui/components.js';
import * as api from './cashFlowApi.js';
import { CashFlowScenarioModal } from './CashFlowScenarioModal.js';

export function CashFlowPage({
  canManage = false,
}: {
  canManage?: boolean;
}): React.JSX.Element {
  const [centre, setCentre] = useState<api.CommandCentre | null>(null);
  const [snapshots, setSnapshots] = useState<api.Snapshot[]>([]);
  const [forecast, setForecast] = useState<api.ForecastRow[]>([]);
  const [scenarios, setScenarios] = useState<api.Scenario[]>([]);
  const [scenarioForecast, setScenarioForecast] = useState<api.ScenarioForecast[]>([]);
  const [scenarioModalOpen, setScenarioModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextCentre, nextSnapshots, nextScenarios] = await Promise.all([
        api.getCommandCentre(),
        api.listSnapshots(),
        api.listScenarios(),
      ]);
      setCentre(nextCentre);
      setSnapshots(nextSnapshots);
      setScenarios(nextScenarios);
      setForecast(nextSnapshots[0] ? await api.listForecast(nextSnapshots[0].id) : []);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to load cash-flow intelligence.',
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const refresh = async () => {
    try {
      await api.createForecast({
        asOfDate: new Date().toISOString().slice(0, 10),
        baseCurrency: 'INR',
        horizonWeeks: 13,
        minimumCash: '0',
        reason: '13-week cash forecast refreshed by Finance.',
      });
      setNotice('13-week forecast refreshed.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to refresh forecast.');
    }
  };
  const openScenario = () => {
    if (!snapshots[0]) {
      setError('Create a 13-week forecast before creating a scenario.');
      return;
    }
    setError('');
    setScenarioModalOpen(true);
  };
  const createScenario = async (body: Record<string, unknown>) => {
    await api.createScenario(body);
    setScenarioModalOpen(false);
    setNotice('Scenario created.');
    await load();
  };
  const viewScenario = async (item: api.Scenario) => {
    try {
      setScenarioForecast(await api.listScenarioForecast(item.id));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to load scenario forecast.',
      );
    }
  };
  return (
    <Page
      eyebrow="Finance · Cash Flow"
      title="Cash-flow planning"
      description="Review reconciled cash, projected collections, committed outflows, forecast runway, and advisory scenarios."
    >
      {error && <Notice error>{error}</Notice>}
      {notice && (
        <div className="mt-4">
          <Notice>{notice}</Notice>
        </div>
      )}
      {loading ? (
        <Loading />
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {canManage ? (
              <>
                <Button onClick={() => void refresh()}>Refresh 13-week forecast</Button>
                <Button kind="secondary" onClick={openScenario}>
                  Create scenario
                </Button>
              </>
            ) : null}
            {snapshots[0] && (
              <span className="text-xs text-app-muted">
                Latest snapshot: {snapshots[0].asOfDate} · {snapshots[0].baseCurrency} ·{' '}
                {snapshots[0].horizonWeeks} weeks
              </span>
            )}
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {centre
              ? [
                  ['Reconciled cash', centre.reconciledCash, 'Actual cash position'],
                  [
                    'Receivables outstanding',
                    centre.receivablesOutstanding,
                    'Issued, unpaid invoices',
                  ],
                  [
                    'Approved payables',
                    centre.approvedPayables,
                    'Committed vendor outflows',
                  ],
                  [
                    'Unreconciled bank lines',
                    String(centre.unreconciledBankLines),
                    'Needs matching',
                  ],
                  ['Approved budget', centre.approvedBudget, 'Approved cost plan'],
                ].map(([label, value, hint], index) => (
                  <Card
                    key={label}
                    className={`relative overflow-hidden p-5 ${index === 0 ? 'border-app-accent/40 bg-app-accent/5' : ''}`}
                  >
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-app-muted">
                      {label}
                    </div>
                    <div className="mt-3 text-2xl font-bold tracking-tight">{value}</div>
                    <div className="mt-1 text-xs text-app-muted">{hint}</div>
                  </Card>
                ))
              : null}
          </div>
          {centre ? (
            <Card className="mt-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-app-muted">
                    Cash position
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">
                    Revenue waterfall and budget view
                  </h2>
                </div>
                <span className="rounded-full bg-app-surface px-3 py-1 text-xs text-app-muted">
                  Actuals
                </span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['Contracted', centre.contractedCash],
                  ['Issued', centre.issuedCash],
                  ['Collected', centre.collectedCash],
                  ['Actual cost', centre.actualCost],
                ].map(([label, value]) => (
                  <div
                    className="rounded-xl border border-app-border bg-app-surface p-4"
                    key={label}
                  >
                    <div className="text-xs text-app-muted">{label}</div>
                    <div className="mt-2 text-lg font-semibold">{value}</div>
                    {label === 'Actual cost' && (
                      <div className="mt-1 text-xs text-app-muted">
                        Budget {centre.approvedBudget}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
          <Card className="mt-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-app-muted">
                  Forward view
                </p>
                <h2 className="mt-1 text-lg font-semibold">13-week forecast</h2>
              </div>
              <p className="max-w-md text-xs text-app-muted">
                Closing cash uses expected collections by invoice due date, approved
                contracted events, and committed outflows.
              </p>
            </div>
            {forecast.length ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-app-border text-xs uppercase tracking-wide text-app-muted">
                      <th className="p-3">Week</th>
                      <th className="p-3">Contracted events</th>
                      <th className="p-3">Invoices issued</th>
                      <th className="p-3">Expected collections</th>
                      <th className="p-3">Payables</th>
                      <th className="p-3">Subscriptions</th>
                      <th className="p-3">Closing cash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.map((row) => (
                      <tr
                        className="border-b border-app-border last:border-0"
                        key={row.id}
                      >
                        <td className="p-3">
                          {row.bucketStart} → {row.bucketEnd}
                        </td>
                        <td className="p-3">{row.contractedCash}</td>
                        <td className="p-3">{row.issuedCash}</td>
                        <td className="p-3 font-medium">{row.expectedCollections}</td>
                        <td className="p-3">{row.payableOutflows}</td>
                        <td className="p-3">{row.recurringOutflows}</td>
                        <td
                          className={`p-3 font-bold ${Number(row.varianceToMinimum) < 0 ? 'text-red-600' : 'text-emerald-700'}`}
                        >
                          {row.closingCash}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No forecast snapshot yet. Refresh the forecast to create one.</Empty>
            )}
          </Card>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card>
              <h2 className="text-lg font-semibold">30 / 60 / 90-day outlook</h2>
              {forecast.length ? (
                <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
                  {[4, 9, 13].map((weeks, index) => {
                    const row = forecast[Math.min(weeks - 1, forecast.length - 1)];
                    return (
                      <div
                        className="rounded-xl border border-app-border p-3"
                        key={weeks}
                      >
                        <div className="text-app-muted">{[30, 60, 90][index]} days</div>
                        <div className="mt-1 font-semibold">
                          {row?.closingCash ?? '—'}
                        </div>
                        <div className="text-app-muted">projected closing cash</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Empty>No outlook yet.</Empty>
              )}
            </Card>
            <Card>
              <h2 className="text-lg font-semibold">Scenarios</h2>
              {scenarios.length ? (
                scenarios.map((item) => (
                  <div
                    className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-app-border p-3 text-sm"
                    key={item.id}
                  >
                    <div>
                      <div className="font-semibold">{item.name}</div>
                      <div className="text-app-muted">
                        {item.baseCurrency} · {item.status} · advisory only
                      </div>
                    </div>
                    <Button kind="secondary" onClick={() => void viewScenario(item)}>
                      View projection
                    </Button>
                  </div>
                ))
              ) : (
                <Empty>No scenarios.</Empty>
              )}
            </Card>
            {scenarioForecast.length ? (
              <Card className="lg:col-span-2">
                <h2 className="text-lg font-semibold">Selected scenario projection</h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-app-border">
                        <th className="p-2">Week</th>
                        <th className="p-2">Base closing cash</th>
                        <th className="p-2">Inflow adjustment</th>
                        <th className="p-2">Outflow adjustment</th>
                        <th className="p-2">Scenario closing cash</th>
                        <th className="p-2">Variance to minimum</th>
                        <th className="p-2">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenarioForecast.map((row) => (
                        <tr className="border-b border-app-border" key={row.id}>
                          <td className="p-2">
                            {row.bucketStart} → {row.bucketEnd}
                          </td>
                          <td className="p-2">{row.closingCash}</td>
                          <td className="p-2">{row.scenarioInflowDelta}</td>
                          <td className="p-2">{row.scenarioOutflowDelta}</td>
                          <td
                            className={`p-2 font-semibold ${Number(row.scenarioVarianceToMinimum) < 0 ? 'text-red-600' : ''}`}
                          >
                            {row.scenarioClosingCash}
                          </td>
                          <td
                            className={`p-2 font-semibold ${Number(row.scenarioVarianceToMinimum) < 0 ? 'text-red-600' : 'text-emerald-700'}`}
                          >
                            {row.scenarioVarianceToMinimum}
                          </td>
                          <td className="max-w-xs p-2 text-app-muted">
                            {row.note || 'No adjustment'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : null}
            <Card className="lg:col-span-2">
              <h2 className="text-lg font-semibold">Data policy</h2>
              <p className="mt-3 text-sm text-app-muted">
                Forecasts are explainable snapshots based on reconciled cash, issued
                invoices, contracted events, approved payables, subscriptions, and
                configured budgets. They never approve, message, post journals, or move
                money.
              </p>
            </Card>
          </div>
        </>
      )}
      {scenarioModalOpen && snapshots[0] && (
        <CashFlowScenarioModal
          snapshot={snapshots[0]}
          onClose={() => setScenarioModalOpen(false)}
          onSubmit={createScenario}
        />
      )}
    </Page>
  );
}
