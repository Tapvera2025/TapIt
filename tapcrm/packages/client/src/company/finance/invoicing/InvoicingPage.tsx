import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Loading, Notice, Page } from '../../../ui/components.js';
import * as api from './invoicingApi.js';

const input =
  'mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm';
const message = (e: unknown) =>
  e instanceof Error ? e.message : 'Unable to complete the invoicing request.';

export function InvoicingPage(): React.JSX.Element {
  const [tab, setTab] = useState<'drafts' | 'issued'>('drafts');
  const [drafts, setDrafts] = useState<api.InvoiceDraft[]>([]);
  const [invoices, setInvoices] = useState<api.IssuedInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<api.InvoiceDraft | null>(null);
  const [reviewToken, setReviewToken] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [reason, setReason] = useState('');
  const [batchToken, setBatchToken] = useState('');
  const [batchFingerprint, setBatchFingerprint] = useState('');
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [d, i] = await Promise.all([api.listDrafts(), api.listInvoices()]);
      setDrafts(d);
      setInvoices(i);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const startReview = async (row: api.InvoiceDraft) => {
    try {
      const result = await api.review(row.id, 'Reviewed invoice draft in Finance.');
      setSelected(row);
      setReviewToken(result.reviewToken);
      setFingerprint(result.manifestFingerprint);
      setNotice('Review token created. Confirm only after checking the preview.');
    } catch (e) {
      setError(message(e));
    }
  };
  const openPreview = async (id: string) => {
    const previewWindow = window.open('about:blank', '_blank');
    try {
      const blob = await api.previewPdf(id);
      const url = URL.createObjectURL(blob);
      if (previewWindow) {
        previewWindow.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (e) {
      previewWindow?.close();
      setError(message(e));
    }
  };
  const confirm = async () => {
    if (!selected) return;
    try {
      await api.confirm(selected.id, {
        reviewToken,
        manifestFingerprint: fingerprint,
        reason: reason || 'Human confirmed invoice for release.',
      });
      setSelected(null);
      setReviewToken('');
      setNotice('Invoice issued, posted to the ledger, and queued for delivery.');
      await load();
    } catch (e) {
      setError(message(e));
    }
  };
  const confirmBatch = async () => {
    const firstDraftId = batchIds[0];
    if (!batchToken || !batchFingerprint || !firstDraftId) return;
    try {
      await api.confirmBatch(firstDraftId, {
        batchToken,
        manifestFingerprint: batchFingerprint,
        reason: reason || 'Human confirmed invoice batch for release.',
      });
      setBatchToken('');
      setBatchFingerprint('');
      setBatchIds([]);
      setNotice('Invoice batch issued, posted, and queued for delivery.');
      await load();
    } catch (e) {
      setError(message(e));
    }
  };
  const startBatch = async (ids: string[]) => {
    try {
      const result = await api.reviewBatch(ids, 'Reviewed invoice batch in Finance.');
      setBatchIds(ids);
      setBatchToken(result.batchToken);
      setBatchFingerprint(result.manifestFingerprint);
      setNotice('Batch manifest created. Check all invoices before confirming.');
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <Page
      eyebrow="Finance · Invoicing"
      title="Invoices"
      description="Generate drafts, review the exact manifest, and release invoices only through authenticated human confirmation."
    >
      <div className="flex gap-2 border-b border-app-border pb-1">
        <button
          className={`rounded-t-xl px-4 py-2 text-sm font-semibold ${tab === 'drafts' ? 'border-b-2 border-app-accent text-app-accent' : 'text-app-muted'}`}
          onClick={() => setTab('drafts')}
        >
          Draft review
        </button>
        <button
          className={`rounded-t-xl px-4 py-2 text-sm font-semibold ${tab === 'issued' ? 'border-b-2 border-app-accent text-app-accent' : 'text-app-muted'}`}
          onClick={() => setTab('issued')}
        >
          Issued invoices
        </button>
      </div>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {tab === 'drafts' && (
        <DraftGenerator
          onCreated={() => {
            setNotice(
              'Invoice draft generated. It still requires human review and confirmation.',
            );
            void load();
          }}
          onError={setError}
        />
      )}
      {loading ? (
        <Loading />
      ) : tab === 'drafts' ? (
        <DraftList
          rows={drafts}
          onReview={(row) => {
            void startReview(row);
          }}
          onBatch={(ids) => {
            void startBatch(ids);
          }}
        />
      ) : (
        <IssuedList rows={invoices} />
      )}
      {selected && (
        <Card className="mt-5 border-app-accent">
          <h2 className="font-display text-lg font-bold">Confirm &amp; Send</h2>
          <p className="mt-2 text-sm text-app-muted">
            The server has frozen this manifest. Confirmation will number the invoice,
            post the ledger journal, and queue delivery atomically.
          </p>
          <button
            type="button"
            className="mt-3 text-sm text-app-accent underline"
            onClick={() => void openPreview(selected.id)}
          >
            Open PDF preview
          </button>
          <label className="mt-4 block text-sm font-semibold">
            Reason
            <textarea
              className={input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              onClick={() => void confirm()}
              disabled={!reviewToken || !fingerprint || !reason.trim()}
            >
              Confirm &amp; Send
            </Button>
            <Button type="button" onClick={() => setSelected(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
      {batchToken && (
        <Card className="mt-5 border-app-accent">
          <h2 className="font-display text-lg font-bold">Confirm invoice batch</h2>
          <p className="mt-2 text-sm text-app-muted">
            {batchIds.length} drafts are frozen in one immutable manifest.
          </p>
          <label className="mt-3 block text-sm font-semibold">
            Reason
            <textarea
              className={input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              onClick={() => void confirmBatch()}
              disabled={!reason.trim()}
            >
              Confirm batch &amp; send
            </Button>
            <Button
              type="button"
              onClick={() => {
                setBatchToken('');
                setBatchFingerprint('');
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </Page>
  );
}

type SourceType = 'retainer' | 'milestone' | 'timesheet' | 'billable_event' | 'manual';
function DraftGenerator({
  onCreated,
  onError,
}: {
  onCreated: () => void;
  onError: (value: string) => void;
}) {
  const [clients, setClients] = useState<
    Array<{ id: string; businessName: string; clientName: string }>
  >([]);
  const [entities, setEntities] = useState<
    Array<{ id: string; code: string; legalName: string; isActive: boolean }>
  >([]);
  const [contracts, setContracts] = useState<
    Array<{
      id: string;
      clientId: string;
      legalEntityId: string;
      contractNumber: string;
      title: string;
      currency: string;
      status: string;
    }>
  >([]);
  const [events, setEvents] = useState<api.DraftSourceOption[]>([]);
  const [currencies, setCurrencies] = useState<string[]>(['INR']);
  const [clientId, setClientId] = useState('');
  const [legalEntityId, setLegalEntityId] = useState('');
  const [contractId, setContractId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [sourceType, setSourceType] = useState<SourceType>('billable_event');
  const [description, setDescription] = useState('Professional services');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('0');
  const [taxRate, setTaxRate] = useState('0');
  const [currency, setCurrency] = useState('INR');
  const [periodStart, setPeriodStart] = useState(new Date().toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [validation, setValidation] = useState('');
  useEffect(() => {
    let mounted = true;
    const loadOptions = async () => {
      try {
        const options = await api.listFormOptions();
        if (!mounted) return;
        setClients(options.clients as typeof clients);
        setEntities(options.entities as typeof entities);
        setContracts(options.contracts as typeof contracts);
        setEvents(options.events);
        const foundation = options.foundation;
        const supported = foundation?.supportedCurrencies?.length
          ? foundation.supportedCurrencies
          : [foundation?.functionalCurrency ?? 'INR'];
        setCurrencies(supported);
        setCurrency((current) =>
          supported.includes(current)
            ? current
            : (foundation?.functionalCurrency ?? supported[0] ?? 'INR'),
        );
        if (foundation?.legalEntityId) setLegalEntityId(foundation.legalEntityId);
      } catch (e) {
        if (mounted) onError(message(e));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void loadOptions();
    const refreshOnFocus = () => void loadOptions();
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      mounted = false;
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [onError]);
  const availableContracts = useMemo(
    () =>
      contracts.filter(
        (row) =>
          row.clientId === clientId &&
          row.legalEntityId === legalEntityId &&
          row.currency === currency &&
          !['cancelled', 'expired'].includes(row.status),
      ),
    [contracts, clientId, legalEntityId, currency],
  );
  const availableEvents = useMemo(
    () =>
      events.filter(
        (row) =>
          row.clientId === clientId &&
          row.currency === currency &&
          (!contractId || row.contractId === contractId) &&
          row.eventDate >= periodStart &&
          row.eventDate <= periodEnd &&
          sourceType === 'billable_event' &&
          row.state === 'approved',
      ),
    [events, clientId, currency, contractId, periodStart, periodEnd, sourceType],
  );
  const selectedEvent = availableEvents.find((row) => row.id === sourceId);
  const updateClient = (value: string) => {
    setClientId(value);
    setContractId('');
    setSourceId('');
  };
  const updateSourceType = (value: SourceType) => {
    setSourceType(value);
    setSourceId('');
    if (value === 'manual') setDescription('Professional services');
  };
  const updateSource = (value: string) => {
    setSourceId(value);
    const event = availableEvents.find((row) => row.id === value);
    if (event) {
      setDescription(event.serviceKey);
      setQuantity(event.quantity);
      const unitPriceValue =
        Number(event.quantity) > 0 ? Number(event.amount) / Number(event.quantity) : 0;
      setUnitPrice(unitPriceValue.toFixed(2));
    }
  };
  const create = () => {
    setValidation('');
    if (!clientId || !legalEntityId || !reason.trim())
      return setValidation('Client, legal entity, and reason are required.');
    if (periodEnd < periodStart)
      return setValidation('Period end must not precede period start.');
    if (sourceType !== 'manual' && !sourceId)
      return setValidation('Select an approved source record.');
    if (
      !description.trim() ||
      Number(quantity) <= 0 ||
      Number(unitPrice) < 0 ||
      Number(taxRate) < 0
    )
      return setValidation(
        'Enter a valid description, quantity, unit price, and tax rate.',
      );
    const generatedSourceId = sourceType === 'manual' ? crypto.randomUUID() : sourceId;
    api
      .createDraft({
        clientId,
        legalEntityId,
        contractId: contractId || null,
        periodStart,
        periodEnd,
        currency,
        sources: [
          {
            sourceType,
            sourceId: generatedSourceId,
            description,
            quantity,
            unitPrice,
            taxRate,
            discount: '0',
          },
        ],
        reason,
      })
      .then(() => {
        setReason('');
        onCreated();
      })
      .catch((e) => onError(message(e)));
  };
  if (loading)
    return (
      <Card className="mb-5">
        <Loading />
      </Card>
    );
  return (
    <Card className="mb-5">
      <h2 className="font-display text-lg font-bold">Generate invoice draft</h2>
      <p className="mt-1 text-sm text-app-muted">
        Choose tenant-scoped records. IDs are kept internal; generation never sends or
        publishes an invoice.
      </p>
      {validation && <Notice error>{validation}</Notice>}
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="text-sm font-semibold">
          Client
          <select
            className={input}
            value={clientId}
            onChange={(e) => updateClient(e.target.value)}
          >
            <option value="">Select client</option>
            {clients.map((row) => (
              <option key={row.id} value={row.id}>
                {row.businessName || row.clientName}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Legal entity
          <select
            className={input}
            value={legalEntityId}
            onChange={(e) => {
              setLegalEntityId(e.target.value);
              setContractId('');
              setSourceId('');
            }}
          >
            <option value="">Select legal entity</option>
            {entities.map((row) => (
              <option key={row.id} value={row.id} disabled={!row.isActive}>
                {row.code} · {row.legalName}{!row.isActive ? ' · pending review' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Contract (optional)
          <select
            className={input}
            value={contractId}
            onChange={(e) => {
              setContractId(e.target.value);
              setSourceId('');
            }}
            disabled={!clientId || !legalEntityId}
          >
            <option value="">No contract</option>
            {availableContracts.map((row) => (
              <option key={row.id} value={row.id}>
                {row.contractNumber} · {row.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Source type
          <select
            className={input}
            value={sourceType}
            onChange={(e) => updateSourceType(e.target.value as SourceType)}
          >
            <option value="billable_event">Approved billable event</option>
            <option value="manual">Manual</option>
          </select>
        </label>
        <label className="text-sm font-semibold">
          Source record
          <select
            className={input}
            value={sourceId}
            onChange={(e) => updateSource(e.target.value)}
            disabled={sourceType === 'manual' || !clientId}
          >
            <option value="">
              {sourceType === 'manual'
                ? 'Generated automatically'
                : availableEvents.length
                  ? 'Select approved source'
                  : 'No eligible records'}
            </option>
            {availableEvents.map((row) => (
              <option key={row.id} value={row.id}>
                {row.eventDate} · {row.serviceKey} · {row.currency} {row.amount}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Currency
          <select
            className={input}
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value);
              setContractId('');
              setSourceId('');
            }}
          >
            {currencies.map((row) => (
              <option key={row} value={row}>
                {row}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Description
          <input
            className={input}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="text-sm font-semibold">
          Quantity
          <input
            className={input}
            type="number"
            min="0.0001"
            step="0.0001"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
        <label className="text-sm font-semibold">
          Unit price
          <input
            className={input}
            type="number"
            min="0"
            step="0.01"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
          />
        </label>
        <label className="text-sm font-semibold">
          Tax rate (%)
          <input
            className={input}
            type="number"
            min="0"
            step="0.01"
            value={taxRate}
            onChange={(e) => setTaxRate(e.target.value)}
          />
        </label>
        <label className="text-sm font-semibold">
          Period start
          <input
            className={input}
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
          />
        </label>
        <label className="text-sm font-semibold">
          Period end
          <input
            className={input}
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
          />
        </label>
        <label className="text-sm font-semibold">
          Reason
          <input
            className={input}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      <Button
        className="mt-4"
        type="button"
        disabled={
          !clientId ||
          !legalEntityId ||
          !reason.trim() ||
          (sourceType !== 'manual' && !sourceId)
        }
        onClick={create}
      >
        Generate draft
      </Button>
      {selectedEvent && (
        <p className="mt-2 text-xs text-app-muted">
          Selected event: {selectedEvent.serviceKey} · {selectedEvent.amount}{' '}
          {selectedEvent.currency}
        </p>
      )}
    </Card>
  );
}

function DraftList({
  rows,
  onReview,
  onBatch,
}: {
  rows: api.InvoiceDraft[];
  onReview: (row: api.InvoiceDraft) => void;
  onBatch: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  return (
    <Card>
      {rows.length === 0 ? (
        <Empty>No invoice drafts are waiting for review.</Empty>
      ) : (
        <>
          <div className="mb-3 flex justify-end">
            <Button
              type="button"
              disabled={!selected.length}
              onClick={() => onBatch(selected)}
            >
              Review selected batch ({selected.length})
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-app-border text-app-muted">
                  <th className="p-2">Select</th>
                  <th className="p-2">Period</th>
                  <th className="p-2">Client</th>
                  <th className="p-2">Total</th>
                  <th className="p-2">Status</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-app-border">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={selected.includes(row.id)}
                        disabled={row.status !== 'draft'}
                        onChange={() => toggle(row.id)}
                      />
                    </td>
                    <td className="p-2">
                      {row.periodStart} → {row.periodEnd}
                    </td>
                    <td className="p-2">{row.clientId}</td>
                    <td className="p-2">
                      {row.currency} {row.total}
                    </td>
                    <td className="p-2">{row.status}</td>
                    <td className="p-2">
                      <Button
                        type="button"
                        onClick={() => onReview(row)}
                        disabled={row.status !== 'draft'}
                      >
                        Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
function IssuedList({ rows }: { rows: api.IssuedInvoice[] }) {
  return (
    <Card>
      {rows.length === 0 ? (
        <Empty>No issued invoices yet.</Empty>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border p-3 text-sm"
            >
              <span className="font-semibold">{row.invoiceNumber}</span>
              <span>
                {row.invoiceDate} · due {row.dueDate}
              </span>
              <span>
                {row.currency} {row.total}
              </span>
              <a
                className="text-app-accent underline"
                href={`/api/invoicing/invoices/${row.id}/pdf`}
              >
                PDF
              </a>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
