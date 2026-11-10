import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Empty, Loading, Notice } from '../../../ui/components.js';
import * as api from './completionApi.js';
import { listAccounts, type LedgerAccount } from './accountingApi.js';
import {
  RecognitionModal,
  RevaluationModal,
  ScheduleModal,
  SyncModal,
} from './AccountingWorkflowModals.js';

function TablePager({
  pagination,
  onPage,
}: {
  pagination: api.Paginated<unknown>['pagination'] | undefined;
  onPage: (page: number) => void;
}): React.JSX.Element | null {
  if (!pagination || pagination.totalPages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between border-t border-app-border pt-3 text-xs text-app-muted">
      <span>
        Page {pagination.page} of {pagination.totalPages} · {pagination.total} records
      </span>
      <span className="flex gap-2">
        <Button
          kind="secondary"
          disabled={pagination.page <= 1}
          onClick={() => onPage(pagination.page - 1)}
        >
          Previous
        </Button>
        <Button
          kind="secondary"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => onPage(pagination.page + 1)}
        >
          Next
        </Button>
      </span>
    </div>
  );
}

export function AccountingCompletionPanel(): React.JSX.Element {
  const [data, setData] = useState<api.CompletionOverview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [recognize, setRecognize] = useState<api.Schedule | null>(null);
  const [revalueOpen, setRevalueOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const pageSize = 6;
  const [schedulePage, setSchedulePage] = useState(1);
  const [revaluationPage, setRevaluationPage] = useState(1);
  const [syncPage, setSyncPage] = useState(1);
  const [schedulePagination, setSchedulePagination] =
    useState<api.Paginated<api.Schedule>['pagination']>();
  const [revaluationPagination, setRevaluationPagination] =
    useState<api.Paginated<api.Revaluation>['pagination']>();
  const [syncPagination, setSyncPagination] =
    useState<api.Paginated<api.SyncItem>['pagination']>();
  const [entity, setEntity] = useState({ code: '', legalName: '', baseCurrency: 'INR' });
  const [entityReason, setEntityReason] = useState('');
  const load = useCallback(async () => {
    try {
      const [overview, accountResult, schedules, revaluations, syncQueue] =
        await Promise.all([
          api.getOverview(),
          listAccounts('active'),
          api.listSchedulesPage(schedulePage, pageSize),
          api.listRevaluationsPage(revaluationPage, pageSize),
          api.listSyncQueuePage(syncPage, pageSize),
        ]);
      setData({
        ...overview,
        schedules: schedules.items,
        revaluations: revaluations.items,
        syncQueue: syncQueue.items,
      });
      setAccounts(accountResult.accounts);
      setSchedulePagination(schedules.pagination);
      setRevaluationPagination(revaluations.pagination);
      setSyncPagination(syncQueue.pagination);
      setError('');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to load accounting completion data.',
      );
    }
  }, [revaluationPage, schedulePage, syncPage]);
  useEffect(() => {
    void load();
  }, [load]);
  const submitEntity = async () => {
    if (entityReason.trim().length < 3) {
      setError(
        'A reason of at least three characters is required for a legal-entity change.',
      );
      return;
    }
    setCreating(true);
    setError('');
    try {
      await api.createEntity({
        ...entity,
        timezone: 'Asia/Kolkata',
        taxRegistration: {},
        reason: entityReason.trim(),
      });
      setEntity({ code: '', legalName: '', baseCurrency: 'INR' });
      setEntityReason('');
      setNotice('Legal entity created.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create legal entity.');
    } finally {
      setCreating(false);
    }
  };
  if (!data && !error) return <Loading />;
  return (
    <div className="space-y-5">
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Accounting completion</h2>
            <p className="mt-1 text-sm text-app-muted">
              Legal entities, controlled schedules, FX revaluation, statutory evidence,
              and external synchronization.
            </p>
          </div>
          <div className="flex gap-2">
            <Button kind="secondary" onClick={() => setRevalueOpen(true)}>
              FX revaluation
            </Button>
            <Button kind="secondary" onClick={() => setSyncOpen(true)}>
              Queue sync
            </Button>
            <Button kind="secondary" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <div>
            <div className="text-app-muted">Storage</div>
            <div className="font-semibold">Backend artifacts</div>
          </div>
          <div>
            <div className="text-app-muted">External sync</div>
            <div className="font-semibold">Queued and idempotent</div>
          </div>
          <div>
            <div className="text-app-muted">Posting policy</div>
            <div className="font-semibold">Immutable and period-controlled</div>
          </div>
        </div>
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">Legal entities</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <input
            className="rounded-lg border border-app-border bg-transparent px-3 py-2"
            placeholder="Code"
            value={entity.code}
            onChange={(event) => setEntity({ ...entity, code: event.target.value })}
          />
          <input
            className="rounded-lg border border-app-border bg-transparent px-3 py-2 md:col-span-2"
            placeholder="Legal name"
            value={entity.legalName}
            onChange={(event) => setEntity({ ...entity, legalName: event.target.value })}
          />
          <input
            className="rounded-lg border border-app-border bg-transparent px-3 py-2"
            placeholder="Currency"
            maxLength={3}
            value={entity.baseCurrency}
            onChange={(event) =>
              setEntity({ ...entity, baseCurrency: event.target.value.toUpperCase() })
            }
          />
          <input
            className="rounded-lg border border-app-border bg-transparent px-3 py-2 md:col-span-4"
            placeholder="Reason for change"
            value={entityReason}
            onChange={(event) => setEntityReason(event.target.value)}
          />
        </div>
        <Button
          className="mt-3"
          disabled={
            creating ||
            !entity.code ||
            !entity.legalName ||
            entityReason.trim().length < 3
          }
          onClick={() => void submitEntity()}
        >
          Create legal entity
        </Button>
        {data?.entities.length ? (
          <div className="mt-4 divide-y divide-app-border">
            {data.entities.map((item) => (
              <div className="flex justify-between py-3 text-sm" key={item.id}>
                <span className="font-semibold">
                  {item.code} · {item.legalName}
                </span>
                <span className="text-app-muted">
                  {item.baseCurrency} · {item.timezone}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No legal entities configured.</Empty>
        )}
      </Card>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Recognition schedules</h2>
            <p className="text-sm text-app-muted">
              Deferred revenue, accrual, and prepayment schedules post through the
              immutable ledger.
            </p>
          </div>
          <Button onClick={() => setScheduleOpen(true)}>Create schedule</Button>
        </div>
        {data?.schedules.length ? (
          <div className="mt-3 divide-y divide-app-border">
            {data.schedules.map((item) => (
              <div
                className="flex items-center justify-between gap-3 py-3 text-sm"
                key={item.id}
              >
                <div>
                  <div className="font-semibold">{item.description}</div>
                  <div className="text-app-muted">
                    {item.scheduleType} · {item.recognizedAmount} / {item.totalAmount}{' '}
                    {item.currency} · {item.status}
                  </div>
                </div>
                {item.status === 'active' && (
                  <Button kind="secondary" onClick={() => setRecognize(item)}>
                    Recognize
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty>No schedules configured.</Empty>
        )}
      </Card>
      <TablePager pagination={schedulePagination} onPage={setSchedulePage} />
      <Card>
        <h2 className="text-lg font-semibold">FX revaluation history</h2>
        {data?.revaluations.length ? (
          <div className="mt-3 divide-y divide-app-border">
            {data.revaluations.map((item) => {
              const rate = item.rates[0];
              return (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                  key={item.id}
                >
                  <div>
                    <div className="font-semibold">
                      {item.asOfDate} · {rate?.currency ?? item.baseCurrency}
                    </div>
                    <div className="text-app-muted">
                      {rate?.oldBaseAmount ?? '—'} → {rate?.newBaseAmount ?? '—'}{' '}
                      {item.baseCurrency} · {item.status}
                    </div>
                  </div>
                  <span className="text-app-muted">Journal: {item.journalId ?? '—'}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty>No FX revaluations posted.</Empty>
        )}
      </Card>
      <TablePager pagination={revaluationPagination} onPage={setRevaluationPage} />
      <Card>
        <h2 className="text-lg font-semibold">External accounting sync</h2>
        {data?.syncQueue.length ? (
          <div className="mt-3 divide-y divide-app-border">
            {data.syncQueue.map((item) => (
              <div className="py-3 text-sm" key={item.id}>
                <div className="font-semibold">
                  {item.provider} · {item.sourceType}
                </div>
                <div className="text-app-muted">
                  {item.status} · attempts {item.attempts}
                  {item.lastError ? ` · ${item.lastError}` : ''}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No synchronization items queued.</Empty>
        )}
      </Card>
      <TablePager pagination={syncPagination} onPage={setSyncPage} />
      {scheduleOpen && (
        <ScheduleModal
          accounts={accounts}
          entities={data?.entities ?? []}
          onClose={() => setScheduleOpen(false)}
          onSubmit={async (body) => {
            await api.createSchedule(body);
            setScheduleOpen(false);
            setNotice('Recognition schedule created.');
            await load();
          }}
        />
      )}
      {recognize && (
        <RecognitionModal
          schedule={recognize}
          onClose={() => setRecognize(null)}
          onSubmit={async (amount, entryDate, reason) => {
            await api.recognizeSchedule(recognize.id, { amount, entryDate, reason });
            setRecognize(null);
            setNotice('Schedule amount recognized and posted.');
            await load();
          }}
        />
      )}
      {revalueOpen && (
        <RevaluationModal
          accounts={accounts}
          entities={data?.entities ?? []}
          onClose={() => setRevalueOpen(false)}
          onSubmit={async (body) => {
            await api.createRevaluation(body);
            setRevalueOpen(false);
            setNotice('FX revaluation posted.');
            await load();
          }}
        />
      )}
      {syncOpen && (
        <SyncModal
          entities={data?.entities ?? []}
          onClose={() => setSyncOpen(false)}
          onSubmit={async (body) => {
            await api.enqueueSync(body);
            setSyncOpen(false);
            setNotice('Accounting synchronization queued.');
            await load();
          }}
        />
      )}
    </div>
  );
}
