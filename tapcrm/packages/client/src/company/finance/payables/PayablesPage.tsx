import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Loading,
  Modal,
  Notice,
  Page,
} from '../../../ui/components.js';
import { getIdentitySessionSnapshot } from '../../../identity/api/authApi.js';
import { identityDownload } from '../../../identity/api/authApi.js';
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

function PayablesDetailsModal({
  title,
  record,
  document,
  onClose,
}: {
  title: string;
  record: object;
  document?: { billId: string; filename: string; mimeType: string };
  onClose: () => void;
}): React.JSX.Element {
  const values = Object.entries(record);
  const status =
    (record as { status?: unknown; Status?: unknown }).status ??
    (record as { Status?: unknown }).Status;
  const formatValue = (value: unknown) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    if (typeof value === 'string') return value;
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    )
      return value.toString();
    return '—';
  };
  return (
    <Modal title={title} onClose={onClose} size="lg">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border bg-app-background p-4">
        <p className="text-sm text-app-muted">Business record details</p>
        {status !== undefined && (
          <span className="rounded-full border border-app-accent/30 bg-app-accent/10 px-3 py-1 text-xs font-bold capitalize text-app-accent">
            {formatValue(status).replaceAll('_', ' ')}
          </span>
        )}
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        {values.map(([key, value]) => (
          <div
            key={key}
            className={`rounded-xl border border-app-border bg-app-background p-3 ${typeof value === 'object' ? 'sm:col-span-2' : ''}`}
          >
            <dt className="text-xs font-semibold uppercase tracking-wide text-app-muted">
              {key
                .replace(/[A-Z]/g, (letter) => ` ${letter}`)
                .replace(/^./, (letter) => letter.toUpperCase())}
            </dt>
            <dd
              className={`mt-1 whitespace-pre-wrap break-words text-sm text-app-foreground ${typeof value === 'object' ? 'rounded-lg bg-black/5 p-2 font-mono text-xs' : ''}`}
            >
              {formatValue(value)}
            </dd>
          </div>
        ))}
      </dl>
      {document && (
        <section className="mt-5 border-t border-app-border pt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-app-foreground">
                Invoice document
              </h3>
              <p className="mt-1 text-xs text-app-muted">
                {document.filename} · {document.mimeType}
              </p>
            </div>
          </div>
          <BillDocumentPreview {...document} />
        </section>
      )}
    </Modal>
  );
}

function BillDocumentPreview({
  billId,
  filename,
  mimeType,
}: {
  billId: string;
  filename: string;
  mimeType: string;
}): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    void identityDownload(`/api/payables/bills/${billId}/artifact`)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : 'Unable to preview this document.',
          );
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [billId]);
  if (error) return <Notice error>{error}</Notice>;
  if (!url)
    return (
      <p className="rounded-lg border border-app-border p-4 text-sm text-app-muted">
        Loading {filename}…
      </p>
    );
  if (mimeType === 'application/pdf') {
    return (
      <iframe
        title={`Preview of ${filename}`}
        src={url}
        className="h-[60vh] w-full rounded-lg border border-app-border"
      />
    );
  }
  if (mimeType === 'image/png' || mimeType === 'image/jpeg') {
    return (
      <img
        src={url}
        alt={`Preview of ${filename}`}
        className="max-h-[60vh] w-full rounded-lg border border-app-border object-contain"
      />
    );
  }
  return (
    <a
      className="text-sm font-semibold text-app-accent hover:underline"
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      Open {filename}
    </a>
  );
}

const vendorDetails = (vendor: api.Vendor) => ({
  'Legal name': vendor.legalName,
  'Display name': vendor.displayName,
  Email: vendor.email,
  Phone: vendor.phone,
  GSTIN: vendor.gstin,
  PAN: vendor.pan,
  Currency: vendor.currency,
  'Payment terms': `${vendor.paymentTermsDays} days`,
  Status: vendor.status,
});

const billDetails = (bill: api.Bill) => ({
  Vendor: bill.vendorName ?? 'Employee reimbursement',
  'Invoice number': bill.invoiceNumber,
  'Issue date': bill.issueDate,
  'Due date': bill.dueDate,
  Subtotal: `${bill.subtotal} ${bill.currency}`,
  'Tax total': `${bill.taxTotal} ${bill.currency}`,
  Total: `${bill.total} ${bill.currency}`,
  'TDS section': bill.tdsSection,
  'TDS rate': `${bill.tdsRate}%`,
  'Reverse charge': bill.rcm ? 'Yes' : 'No',
  'Source type': bill.sourceType,
  Document: bill.artifactFilename ?? 'Not uploaded',
  'Extraction status': bill.extractionStatus,
  Status: bill.status,
});

const paymentRunDetails = (run: api.PaymentRun) => ({
  Currency: run.currency,
  Total: `${run.total} ${run.currency}`,
  'Included bills': Array.isArray(run.manifest?.['bills'])
    ? run.manifest['bills'].length
    : '—',
  Status: run.status,
  'Accounting journal': run.journalId ?? 'Not posted',
});

const purchaseRequestDetails = (request: api.PurchaseRequest) => ({
  Vendor: request.vendorName ?? 'Not specified',
  Requester: request.requesterName,
  Description: request.description,
  Amount: `${request.amount} ${request.currency}`,
  Status: request.status,
  Approver: request.approverName ?? 'Not approved',
  'Matched bill': request.matchedBillId ? 'Matched' : 'Not matched',
  Reason: request.reason,
});

const bankChangeDetails = (change: api.BankChange) => ({
  Vendor: change.vendorName,
  'Bank name': change.bankName,
  'Account reference': change.accountReference,
  'IFSC / routing code': change.ifsc,
  Status: change.status,
  Reason: change.reason,
});

