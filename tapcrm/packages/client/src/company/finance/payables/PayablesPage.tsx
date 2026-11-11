import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Empty, Loading, Notice, Page } from '../../../ui/components.js';
import * as api from './payablesApi.js';
import {
  PayablesFormModal,
  PayablesReasonModal,
  type PayablesFormKind,
  type PayablesFormValues,
} from './PayablesFormModal.js';

interface PendingAction {
  title: string;
  description: string;
  execute: (reason: string) => Promise<void>;
}

export function PayablesPage(): React.JSX.Element {
  const [vendors, setVendors] = useState<api.Vendor[]>([]);
  const [bills, setBills] = useState<api.Bill[]>([]);
  const [runs, setRuns] = useState<api.PaymentRun[]>([]);
  const [bankChanges, setBankChanges] = useState<api.BankChange[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<api.PurchaseRequest[]>([]);
  const [subscriptions, setSubscriptions] = useState<api.Subscription[]>([]);
  const [reimbursementClaims, setReimbursementClaims] = useState<
    api.ReimbursementClaim[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formKind, setFormKind] = useState<PayablesFormKind | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<
    api.PurchaseRequest | undefined
  >();
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pages, setPages] = useState<Record<string, number>>({});
  const [totals, setTotals] = useState<Record<string, number>>({});
  const pageSize = 6;
  const load = useCallback(
    async (requestedPages = pages) => {
      setLoading(true);
      try {
        const [
          nextVendors,
          nextBills,
          nextRuns,
          nextBankChanges,
          nextPurchaseRequests,
          nextSubscriptions,
        ] = await Promise.all([
          api.listVendors(requestedPages['vendors'] ?? 1, pageSize),
          api.listBills(requestedPages['bills'] ?? 1, pageSize),
          api.listRuns(requestedPages['runs'] ?? 1, pageSize),
          api.listBankChanges(requestedPages['bankChanges'] ?? 1, pageSize),
          api.listPurchaseRequests(requestedPages['purchaseRequests'] ?? 1, pageSize),
          api.listSubscriptions(requestedPages['subscriptions'] ?? 1, pageSize),
        ]);
        setVendors(nextVendors.items);
        setBills(nextBills.items);
        setRuns(nextRuns.items);
        setBankChanges(nextBankChanges.items);
        setPurchaseRequests(nextPurchaseRequests.items);
        setSubscriptions(nextSubscriptions.items);
        setTotals({
          vendors: nextVendors.pagination.total,
          bills: nextBills.pagination.total,
          runs: nextRuns.pagination.total,
          bankChanges: nextBankChanges.pagination.total,
          purchaseRequests: nextPurchaseRequests.pagination.total,
          subscriptions: nextSubscriptions.pagination.total,
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Unable to load payables.');
      } finally {
        setLoading(false);
      }
    },
    [pages],
  );
  useEffect(() => {
    void load(pages);
  }, [load, pages]);
  useEffect(() => {
    if (formKind !== 'reimbursement') return;
    void api
      .listReimbursementClaims()
      .then(setReimbursementClaims)
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to load approved expense claims.',
        ),
      );
  }, [formKind]);
  const openForm = (
    kind: PayablesFormKind,
    request?: api.PurchaseRequest,
    vendorId = '',
  ) => {
    setSelectedRequest(request);
    setSelectedVendorId(vendorId);
    setFormKind(kind);
    setError('');
  };
  const submitForm = async (values: PayablesFormValues) => {
    if (!formKind) return;
    const reason = values.reason.trim();
    if (formKind === 'vendor')
      await api.createVendor({
        legalName: values.legalName,
        displayName: values.displayName,
        ...(values.email ? { email: values.email } : {}),
        ...(values.phone ? { phone: values.phone } : {}),
        ...(values.gstin ? { gstin: values.gstin } : {}),
        ...(values.pan ? { pan: values.pan } : {}),
        currency: values.currency,
        paymentTermsDays: Number(values.paymentTermsDays),
      });
    if (formKind === 'bankChange')
      await api.createBankChange(values.vendorId, {
        bankName: values.bankName,
        accountReference: values.accountReference,
        ...(values.ifsc ? { ifsc: values.ifsc } : {}),
        reason,
      });
    if (formKind === 'bill')
      await api.createBill({
        ...(values.vendorId ? { vendorId: values.vendorId } : {}),
        invoiceNumber: values.invoiceNumber,
        issueDate: values.issueDate,
        dueDate: values.dueDate,
        currency: values.currency,
        subtotal: values.subtotal,
        taxTotal: values.taxTotal,
        total: values.total,
        ...(values.tdsSection ? { tdsSection: values.tdsSection } : {}),
        tdsRate: Number(values.tdsRate || 0),
        rcm: values.rcm === 'true',
        extractionStatus: values.artifactData ? 'needs_review' : 'manual',
        reason,
        ...(values.artifactData
          ? {
              artifact: {
                originalFilename: values.artifactFilename,
                mimeType: values.artifactMimeType,
                data: values.artifactData,
              },
            }
          : {}),
      });
    if (formKind === 'subscription')
      await api.createSubscription({
        vendorId: values.vendorId,
        name: values.name,
        amount: values.amount,
        currency: values.currency,
        recurrence: values.recurrence,
        nextDueDate: values.nextDueDate,
        reason,
      });
    if (formKind === 'purchase')
      await api.createPurchaseRequest({
        ...(values.vendorId ? { vendorId: values.vendorId } : {}),
        description: values.description,
        amount: values.amount,
        currency: values.currency,
        reason,
      });
    if (formKind === 'reimbursement')
      await api.createReimbursement(values.claimId, reason);
    if (formKind === 'match' && selectedRequest)
      await api.matchPurchaseRequest(selectedRequest.id, values.billId, reason);
    setFormKind(null);
    setSelectedRequest(undefined);
    setNotice('Payables record saved successfully.');
    await load();
  };
  const requestAction = (
    title: string,
    description: string,
    execute: (reason: string) => Promise<void>,
  ) => {
    setError('');
    setPendingAction({ title, description, execute });
  };
  const proposeRun = () =>
    requestAction(
      'Propose payment run',
      'This creates immutable payment-run manifests from all approved bills that are not already in an active run. One manifest is created per currency.',
      async (reason) => {
        const candidates = await api.listPaymentRunCandidates();
        if (!candidates.length)
          throw new Error('No approved bills are available for a payment run.');
        const byCurrency = new Map<string, api.PaymentRunCandidate[]>();
        for (const candidate of candidates)
          byCurrency.set(candidate.currency, [
            ...(byCurrency.get(candidate.currency) ?? []),
            candidate,
          ]);
        for (const [currency, currencyBills] of byCurrency)
          await api.createRun(
            currencyBills.map((bill) => bill.id),
            currency,
            reason,
          );
        setNotice(
          `${byCurrency.size} payment-run manifest${byCurrency.size === 1 ? '' : 's'} created.`,
        );
        await load();
      },
    );
  const approve = (bill: api.Bill) =>
    requestAction(
      'Approve bill',
      `Approve and post invoice ${bill.invoiceNumber}? Review the invoice and provide the approval reason.`,
      async (reason) => {
        await api.approveBill(bill.id, reason);
        setNotice(`Bill ${bill.invoiceNumber} approved and posted.`);
        await load();
      },
    );
  const confirmExtraction = (bill: api.Bill) =>
    requestAction(
      'Confirm bill extraction',
      `Confirm that the extracted values for ${bill.invoiceNumber} have been reviewed by a human.`,
      async (reason) => {
        await api.confirmExtraction(bill.id, reason);
        setNotice(`Extraction confirmed for ${bill.invoiceNumber}.`);
        await load();
      },
    );
  const approveRun = (run: api.PaymentRun) =>
    requestAction(
      'Approve payment run',
      'This approves the immutable payment-run manifest for execution. Confirm the review reason.',
      async (reason) => {
        await api.approveRun(run.id, reason);
        setNotice('Payment run approved.');
        await load();
      },
    );
  const executeRun = (run: api.PaymentRun) =>
    requestAction(
      'Execute payment run',
      'This executes the approved payment-run manifest and posts the related accounting entries. Confirm the execution reason.',
      async (reason) => {
        await api.executeRun(run.id, reason);
        setNotice('Payment run executed and ledger posted.');
        await load();
      },
    );
  const approvePurchaseRequest = (request: api.PurchaseRequest) =>
    requestAction(
      'Approve purchase request',
      `Approve the purchase request “${request.description}”? Provide the review reason.`,
      async (reason) => {
        await api.approvePurchaseRequest(request.id, reason);
        setNotice('Purchase request approved.');
        await load();
      },
    );
  const matchPurchaseRequest = (request: api.PurchaseRequest) =>
    openForm('match', request);
  const pager = (key: string) => {
    const total = totals[key] ?? 0;
    const totalPages = Math.ceil(total / pageSize);
    if (totalPages <= 1) return null;
    const page = Math.min(pages[key] ?? 1, totalPages);
    return (
      <div className="mt-4 flex items-center justify-between border-t border-app-border pt-3 text-xs text-app-muted">
        <span>
          Page {page} of {totalPages} · {total} records
        </span>
        <span className="flex gap-2">
          <Button
            kind="secondary"
            disabled={page <= 1}
            onClick={() => setPages((current) => ({ ...current, [key]: page - 1 }))}
          >
            Previous
          </Button>
          <Button
            kind="secondary"
            disabled={page >= totalPages}
            onClick={() => setPages((current) => ({ ...current, [key]: page + 1 }))}
          >
            Next
          </Button>
        </span>
      </div>
    );
  };
  const approveBankChange = (change: api.BankChange) =>
    requestAction(
      'Approve vendor bank change',
      `Approve the proposed bank change for ${change.vendorName}? Provide the review reason.`,
      async (reason) => {
        await api.approveBankChange(change.id, reason);
        setNotice('Vendor bank change approved.');
        await load();
      },
    );
  return (
    <Page
      eyebrow="Finance · Payables"
      title="Payables"
      description="Manage vendors, bills, approved reimbursements, and controlled payment runs."
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
          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={() => openForm('vendor')}>Add vendor</Button>
            <Button kind="secondary" onClick={() => openForm('bill')}>
              Add bill
            </Button>
            <Button kind="secondary" onClick={() => openForm('subscription')}>
              Add subscription
            </Button>
            <Button kind="secondary" onClick={() => openForm('purchase')}>
              New purchase request
            </Button>
            <Button kind="secondary" onClick={() => openForm('reimbursement')}>
              Import approved expense
            </Button>
            <Button kind="secondary" onClick={proposeRun}>
              Propose payment run
            </Button>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card>
              <h2 className="text-lg font-semibold">Vendor master</h2>
              {vendors.length ? (
                <>
                  <div className="mt-3 space-y-2 text-sm">
                    {vendors.map((vendor) => (
                      <div
                        className="rounded-xl border border-app-border p-3"
                        key={vendor.id}
                      >
                        <span className="font-semibold">{vendor.displayName}</span> ·{' '}
                        {vendor.currency} · {vendor.status}
                        <p className="text-app-muted">
                          Terms: {vendor.paymentTermsDays} days
                        </p>
                        <Button
                          kind="secondary"
                          className="mt-2"
                          onClick={() => openForm('bankChange', undefined, vendor.id)}
                        >
                          Propose bank change
                        </Button>
                      </div>
                    ))}
                  </div>
                  {pager('vendors')}
                </>
              ) : (
                <Empty>No vendors.</Empty>
              )}
            </Card>
            <Card>
              <h2 className="text-lg font-semibold">Bill inbox</h2>
              {bills.length ? (
                <>
                  <div className="mt-3 space-y-2 text-sm">
                    {bills.map((bill) => (
                      <div
                        className="flex items-center justify-between gap-3 rounded-xl border border-app-border p-3"
                        key={bill.id}
                      >
                        <div>
                          <span className="font-semibold">{bill.invoiceNumber}</span> ·{' '}
                          {bill.vendorName ?? 'Employee reimbursement'}
                          <p className="text-app-muted">
                            {bill.total} {bill.currency} · {bill.status} · extraction:{' '}
                            {bill.extractionStatus}
                          </p>
                          {bill.artifactFilename ? (
                            <a
                              className="mt-1 inline-block text-xs font-semibold text-app-accent hover:underline"
                              href={`/api/payables/bills/${bill.id}/artifact`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open {bill.artifactFilename}
                            </a>
                          ) : null}
                        </div>
                        <div className="flex gap-2">
                          {bill.extractionStatus === 'needs_review' ? (
                            <Button
                              kind="secondary"
                              onClick={() => confirmExtraction(bill)}
                            >
                              Confirm extraction
                            </Button>
                          ) : null}
                          {bill.status === 'needs_review' &&
                          bill.extractionStatus !== 'needs_review' ? (
                            <Button onClick={() => approve(bill)}>Approve</Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  {pager('bills')}
                </>
              ) : (
                <Empty>No bills.</Empty>
              )}
            </Card>
          </div>
          <Card className="mt-5">
            <h2 className="text-lg font-semibold">Payment-run proposals</h2>
            {runs.length ? (
              <>
                <div className="mt-3 space-y-2 text-sm">
                  {runs.map((run) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-xl border border-app-border p-3"
                      key={run.id}
                    >
                      <div>
                        <span className="font-semibold">
                          {run.total} {run.currency}
                        </span>{' '}
                        · {run.status}
                        <p className="text-app-muted">
                          Manifest: {run.manifestSha256.slice(0, 16)}…
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {run.status === 'proposed' ? (
                          <Button onClick={() => approveRun(run)}>Approve</Button>
                        ) : null}
                        {run.status === 'approved' ? (
                          <Button onClick={() => executeRun(run)}>Execute</Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                {pager('runs')}
              </>
            ) : (
              <Empty>No payment runs.</Empty>
            )}
          </Card>
          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            <Card>
              <h2 className="text-lg font-semibold">Purchase requests</h2>
              {purchaseRequests.length ? (
                <>
                  {purchaseRequests.map((request) => (
                    <div
                      className="mt-3 rounded-xl border border-app-border p-3 text-sm"
                      key={request.id}
                    >
                      <div className="font-semibold">{request.description}</div>
                      <div className="text-app-muted">
                        {request.amount} {request.currency} · {request.status}
                      </div>
                      <div className="mt-2 flex gap-2">
                        {request.status === 'pending' ? (
                          <Button onClick={() => approvePurchaseRequest(request)}>
                            Approve
                          </Button>
                        ) : null}
                        {request.status === 'approved' ? (
                          <Button
                            kind="secondary"
                            onClick={() => void matchPurchaseRequest(request)}
                          >
                            Match bill
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {pager('purchaseRequests')}
                </>
              ) : (
                <Empty>No purchase requests.</Empty>
              )}
            </Card>
            <Card>
              <h2 className="text-lg font-semibold">Vendor bank changes</h2>
              {bankChanges.length ? (
                <>
                  {bankChanges.map((change) => (
                    <div
                      className="mt-3 rounded-xl border border-app-border p-3 text-sm"
                      key={change.id}
                    >
                      <div className="font-semibold">
                        {change.vendorName} · {change.bankName}
                      </div>
                      <div className="text-app-muted">
                        {change.accountReference} · {change.status}
                      </div>
                      {change.status === 'pending' ? (
                        <Button
                          className="mt-2"
                          onClick={() => approveBankChange(change)}
                        >
                          Approve change
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  {pager('bankChanges')}
                </>
              ) : (
                <Empty>No bank changes.</Empty>
              )}
            </Card>
            <Card>
              <h2 className="text-lg font-semibold">Subscriptions</h2>
              {subscriptions.length ? (
                <>
                  {subscriptions.map((subscription) => (
                    <div
                      className="mt-3 rounded-xl border border-app-border p-3 text-sm"
                      key={subscription.id}
                    >
                      <div className="font-semibold">
                        {subscription.name} · {subscription.vendorName}
                      </div>
                      <div className="text-app-muted">
                        {subscription.amount} {subscription.currency} ·{' '}
                        {subscription.recurrence} · next {subscription.nextDueDate}
                      </div>
                    </div>
                  ))}
                  {pager('subscriptions')}
                </>
              ) : (
                <Empty>No subscriptions.</Empty>
              )}
            </Card>
          </div>
        </>
      )}
      {formKind && (
        <PayablesFormModal
          kind={formKind}
          vendors={vendors}
          bills={bills}
          reimbursementClaims={reimbursementClaims}
          request={selectedRequest}
          selectedVendorId={selectedVendorId}
          onClose={() => {
            setFormKind(null);
            setSelectedRequest(undefined);
            setSelectedVendorId('');
          }}
          onSubmit={submitForm}
        />
      )}
      {pendingAction && (
        <PayablesReasonModal
          title={pendingAction.title}
          description={pendingAction.description}
          onClose={() => setPendingAction(null)}
          onSubmit={async (reason) => {
            await pendingAction.execute(reason);
            setPendingAction(null);
          }}
        />
      )}
    </Page>
  );
}
