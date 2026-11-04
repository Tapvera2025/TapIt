import { useEffect, useState } from 'react';
import { Button, Card, Empty, Loading, Notice, Page } from '../../../ui/components.js';
import * as api from './paymentOperationsApi.js';
const input =
  'mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm';
const message = (e: unknown) =>
  e instanceof Error ? e.message : 'Unable to complete the payment operation.';
export function PaymentOperationsPage(): React.JSX.Element {
  const [tab, setTab] = useState<'receipt' | 'bank' | 'controls' | 'exceptions'>(
    'receipt',
  );
  const [lines, setLines] = useState<api.BankLine[]>([]);
  const [receipts, setReceipts] = useState<api.Receipt[]>([]);
  const [exceptions, setExceptions] = useState<api.PaymentException[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [provider, setProvider] = useState('manual');
  const [cashClassification, setCashClassification] = useState<
    'receivable' | 'unapplied' | 'advance'
  >('receivable');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const load = async () => {
    setLoading(true);
    try {
      const [nextLines, nextReceipts, nextExceptions] = await Promise.all([
        api.listBankLines(),
        api.listReceipts(),
        api.listExceptions(),
      ]);
      setLines(nextLines);
      setReceipts(nextReceipts);
      setExceptions(nextExceptions);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const record = async () => {
    try {
      await api.recordReceipt({
        provider,
        amountMinor: BigInt(Math.round(Number(amount) * 100)).toString(),
        currency,
        bankReference: reference || undefined,
        cashClassification,
        idempotencyKey: `manual:${reference || Date.now()}`,
        reason: reason || 'Manual payment receipt recorded',
      });
      setNotice('Receipt recorded. Verify it before allocation.');
      setAmount('');
      setReference('');
      await load();
    } catch (e) {
      setError(message(e));
    }
  };
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') resolve(reader.result);
          else reject(new Error('Unable to read the bank file.'));
        };
        reader.onerror = () => reject(new Error('Unable to read the bank file.'));
        reader.readAsDataURL(file);
      });
      const result = await api.importBank({
        originalFilename: file.name,
        data,
        format: 'generic_csv',
      });
      setNotice(`${result.rowCount} bank lines imported.`);
      await load();
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <Page
      eyebrow="Finance · Payments"
      title="Payments & reconciliation"
      description="Record provider-neutral receipts, import bank files, and resolve payment exceptions. Gateway providers remain optional."
    >
      <div className="flex flex-wrap gap-2 border-b border-app-border pb-2">
        {(['receipt', 'bank', 'controls', 'exceptions'] as const).map((item) => (
          <button
            key={item}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${tab === item ? 'bg-app-accent text-white' : 'text-app-muted'}`}
            onClick={() => setTab(item)}
          >
            {item === 'receipt'
              ? 'Receipts'
              : item === 'bank'
                ? 'Bank reconciliation'
                : item === 'controls'
                  ? 'Settlement & FX'
                  : 'Exceptions'}
          </button>
        ))}
      </div>
      {error && (
        <div className="mt-4">
          <Notice error>{error}</Notice>
        </div>
      )}
      {notice && (
        <div className="mt-4">
          <Notice>{notice}</Notice>
        </div>
      )}
      {loading ? (
        <Loading />
      ) : tab === 'receipt' ? (
        <>
          <Card className="mt-5">
            <h2 className="text-lg font-semibold">Record payment receipt</h2>
            <p className="mt-1 text-sm text-app-muted">
              This records cash without treating it as verified. Verification posts the
              accounting journal.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-semibold">
                Provider
                <select
                  className={input}
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  <option value="manual">Manual</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="razorpay">Razorpay</option>
                  <option value="stripe">Stripe</option>
                </select>
              </label>
              <label className="text-sm font-semibold">
                Currency
                <input
                  className={input}
                  value={currency}
                  maxLength={3}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                />
              </label>
              <label className="text-sm font-semibold">
                Amount
                <input
                  className={input}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label className="text-sm font-semibold">
                Cash classification
                <select
                  className={input}
                  value={cashClassification}
                  onChange={(e) =>
                    setCashClassification(e.target.value as typeof cashClassification)
                  }
                >
                  <option value="receivable">Accounts receivable</option>
                  <option value="unapplied">Unapplied cash / suspense</option>
                  <option value="advance">Customer advance</option>
                </select>
              </label>
              <label className="text-sm font-semibold">
                Bank/provider reference
                <input
                  className={input}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
            </div>
            <label className="mt-4 block text-sm font-semibold">
              Reason
              <textarea
                className={input}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <Button
              className="mt-4"
              type="button"
              disabled={!amount || Number(amount) <= 0 || reason.trim().length < 3}
              onClick={() => void record()}
            >
              Record receipt
            </Button>
          </Card>
          <Card className="mt-5">
            <h2 className="text-lg font-semibold">Receipt lifecycle</h2>
            {receipts.length === 0 ? (
              <div className="mt-4">
                <Empty>No receipts recorded.</Empty>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {receipts.map((receipt) => (
                  <div
                    key={receipt.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border p-3 text-sm"
                  >
                    <div>
                      <span className="font-semibold">{receipt.provider}</span>
                      <span className="ml-3">
                        {receipt.currency} {receipt.amountMinor}
                      </span>
                      <span className="ml-3 text-app-muted">
                        {receipt.bankReference ?? receipt.providerPaymentId ?? receipt.id}
                      </span>
                    </div>
                    <span className="rounded-full border border-app-border px-2 py-1 text-xs font-semibold">
                      {receipt.state}
                    </span>
                    {receipt.state === 'reported' && (
                      <Button
                        type="button"
                        onClick={() =>
                          void (async () => {
                            try {
                              await api.verifyReceipt(
                                receipt.id,
                                reason || 'Verified payment receipt.',
                              );
                              setNotice('Receipt verified and posted to the ledger.');
                              await load();
                            } catch (e) {
                              setError(message(e));
                            }
                          })()
                        }
                      >
                        Verify &amp; post
                      </Button>
                    )}
                    {['verified', 'reconciled'].includes(receipt.state) && (
                      <Button
                        type="button"
                        onClick={() =>
                          void (async () => {
                            const target = window.prompt('Invoice or deal UUID:');
                            if (!target) return;
                            const allocation = window.prompt(
                              'Allocation amount in minor units:',
                              receipt.amountMinor,
                            );
                            if (!allocation) return;
                            try {
                              await api.allocateReceipt(receipt.id, {
                                invoiceId: target,
                                amountMinor: allocation,
                                reason: reason || 'Allocated payment receipt.',
                              });
                              setNotice('Receipt allocated.');
                              await load();
                            } catch (e) {
                              setError(message(e));
                            }
                          })()
                        }
                      >
                        Allocate
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : tab === 'bank' ? (
        <Card className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Bank statement import</h2>
              <p className="mt-1 text-sm text-app-muted">
                CSV remains the fallback reconciliation path; files are stored by the
                backend.
              </p>
            </div>
            <label className="cursor-pointer rounded-xl bg-app-accent px-4 py-2 text-sm font-semibold text-white">
              Import CSV
              <input
                className="hidden"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => void upload(e)}
              />
            </label>
          </div>
          {lines.length === 0 ? (
            <div className="mt-5">
              <Empty>No bank lines imported.</Empty>
            </div>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-app-border">
                    <th className="p-2">Date</th>
                    <th className="p-2">Reference</th>
                    <th className="p-2">Credit</th>
                    <th className="p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-b border-app-border">
                      <td className="p-2">{line.transactionDate}</td>
                      <td className="p-2">{line.reference ?? line.description ?? '—'}</td>
                      <td className="p-2">
                        {line.currency} {line.creditMinor}
                      </td>
                      <td className="p-2">
                        {line.matchedReceiptId ? (
                          'Matched'
                        ) : (
                          <Button
                            type="button"
                            onClick={() =>
                              void (async () => {
                                try {
                                  await api.matchBankLine(line.id, {
                                    createReceipt: true,
                                    reason: 'Matched incoming bank statement line.',
                                  });
                                  setNotice('Bank line matched to a receipt.');
                                  await load();
                                } catch (e) {
                                  setError(message(e));
                                }
                              })()
                            }
                          >
                            Match
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : tab === 'controls' ? (
        <PaymentControls
          onDone={(message) => {
            setNotice(message);
            void load();
          }}
          onError={setError}
        />
      ) : (
        <Card className="mt-5">
          <h2 className="text-lg font-semibold">Exception queue</h2>
          {exceptions.length === 0 ? (
            <div className="mt-4">
              <Empty>No payment exceptions.</Empty>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {exceptions.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-app-border p-3 text-sm"
                >
                  <div className="flex justify-between gap-3">
                    <span className="font-semibold">{item.exceptionType}</span>
                    <span>{item.status}</span>
                  </div>
                  <p className="mt-1 text-app-muted">{item.reason}</p>
                  {item.status !== 'resolved' && item.status !== 'ignored' && (
                    <Button
                      className="mt-2"
                      type="button"
                      onClick={() =>
                        void (async () => {
                          try {
                            await api.resolveException(item.id, {
                              status: 'resolved',
                              resolution: 'Resolved from Finance payment operations.',
                            });
                            setNotice('Exception resolved.');
                            await load();
                          } catch (e) {
                            setError(message(e));
                          }
                        })()
                      }
                    >
                      Resolve
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </Page>
  );
}

function PaymentControls({
  onDone,
  onError,
}: {
  onDone: (message: string) => void;
  onError: (message: string) => void;
}): React.JSX.Element {
  const [provider, setProvider] = useState('razorpay');
  const [reference, setReference] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [gross, setGross] = useState('');
  const [fee, setFee] = useState('');
  const [rate, setRate] = useState('10000');
  const [receiptIds, setReceiptIds] = useState('');
  const [base, setBase] = useState('USD');
  const [quote, setQuote] = useState('INR');
  const [fxRate, setFxRate] = useState('');
  const [revalueCurrency, setRevalueCurrency] = useState('USD');
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [settlementFile, setSettlementFile] = useState<File | null>(null);
  const [settlements, setSettlements] = useState<api.Settlement[]>([]);
  const [revaluations, setRevaluations] = useState<api.FxRevaluation[]>([]);
  const [reason, setReason] = useState('');
  const inputValue = (value: string) => String(Math.round(Number(value || 0) * 100));
  const refreshHistory = async () => {
    const [nextSettlements, nextRevaluations] = await Promise.all([
      api.listSettlements(),
      api.listFxRevaluations(),
    ]);
    setSettlements(nextSettlements);
    setRevaluations(nextRevaluations);
  };
  useEffect(() => {
    void Promise.all([api.listSettlements(), api.listFxRevaluations()])
      .then(([nextSettlements, nextRevaluations]) => {
        setSettlements(nextSettlements);
        setRevaluations(nextRevaluations);
      })
      .catch((e) => onError(message(e)));
  }, [onError]);
  const saveSettlement = async () => {
    try {
      const grossMinor = BigInt(inputValue(gross));
      const feeMinor = BigInt(inputValue(fee));
      await api.createSettlement({
        provider,
        settlementReference: reference,
        settlementDate: new Date().toISOString().slice(0, 10),
        currency,
        grossMinor: String(grossMinor),
        feeMinor: String(feeMinor),
        netMinor: String(grossMinor - feeMinor),
        exchangeRateBps: Number(rate),
        receiptIds: receiptIds
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
        reason,
      });
      onDone('Settlement recorded and reconciled when selected receipts matched.');
      await refreshHistory();
    } catch (e) {
      onError(message(e));
    }
  };
  const saveFx = async () => {
    try {
      await api.recordFxRate({
        baseCurrency: base,
        quoteCurrency: quote,
        rateBps: Number(fxRate),
        effectiveAt: new Date().toISOString(),
        source: 'manual',
        reason,
      });
      onDone('FX rate recorded.');
    } catch (e) {
      onError(message(e));
    }
  };
  const revalue = async () => {
    try {
      await api.revalueFx({
        currency: revalueCurrency,
        asOfDate,
        rateBps: Number(fxRate),
        reason,
      });
      onDone('Unrealized FX revaluation posted.');
      await refreshHistory();
    } catch (e) {
      onError(message(e));
    }
  };
  const importSettlement = async () => {
    if (!settlementFile) return;
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === 'string'
            ? resolve(reader.result)
            : reject(new Error('Unable to read settlement file.'));
        reader.onerror = () => reject(new Error('Unable to read settlement file.'));
        reader.readAsDataURL(settlementFile);
      });
      const result = await api.importSettlement({
        originalFilename: settlementFile.name,
        data,
        provider,
        format: 'generic_csv',
        reason,
      });
      onDone(`${result.rowCount} settlement rows imported for reconciliation.`);
      await refreshHistory();
    } catch (e) {
      onError(message(e));
    }
  };
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card>
        <h2 className="text-lg font-semibold">Settlement reconciliation</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-semibold">
            Provider
            <input
              className={input}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            />
          </label>
          <label className="block text-sm font-semibold">
            Settlement reference
            <input
              className={input}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          <label className="block text-sm font-semibold">
            Currency
            <input
              className={input}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </label>
          <label className="block text-sm font-semibold">
            Gross
            <input
              className={input}
              value={gross}
              onChange={(e) => setGross(e.target.value)}
            />
          </label>
          <label className="block text-sm font-semibold">
            Fees
            <input
              className={input}
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </label>
          <label className="block text-sm font-semibold">
            Settlement FX rate (bps)
            <input
              className={input}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </label>
          <label className="block text-sm font-semibold">
            Receipt IDs (comma separated)
            <input
              className={input}
              value={receiptIds}
              onChange={(e) => setReceiptIds(e.target.value)}
            />
          </label>
          <Button
            type="button"
            disabled={!reference || !gross || !reason.trim()}
            onClick={() => void saveSettlement()}
          >
            Record settlement
          </Button>
        </div>
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">Settlement file fallback</h2>
        <p className="mt-1 text-sm text-app-muted">
          Import a provider settlement CSV through backend storage for review.
        </p>
        <input
          className={input}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setSettlementFile(e.target.files?.[0] ?? null)}
        />
        <Button
          className="mt-3"
          type="button"
          disabled={!settlementFile || !reason.trim()}
          onClick={() => void importSettlement()}
        >
          Import settlement CSV
        </Button>
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">Unrealized FX revaluation</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-semibold">
            Currency
            <input
              className={input}
              value={revalueCurrency}
              onChange={(e) => setRevalueCurrency(e.target.value.toUpperCase())}
            />
          </label>
          <label className="block text-sm font-semibold">
            As-of date
            <input
              className={input}
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
            />
          </label>
          <p className="text-xs text-app-muted">
            Uses the open non-INR gateway-clearing balance and posts FX gain/loss through
            accounting.
          </p>
          <Button
            type="button"
            disabled={!fxRate || !reason.trim()}
            onClick={() => void revalue()}
          >
            Run revaluation
          </Button>
        </div>
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">FX rate</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-semibold">
            Base currency
            <input
              className={input}
              value={base}
              onChange={(e) => setBase(e.target.value.toUpperCase())}
            />
          </label>
          <label className="block text-sm font-semibold">
            Quote currency
            <input
              className={input}
              value={quote}
              onChange={(e) => setQuote(e.target.value.toUpperCase())}
            />
          </label>
          <label className="block text-sm font-semibold">
            Rate (bps)
            <input
              className={input}
              value={fxRate}
              onChange={(e) => setFxRate(e.target.value)}
            />
          </label>
          <label className="block text-sm font-semibold">
            Reason
            <textarea
              className={input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <Button
            type="button"
            disabled={!fxRate || !reason.trim()}
            onClick={() => void saveFx()}
          >
            Save FX rate
          </Button>
        </div>
      </Card>
      <Card className="md:col-span-2">
        <h2 className="text-lg font-semibold">Settlement and FX history</h2>
        {settlements.length === 0 && revaluations.length === 0 ? (
          <div className="mt-4">
            <Empty>No settlement or FX revaluation records.</Empty>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold">Settlements</h3>
              <div className="mt-2 space-y-2 text-sm">
                {settlements.map((item) => (
                  <div
                    key={String(item.id)}
                    className="rounded-xl border border-app-border p-3"
                  >
                    <div className="flex justify-between gap-3">
                      <span>{String(item.settlementReference)}</span>
                      <span>{String(item.status)}</span>
                    </div>
                    <p className="mt-1 text-app-muted">
                      {String(item.currency)} {String(item.netMinor)} ·{' '}
                      {String(item.settlementDate)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold">FX revaluations</h3>
              <div className="mt-2 space-y-2 text-sm">
                {revaluations.map((item) => (
                  <div
                    key={String(item.id)}
                    className="rounded-xl border border-app-border p-3"
                  >
                    <div className="flex justify-between gap-3">
                      <span>
                        {String(item.currency)} · {String(item.asOfDate)}
                      </span>
                      <span>{String(item.differenceMinor)}</span>
                    </div>
                    <p className="mt-1 text-app-muted">
                      Carrying {String(item.carryingMinor)} → {String(item.revaluedMinor)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
