import { useEffect, useState } from 'react';
import { Button, Card, Empty, Loading, Notice, Page } from '../../../ui/components.js';
import * as api from './receivablesApi.js';
import {
  ReceivablesActionModal,
  type ReceivablesAction,
} from './ReceivablesActionModal.js';

export function ReceivablesPage(): React.JSX.Element {
  const [aging, setAging] = useState<api.ReceivableAging[]>([]);
  const [agingBuckets, setAgingBuckets] = useState<api.AgingBucket[]>([]);
  const [collections, setCollections] = useState<api.CollectionActivity[]>([]);
  const [disputes, setDisputes] = useState<api.Dispute[]>([]);
  const [promises, setPromises] = useState<api.PromiseToPay[]>([]);
  const [tasks, setTasks] = useState<api.CollectionTask[]>([]);
  const [statementClients, setStatementClients] = useState<api.StatementClient[]>([]);
  const [statement, setStatement] = useState<api.StatementLine[]>([]);
  const [statementClient, setStatementClient] = useState<api.StatementClient | null>(
    null,
  );
  const [reminders, setReminders] = useState<api.Reminder[]>([]);
  const [writeOffs, setWriteOffs] = useState<api.WriteOff[]>([]);
  const [modal, setModal] = useState<{
    action: ReceivablesAction;
    invoice?: api.ReceivableAging;
    client?: api.StatementClient;
    item?: api.Dispute | api.PromiseToPay;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async () => {
    setLoading(true);
    try {
      const [
        nextAging,
        nextAgingBuckets,
        nextCollections,
        nextDisputes,
        nextPromises,
        nextTasks,
        nextClients,
        nextReminders,
        nextWriteOffs,
      ] = await Promise.all([
        api.listAging(),
        api.listAgingBuckets(),
        api.listCollections(),
        api.listDisputes(),
        api.listPromises(),
        api.listTasks(),
        api.listStatementClients(),
        api.listReminders(),
        api.listWriteOffs(),
      ]);
      setAging(nextAging);
      setAgingBuckets(nextAgingBuckets);
      setCollections(nextCollections);
      setDisputes(nextDisputes);
      setPromises(nextPromises);
      setTasks(nextTasks);
      setStatementClients(nextClients);
      setReminders(nextReminders);
      setWriteOffs(nextWriteOffs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load receivables.');
    } finally {
      setLoading(false);
    }
  };
  const openStatement = async (client: api.StatementClient) => {
    try {
      setStatement(await api.getStatement(client.id));
      setStatementClient(client);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to load client statement.',
      );
    }
  };
  const submitModal = async (values: Record<string, string>) => {
    if (!modal) return;
    const valueOf = (key: string) => values[key] ?? '';
    const iso = (value: string) => new Date(value).toISOString();
    if (modal.action === 'schedule' && modal.client) {
      await api.setDunningSchedule({
        clientId: modal.client.id,
        enabled: true,
        cadenceDays: Number(valueOf('cadenceDays')),
        nextRunAt: iso(valueOf('nextRunAt')),
        reason: valueOf('reason'),
      });
      setNotice(`Reminder schedule saved for ${modal.client.businessName}.`);
    } else if (modal.action === 'follow-up' && modal.invoice) {
      await api.dunInvoice(modal.invoice.id, valueOf('reason'));
      setNotice(`Collection activity created for ${modal.invoice.invoiceNumber}.`);
    } else if (modal.action === 'dispute' && modal.invoice) {
      await api.createDispute(modal.invoice.id, {
        holdCollections: valueOf('holdCollections') === 'true',
        reason: valueOf('reason'),
      });
      setNotice(`Dispute hold created for ${modal.invoice.invoiceNumber}.`);
    } else if (modal.action === 'promise' && modal.invoice) {
      await api.createPromise(modal.invoice.id, {
        promisedAmount: valueOf('amount'),
        promisedFor: iso(valueOf('promisedFor')),
        reason: valueOf('reason'),
      });
      setNotice(`Promise-to-pay recorded for ${modal.invoice.invoiceNumber}.`);
    } else if (modal.action === 'write-off' && modal.invoice) {
      await api.proposeWriteOff(modal.invoice.id, {
        amount: valueOf('amount'),
        reason: valueOf('reason'),
      });
      setNotice(`Write-off proposed for ${modal.invoice.invoiceNumber}.`);
    } else if (modal.action === 'task' && modal.invoice) {
      await api.createTask({
        clientId: modal.invoice.clientId,
        invoiceId: modal.invoice.id,
        taskType: valueOf('taskType'),
        dueAt: iso(valueOf('dueAt')),
        title: valueOf('title'),
        reason: valueOf('reason'),
      });
      setNotice(`Collection task created for ${modal.invoice.invoiceNumber}.`);
    } else if (
      modal.action === 'resolve-dispute' &&
      modal.item &&
      'invoiceId' in modal.item
    ) {
      await api.resolveDispute(modal.item.id, {
        status: valueOf('status'),
        resolution: valueOf('resolution'),
      });
      setNotice(`Dispute resolved for ${modal.item.invoiceNumber}.`);
    } else if (
      modal.action === 'resolve-promise' &&
      modal.item &&
      'promisedAmount' in modal.item
    ) {
      await api.resolvePromise(modal.item.id, {
        status: valueOf('status'),
        reason: valueOf('reason'),
      });
      setNotice(`Promise updated for ${modal.item.invoiceNumber}.`);
    }
    setModal(null);
    await load();
  };
  useEffect(() => {
    void load();
  }, []);
  const dun = async (invoice: api.ReceivableAging) => {
    setModal({ action: 'follow-up', invoice });
  };
  return (
    <Page
      eyebrow="Finance · Receivables"
      title="Receivables & collections"
      description="Monitor invoice balances, overdue amounts, and collection follow-up activities."
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
          <Card className="mt-5">
            <h2 className="text-lg font-semibold">Aging and outstanding balances</h2>
            {aging.length === 0 ? (
              <div className="mt-4">
                <Empty>No issued receivables.</Empty>
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-app-border">
                      <th className="p-2">Invoice</th>
                      <th className="p-2">Due</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Outstanding (minor)</th>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {aging.map((invoice) => (
                      <tr key={invoice.id} className="border-b border-app-border">
                        <td className="p-2 font-semibold">{invoice.invoiceNumber}</td>
                        <td className="p-2">
                          {invoice.dueDate}
                          {invoice.daysOverdue > 0
                            ? ` · ${invoice.daysOverdue}d overdue`
                            : ''}
                        </td>
                        <td className="p-2">{invoice.status}</td>
                        <td className="p-2">{invoice.outstandingMinor}</td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              onClick={() => void dun(invoice)}
                              disabled={invoice.outstandingMinor === '0'}
                            >
                              Follow-up
                            </Button>
                            <Button
                              type="button"
                              kind="secondary"
                              onClick={() => setModal({ action: 'dispute', invoice })}
                              disabled={invoice.outstandingMinor === '0'}
                            >
                              Dispute
                            </Button>
                            <Button
                              type="button"
                              kind="secondary"
                              onClick={() => setModal({ action: 'promise', invoice })}
                              disabled={invoice.outstandingMinor === '0'}
                            >
                              Promise
                            </Button>
                            <Button
                              type="button"
                              kind="secondary"
                              onClick={() => setModal({ action: 'write-off', invoice })}
                              disabled={invoice.outstandingMinor === '0'}
                            >
                              Propose write-off
                            </Button>
                            <Button
                              type="button"
                              kind="secondary"
                              onClick={() => setModal({ action: 'task', invoice })}
                              disabled={invoice.outstandingMinor === '0'}
                            >
                              Create task
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card className="mt-5">
            <h2 className="text-lg font-semibold">Aging buckets</h2>
            {agingBuckets.length === 0 ? (
              <Empty>No outstanding aging buckets.</Empty>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {agingBuckets.map((bucket) => (
                  <div
                    key={`${bucket.currency}-${bucket.bucket}`}
                    className="rounded-xl border border-app-border p-3 text-sm"
                  >
                    <div className="font-semibold">
                      {bucket.bucket} · {bucket.currency}
                    </div>
                    <div className="mt-1 text-app-muted">
                      {bucket.invoiceCount} invoices
                    </div>
                    <div className="mt-1">
                      {bucket.outstandingMinor} minor outstanding
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            <Card>
              <h2 className="text-lg font-semibold">Dispute holds</h2>
              {disputes.length === 0 ? (
                <Empty>No disputes.</Empty>
              ) : (
                <div className="mt-3 space-y-2 text-sm">
                  {disputes.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-app-border p-3"
                    >
                      <span className="font-semibold">{item.invoiceNumber}</span> ·{' '}
                      {item.status}
                      <p className="text-app-muted">{item.reason}</p>
                      {item.status === 'open' || item.status === 'under_review' ? (
                        <Button
                          className="mt-2"
                          type="button"
                          onClick={() => setModal({ action: 'resolve-dispute', item })}
                        >
                          Resolve
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card>
              <h2 className="text-lg font-semibold">Promises to pay</h2>
              {promises.length === 0 ? (
                <Empty>No promises.</Empty>
              ) : (
                <div className="mt-3 space-y-2 text-sm">
                  {promises.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-app-border p-3"
                    >
                      <span className="font-semibold">{item.invoiceNumber}</span> ·{' '}
                      {item.status}
                      <p className="text-app-muted">
                        {item.promisedAmount} by {item.promisedFor}
                      </p>
                      {item.status === 'open' ? (
                        <Button
                          className="mt-2"
                          type="button"
                          onClick={() => setModal({ action: 'resolve-promise', item })}
                        >
                          Update status
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card>
              <h2 className="text-lg font-semibold">Collection tasks</h2>
              {tasks.length === 0 ? (
                <Empty>No collection tasks.</Empty>
              ) : (
                <div className="mt-3 space-y-2 text-sm">
                  {tasks.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-app-border p-3"
                    >
                      <span className="font-semibold">{item.title}</span> · {item.status}
                      {item.status !== 'completed' && (
                        <Button
                          className="mt-2"
                          type="button"
                          onClick={() =>
                            void api
                              .updateTask(item.id, {
                                status: 'completed',
                                reason: 'Completed from receivables workspace.',
                              })
                              .then(load)
                              .catch((cause) =>
                                setError(
                                  cause instanceof Error
                                    ? cause.message
                                    : 'Unable to update task.',
                                ),
                              )
                          }
                        >
                          Complete
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
          <Card className="mt-5">
            <h2 className="text-lg font-semibold">Collection activity</h2>
            {collections.length === 0 ? (
              <div className="mt-4">
                <Empty>No collection activity.</Empty>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {collections.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-app-border p-3 text-sm"
                  >
                    <span className="font-semibold">
                      {item.invoiceNumber ?? 'Client follow-up'}
                    </span>{' '}
                    · {item.activityType} · {item.status}
                    <p className="mt-1 text-app-muted">{item.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card>
              <h2 className="text-lg font-semibold">Client statements</h2>
              {statementClients.length === 0 ? (
                <Empty>No issued client statements.</Empty>
              ) : (
                <div className="mt-3 space-y-2 text-sm">
                  {statementClients.map((client) => (
                    <div
                      key={client.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-app-border p-3"
                    >
                      <div>
                        <span className="font-semibold">{client.businessName}</span>
                        <p className="text-app-muted">
                          {client.invoiceCount} invoices · {client.outstandingMinor} minor
                          outstanding
                        </p>
                      </div>
                      <Button
                        type="button"
                        kind="secondary"
                        onClick={() => void openStatement(client)}
                      >
                        View
                      </Button>
                      <Button
                        type="button"
                        kind="secondary"
                        onClick={() => setModal({ action: 'schedule', client })}
                      >
                        Schedule
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {statementClient && (
                <div className="mt-4 rounded-xl border border-app-border p-3 text-sm">
                  <div className="font-semibold">{statementClient.businessName}</div>
                  {statement.map((line) => (
                    <div
                      key={line.id}
                      className="mt-2 flex justify-between border-t border-app-border pt-2"
                    >
                      <span>
                        {line.invoiceNumber} · {line.status}
                      </span>
                      <span>{line.outstandingMinor} outstanding</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card>
              <h2 className="text-lg font-semibold">Write-offs and reminders</h2>
              <div className="mt-3 space-y-2 text-sm">
                {writeOffs.map((item) => (
                  <div key={item.id} className="rounded-xl border border-app-border p-3">
                    <span className="font-semibold">{item.invoiceNumber}</span> ·{' '}
                    {item.amount} · {item.status}
                    {item.status === 'proposed' ? (
                      <Button
                        className="ml-2"
                        type="button"
                        onClick={() =>
                          void api
                            .approveWriteOff(
                              item.id,
                              'Approved from receivables workspace.',
                            )
                            .then(load)
                            .catch((cause) =>
                              setError(
                                cause instanceof Error
                                  ? cause.message
                                  : 'Unable to approve write-off.',
                              ),
                            )
                        }
                      >
                        Approve
                      </Button>
                    ) : null}
                  </div>
                ))}
                {reminders.slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-app-border p-3 text-app-muted"
                  >
                    Reminder · {item.invoiceNumber} · {item.reminderDate} (
                    {item.localTimezone}) · {item.status}
                  </div>
                ))}
                {writeOffs.length === 0 && reminders.length === 0 ? (
                  <Empty>No write-offs or reminders.</Empty>
                ) : null}
              </div>
            </Card>
          </div>
        </>
      )}
      {modal && (
        <ReceivablesActionModal
          action={modal.action}
          {...(modal.invoice ? { invoice: modal.invoice } : {})}
          {...(modal.client ? { client: modal.client } : {})}
          {...(modal.item ? { item: modal.item } : {})}
          onClose={() => setModal(null)}
          onSubmit={submitModal}
        />
      )}
    </Page>
  );
}
