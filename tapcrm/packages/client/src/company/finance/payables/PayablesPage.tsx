import { useEffect, useState } from 'react';
import { Button, Card, Empty, Loading, Notice, Page } from '../../../ui/components.js';
import * as api from './payablesApi.js';

export function PayablesPage(): React.JSX.Element {
  const [vendors, setVendors] = useState<api.Vendor[]>([]);
  const [bills, setBills] = useState<api.Bill[]>([]);
  const [runs, setRuns] = useState<api.PaymentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async () => {
    setLoading(true);
    try {
      const [nextVendors, nextBills, nextRuns] = await Promise.all([
        api.listVendors(),
        api.listBills(),
        api.listRuns(),
      ]);
      setVendors(nextVendors);
      setBills(nextBills);
      setRuns(nextRuns);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load payables.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const addVendor = async () => {
    const legalName = window.prompt('Vendor legal name:');
    const displayName = window.prompt('Vendor display name:', legalName ?? '');
    if (!legalName || !displayName) return;
    try {
      await api.createVendor({
        legalName,
        displayName,
        currency: 'INR',
        paymentTermsDays: 30,
      });
      setNotice('Vendor created.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create vendor.');
    }
  };
  const reimburse = async () => {
    const claimId = window.prompt('Approved expense claim ID:');
    if (!claimId) return;
    try {
      await api.createReimbursement(claimId, 'Imported from approved expense claims.');
      setNotice('Reimbursement payable created and marked needs review.');
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to create reimbursement.',
      );
    }
  };
  const approve = async (bill: api.Bill) => {
    try {
      await api.approveBill(bill.id, 'Reviewed by Finance.');
      setNotice(`Bill ${bill.invoiceNumber} approved and posted.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to approve bill.');
    }
  };
  const confirmExtraction = async (bill: api.Bill) => {
    try {
      await api.confirmExtraction(bill.id, 'Human review completed in Payables inbox.');
      setNotice(`Extraction confirmed for ${bill.invoiceNumber}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to confirm extraction.');
    }
  };
  const proposeRun = async () => {
    const eligible = bills.filter((bill) => bill.status === 'approved');
    if (!eligible.length) {
      setError('No approved bills are available for a payment run.');
      return;
    }
    try {
      await api.createRun(
        eligible.map((bill) => bill.id),
        eligible[0]!.currency,
        'Payment run proposed from approved bills.',
      );
      setNotice('Immutable payment-run manifest created.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to propose payment run.');
    }
  };
  const approveRun = async (run: api.PaymentRun) => {
    try {
      await api.approveRun(run.id, 'Payment run approved by Finance.');
      setNotice('Payment run approved.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to approve payment run.');
    }
  };
  const executeRun = async (run: api.PaymentRun) => {
    try {
      await api.executeRun(run.id, 'Payment run executed by Finance.');
      setNotice('Payment run executed and ledger posted.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to execute payment run.');
    }
  };
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
            <Button onClick={() => void addVendor()}>Add vendor</Button>
            <Button kind="secondary" onClick={() => void reimburse()}>
              Import approved expense
            </Button>
            <Button kind="secondary" onClick={() => void proposeRun()}>
              Propose payment run
            </Button>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card>
              <h2 className="text-lg font-semibold">Vendor master</h2>
              {vendors.length ? (
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
                    </div>
                  ))}
                </div>
              ) : (
                <Empty>No vendors.</Empty>
              )}
            </Card>
            <Card>
              <h2 className="text-lg font-semibold">Bill inbox</h2>
              {bills.length ? (
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
                      </div>
                      <div className="flex gap-2">
                        {bill.extractionStatus === 'needs_review' ? (
                          <Button
                            kind="secondary"
                            onClick={() => void confirmExtraction(bill)}
                          >
                            Confirm extraction
                          </Button>
                        ) : null}
                        {bill.status === 'needs_review' &&
                        bill.extractionStatus !== 'needs_review' ? (
                          <Button onClick={() => void approve(bill)}>Approve</Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty>No bills.</Empty>
              )}
            </Card>
          </div>
          <Card className="mt-5">
            <h2 className="text-lg font-semibold">Payment-run proposals</h2>
            {runs.length ? (
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
                        <Button onClick={() => void approveRun(run)}>Approve</Button>
                      ) : null}
                      {run.status === 'approved' ? (
                        <Button onClick={() => void executeRun(run)}>Execute</Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>No payment runs.</Empty>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