const subscriptionDetails = (subscription: api.Subscription) => ({
  Vendor: subscription.vendorName,
  Name: subscription.name,
  Amount: `${subscription.amount} ${subscription.currency}`,
  Recurrence: subscription.recurrence,
  'Next due date': subscription.nextDueDate,
  Status: subscription.status,
  Reason: subscription.reason,
});

export function PayablesPage(): React.JSX.Element {
  const [vendors, setVendors] = useState<api.Vendor[]>([]);
  const [bills, setBills] = useState<api.Bill[]>([]);
  const [formVendors, setFormVendors] = useState<api.Vendor[]>([]);
  const [formBills, setFormBills] = useState<api.Bill[]>([]);
  const [runs, setRuns] = useState<api.PaymentRun[]>([]);
  const [bankChanges, setBankChanges] = useState<api.BankChange[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<api.PurchaseRequest[]>([]);
  const [subscriptions, setSubscriptions] = useState<api.Subscription[]>([]);
  const [reimbursementClaims, setReimbursementClaims] = useState<
    api.ReimbursementClaim[]
  >([]);
  const [reimbursementClaimsLoading, setReimbursementClaimsLoading] = useState(false);
  const [reimbursementClaimsError, setReimbursementClaimsError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formKind, setFormKind] = useState<PayablesFormKind | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<
    api.PurchaseRequest | undefined
  >();
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [details, setDetails] = useState<{
    title: string;
    record: object;
    document?: { billId: string; filename: string; mimeType: string };
  } | null>(null);
  const [pages, setPages] = useState<Record<string, number>>({});
  const [totals, setTotals] = useState<Record<string, number>>({});
  const pageSize = 6;
  const currentPrincipalId = getIdentitySessionSnapshot().principalId;
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
    if (!formKind) return;
    void Promise.all([api.listVendors(1, 100), api.listBills(1, 100)])
      .then(([vendorResult, billResult]) => {
        setFormVendors(vendorResult.items);
        setFormBills(billResult.items);
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to load Payables form options.',
        ),
      );
  }, [formKind]);
  useEffect(() => {
    if (formKind !== 'reimbursement') return;
    setReimbursementClaimsLoading(true);
    setReimbursementClaimsError('');
    void api
      .listReimbursementClaims()
      .then(setReimbursementClaims)
      .catch((cause) =>
        setReimbursementClaimsError(
          cause instanceof Error
            ? cause.message
            : 'Unable to load approved expense claims.',
        ),
      )
      .finally(() => setReimbursementClaimsLoading(false));
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
                        <Button
                          kind="secondary"
                          className="mt-2 ml-2"
                          onClick={() =>
                            setDetails({
                              title: 'Vendor details',
                              record: vendorDetails(vendor),
                            })
                          }
                        >
                          View details
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
                          <Button
                            kind="secondary"
                            onClick={() =>
                              setDetails({
                                title: 'Bill details',
                                record: billDetails(bill),
                                ...(bill.artifactFilename && bill.artifactMimeType
                                  ? {
                                      document: {
                                        billId: bill.id,
                                        filename: bill.artifactFilename,
                                        mimeType: bill.artifactMimeType,
                                      },
                                    }
                                  : {}),
                              })
                            }
                          >
                            View details
                          </Button>
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
                            bill.createdBy === currentPrincipalId ? (
                              <span className="self-center text-xs text-app-muted">
                                Waiting for another approver
                              </span>
                            ) : (
                              <Button onClick={() => approve(bill)}>Approve</Button>
                            )
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
                        <Button
                          kind="secondary"
                          onClick={() =>
                            setDetails({
                              title: 'Payment run details',
                              record: paymentRunDetails(run),
                            })
                          }
                        >
                          View details
                        </Button>
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
                        <Button
                          kind="secondary"
                          onClick={() =>
                            setDetails({
                              title: 'Purchase request details',
                              record: purchaseRequestDetails(request),
                            })
                          }
                        >
                          View details
                        </Button>
                        {request.status === 'pending' ? (
                          request.requesterId === currentPrincipalId ? (
                            <span className="self-center text-xs font-semibold text-app-muted">
                              Waiting for another authorized approver
                            </span>
                          ) : (
                            <Button onClick={() => approvePurchaseRequest(request)}>
                              Approve
                            </Button>
                          )
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
                      {change.status === 'pending' &&
                      change.proposedBy !== currentPrincipalId ? (
                        <Button
                          className="mt-2"
                          onClick={() => approveBankChange(change)}
                        >
                          Approve change
                        </Button>
                      ) : null}
                      {change.status === 'pending' &&
                      change.proposedBy === currentPrincipalId ? (
                        <span className="mt-2 inline-block text-xs font-semibold text-app-muted">
                          Waiting for another authorized approver
                        </span>
                      ) : null}
                      <Button
                        kind="secondary"
                        className="mt-2"
                        onClick={() =>
                          setDetails({
                            title: 'Bank change details',
                            record: bankChangeDetails(change),
                          })
                        }
                      >
                        View details
                      </Button>
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
                      <Button
                        kind="secondary"
                        className="mt-2"
                        onClick={() =>
                          setDetails({
                            title: 'Subscription details',
                            record: subscriptionDetails(subscription),
                          })
                        }
                      >
                        View details
                      </Button>
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
          vendors={formVendors.length ? formVendors : vendors}
          bills={formBills.length ? formBills : bills}
          reimbursementClaims={reimbursementClaims}
          reimbursementClaimsLoading={reimbursementClaimsLoading}
          reimbursementClaimsError={reimbursementClaimsError}
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
      {details && (
        <PayablesDetailsModal
          title={details.title}
          record={details.record}
          {...(details.document ? { document: details.document } : {})}
          onClose={() => setDetails(null)}
        />
      )}
    </Page>
  );
}
