import { useEffect, useState } from 'react';
import { Button, Card, Empty, Loading, Notice, Page } from '../../../ui/components.js';
import * as api from './billingTermsApi.js';

type Tab = 'profiles' | 'rate-cards' | 'contracts' | 'schedules' | 'events';
const inputClass =
  'mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm';
const today = () => new Date().toISOString().slice(0, 10);
const messageOf = (e: unknown) =>
  e instanceof Error ? e.message : 'Unable to complete the billing request.';
function Input({
  label,
  value,
  onChange,
  type = 'text',
  min,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  min?: string;
  step?: string;
}) {
  return (
    <label className="text-sm font-semibold">
      {label}
      <input
        className={inputClass}
        type={type}
        min={min}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="text-sm font-semibold">
      {label}
      <select
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

export function BillingTermsPage(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('profiles');
  const [options, setOptions] = useState<api.FormOptions>({
    clients: [],
    legalEntities: [],
    supportedCurrencies: ['INR'],
  });
  const [profiles, setProfiles] = useState<api.BillingProfile[]>([]);
  const [cards, setCards] = useState<api.RateCard[]>([]);
  const [contracts, setContracts] = useState<api.Contract[]>([]);
  const [schedules, setSchedules] = useState<api.Schedule[]>([]);
  const [events, setEvents] = useState<api.BillableEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [o, p, r, c, s, e] = await Promise.all([
        api.getFormOptions(),
        api.listBillingProfiles(),
        api.listRateCards(),
        api.listContracts(),
        api.listSchedules(),
        api.listBillableEvents(),
      ]);
      setOptions(o);
      setProfiles(p);
      setCards(r);
      setContracts(c);
      setSchedules(s);
      setEvents(e);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const saved = (text: string) => {
    setNotice(text);
    void load();
  };
  const clientName = (id: string) => {
    const row = options.clients.find((item) => item.id === id);
    return row?.businessName || row?.clientName || id;
  };
  const entityName = (id: string) =>
    options.legalEntities.find((item) => item.id === id)?.legalName || id;
  return (
    <Page
      eyebrow="Finance · Billing terms"
      title="Billing Terms & Contracts"
      description="Manage commercial terms, rate cards, contract lifecycle, schedules, and billable events."
    >
      <div className="flex gap-2 overflow-x-auto border-b border-app-border pb-1">
        {(['profiles', 'rate-cards', 'contracts', 'schedules', 'events'] as Tab[]).map(
          (item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`rounded-t-xl px-4 py-2.5 text-sm font-semibold ${tab === item ? 'border-b-2 border-app-accent bg-app-accent/10 text-app-accent' : 'text-app-muted'}`}
            >
              {item.replace('-', ' ')}
            </button>
          ),
        )}
      </div>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {loading ? (
        <Loading />
      ) : tab === 'profiles' ? (
        <Profiles
          rows={profiles}
          options={options}
          clientName={clientName}
          saved={() => saved('Billing profile saved and audited.')}
          error={setError}
        />
      ) : tab === 'rate-cards' ? (
        <RateCards
          rows={cards}
          currencies={options.supportedCurrencies}
          saved={() => saved('Rate card saved and audited.')}
          error={setError}
        />
      ) : tab === 'contracts' ? (
        <Contracts
          rows={contracts}
          options={options}
          clientName={clientName}
          entityName={entityName}
          saved={() => saved('Contract action saved and audited.')}
          error={setError}
        />
      ) : tab === 'schedules' ? (
        <Schedules
          rows={schedules}
          contracts={contracts}
          clientName={clientName}
          saved={() => saved('Schedule saved and audited.')}
          error={setError}
        />
      ) : (
        <Events
          rows={events}
          options={options}
          clientName={clientName}
          saved={() => saved('Billable event updated.')}
          error={setError}
        />
      )}
    </Page>
  );
}

function Profiles({
  rows,
  options,
  clientName,
  saved,
  error,
}: {
  rows: api.BillingProfile[];
  options: api.FormOptions;
  clientName: (id: string) => string;
  saved: () => void;
  error: (value: string) => void;
}) {
  const [clientId, setClientId] = useState('');
  const [entityId, setEntityId] = useState('');
  const [terms, setTerms] = useState('30');
  const [limit, setLimit] = useState('0');
  const [contact, setContact] = useState('');
  const [reason, setReason] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const entity = options.legalEntities.find((item) => item.id === entityId);
  const client = options.clients.find((item) => item.id === clientId);
  const currency = entity?.baseCurrency || client?.currency || 'INR';
  const reset = () => {
    setClientId('');
    setEntityId('');
    setTerms('30');
    setLimit('0');
    setContact('');
    setReason('');
    setEditingId(null);
  };
  const edit = (row: api.BillingProfile) => {
    setEditingId(row.id);
    setClientId(row.clientId);
    setEntityId(row.legalEntityId);
    setTerms(String(row.paymentTermsDays));
    setLimit(row.creditLimit);
    setContact(row.billingContactEmail || row.billingContactPhone || '');
    setReason('Updated billing profile');
  };
  const submit = () =>
    void api
      .saveBillingProfile({
        clientId,
        legalEntityId: entityId,
        currency,
        timezone: entity?.timezone || 'Asia/Kolkata',
        paymentTermsDays: Number(terms),
        creditLimit: limit,
        creditControl: 'advisory',
        poRequired: false,
        billingContactEmail: contact.includes('@') ? contact : null,
        billingContactPhone: contact.includes('@') ? null : contact,
        reason,
      })
      .then(() => {
        reset();
        saved();
      })
      .catch((e) => error(messageOf(e)));
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)]">
      <Card className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-app-accent">
              {editingId ? 'Edit profile' : 'New profile'}
            </p>
            <h2 className="mt-1 font-display text-lg font-bold">
              {editingId ? 'Update client billing terms' : 'Set client billing terms'}
            </h2>
          </div>
          {editingId && (
            <Button
              type="button"
              kind="secondary"
              className="px-3 py-1.5 text-xs"
              onClick={reset}
            >
              Cancel
            </Button>
          )}
        </div>
        <div className="mt-4 grid gap-3">
          <Select label="Client" value={clientId} onChange={setClientId}>
            <option value="">Select client</option>
            {options.clients.map((row) => (
              <option key={row.id} value={row.id}>
                {row.businessName || row.clientName}
              </option>
            ))}
          </Select>
          <Select label="Legal entity" value={entityId} onChange={setEntityId}>
            <option value="">Select legal entity</option>
            {options.legalEntities.map((row) => (
              <option key={row.id} value={row.id} disabled={row.status !== 'active'}>
                {row.code} · {row.legalName}{row.status !== 'active' ? ` · ${row.status.replace('_', ' ')}` : ''}
              </option>
            ))}
          </Select>
          <Input
            label="Payment terms (days)"
            value={terms}
            onChange={setTerms}
            type="number"
            min="0"
          />
          <Input
            label={`Credit limit (${currency})`}
            value={limit}
            onChange={setLimit}
            type="number"
            min="0"
            step="0.01"
          />
          <Input
            label="Billing contact email or phone"
            value={contact}
            onChange={setContact}
          />
          <Input label="Reason" value={reason} onChange={setReason} />
          <Button
            type="button"
            disabled={!clientId || !entityId || !contact || reason.trim().length < 3}
            onClick={submit}
          >
            {editingId ? 'Update profile' : 'Save profile'}
          </Button>
        </div>
      </Card>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">Existing profiles</h2>
            <p className="mt-1 text-xs text-app-muted">
              {rows.length} configured client profile{rows.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        {rows.length ? (
          <div className="mt-4 space-y-3">
            {rows.map((row) => (
              <div key={row.id} className="rounded-xl border border-app-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{clientName(row.clientId)}</p>
                    <p className="mt-1 text-xs text-app-muted">
                      {row.currency} · {row.paymentTermsDays} days · {row.creditControl}{' '}
                      credit control
                    </p>
                  </div>
                  <Button
                    type="button"
                    kind="secondary"
                    className="px-3 py-1.5 text-xs"
                    onClick={() => edit(row)}
                  >
                    Edit
                  </Button>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-app-muted sm:grid-cols-3">
                  <span>
                    <strong className="text-app-foreground">Credit limit:</strong>{' '}
                    {row.currency} {row.creditLimit}
                  </span>
                  <span>
                    <strong className="text-app-foreground">Contact:</strong>{' '}
                    {row.billingContactEmail || row.billingContactPhone || 'Not provided'}
                  </span>
                  <span>
                    <strong className="text-app-foreground">Status:</strong> {row.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No billing profiles configured.</Empty>
        )}
      </Card>
    </div>
  );
}

function RateCards({
  rows,
  currencies,
  saved,
  error,
}: {
  rows: api.RateCard[];
  currencies: string[];
  saved: () => void;
  error: (value: string) => void;
}) {
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [cardId, setCardId] = useState('');
  const [date, setDate] = useState(today());
  const [lines, setLines] = useState<
    Array<{
      serviceKey: string;
      pricingModel: string;
      unitRate: string;
      currency: string;
    }>
  >([
    {
      serviceKey: '',
      pricingModel: 'hourly',
      unitRate: '',
      currency: currencies[0] || 'INR',
    },
  ]);
  const [versionReason, setVersionReason] = useState('');
  const [details, setDetails] = useState<api.RateCard | null>(null);
  useEffect(() => {
    if (!cardId) {
      setDetails(null);
      return;
    }
    void api
      .getRateCard(cardId)
      .then(setDetails)
      .catch(() => setDetails(null));
  }, [cardId]);
  const create = () =>
    void api
      .createRateCard({ name, reason })
      .then(saved)
      .catch((e) => error(messageOf(e)));
  const addVersion = () =>
    void api
      .addRateCardVersion(cardId, {
        effectiveFrom: date,
        lines,
        reason: versionReason,
      })
      .then(() => {
        setLines([
          {
            serviceKey: '',
            pricingModel: 'hourly',
            unitRate: '',
            currency: currencies[0] || 'INR',
          },
        ]);
        setVersionReason('');
        saved();
      })
      .catch((e) => error(messageOf(e)));
  const updateLine = (index: number, key: string, value: string) =>
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, [key]: value } : line,
      ),
    );
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
      <Card>
        <h2 className="font-display text-lg font-bold">Rate card</h2>
        <div className="mt-4 grid gap-3">
          <Input label="Name" value={name} onChange={setName} />
          <Input label="Reason" value={reason} onChange={setReason} />
          <Button
            type="button"
            disabled={!name.trim() || reason.trim().length < 3}
            onClick={create}
          >
            Create rate card
          </Button>
          <Select label="Rate card for new version" value={cardId} onChange={setCardId}>
            <option value="">Select rate card</option>
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
          <Input label="Effective from" value={date} onChange={setDate} type="date" />
          <div className="space-y-3 rounded-xl border border-app-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">New or changed services</p>
                <p className="text-xs text-app-muted">
                  Previous services are carried into the new immutable version
                  automatically.
                </p>
              </div>
              <Button
                type="button"
                kind="secondary"
                className="shrink-0 whitespace-nowrap px-3 py-1.5 text-xs"
                onClick={() =>
                  setLines((current) => [
                    ...current,
                    {
                      serviceKey: '',
                      pricingModel: 'hourly',
                      unitRate: '',
                      currency: currencies[0] || 'INR',
                    },
                  ])
                }
              >
                Add line
              </Button>
            </div>
            {lines.map((line, index) => (
              <div key={index} className="rounded-lg bg-app-surface p-4">
                <div className="flex items-center justify-between gap-3 border-b border-app-border pb-3">
                  <div>
                    <p className="text-sm font-semibold">Service line {index + 1}</p>
                    <p className="mt-0.5 text-xs text-app-muted">
                      Define the service and its applicable rate.
                    </p>
                  </div>
                  {lines.length > 1 && (
                    <Button
                      type="button"
                      kind="secondary"
                      className="shrink-0 whitespace-nowrap px-2.5 py-1.5 text-xs"
                      onClick={() =>
                        setLines((current) =>
                          current.filter((_, lineIndex) => lineIndex !== index),
                        )
                      }
                    >
                      Remove line
                    </Button>
                  )}
                </div>
                <div className="mt-4 grid gap-3">
                  <Input
                    label="Service key"
                    value={line.serviceKey}
                    onChange={(value) => updateLine(index, 'serviceKey', value)}
                  />
                  <Select
                    label="Pricing model"
                    value={line.pricingModel}
                    onChange={(value) => updateLine(index, 'pricingModel', value)}
                  >
                    <option value="hourly">Hourly</option>
                    <option value="monthly">Monthly</option>
                    <option value="fixed">Fixed</option>
                    <option value="retainer">Retainer</option>
                  </Select>
                  <Input
                    label="Unit rate"
                    value={line.unitRate}
                    onChange={(value) => updateLine(index, 'unitRate', value)}
                    type="number"
                    min="0"
                    step="0.01"
                  />
                  <Select
                    label="Currency"
                    value={line.currency}
                    onChange={(value) => updateLine(index, 'currency', value)}
                  >
                    {currencies.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            ))}
          </div>
          <Input
            label="Version reason"
            value={versionReason}
            onChange={setVersionReason}
          />
          <Button
            type="button"
            disabled={
              !cardId ||
              lines.some((line) => !line.serviceKey.trim() || !line.unitRate) ||
              versionReason.trim().length < 3
            }
            onClick={addVersion}
          >
            Add price version
          </Button>
        </div>
      </Card>
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-app-muted">
              Commercial catalogue
            </p>
            <h2 className="mt-1 font-display text-lg font-bold">Rate cards</h2>
          </div>
          <span className="rounded-full bg-app-surface px-3 py-1 text-xs font-semibold text-app-muted">
            {rows.length} {rows.length === 1 ? 'card' : 'cards'}
          </span>
        </div>
        {rows.length ? (
          rows.map((row) => (
            <div
              key={row.id}
              className={`mt-4 overflow-hidden rounded-2xl border transition-colors ${details?.id === row.id ? 'border-app-primary/50 shadow-sm' : 'border-app-border'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 bg-app-surface px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-app-primary/10 text-sm font-bold text-app-primary">
                    {row.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{row.name}</p>
                    <p className="mt-0.5 text-xs text-app-muted">
                      {details?.id === row.id && details.versions
                        ? `${details.versions.length} ${details.versions.length === 1 ? 'version' : 'versions'}`
                        : 'Select this card above to view versions'}
                    </p>
                  </div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${row.status === 'active' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-app-border text-app-muted'}`}
                >
                  {row.status}
                </span>
              </div>
              {details?.id === row.id && details.versions?.length ? (
                <div className="space-y-3 p-4">
                  {details.versions.map((version) => (
                    <div
                      key={version.id}
                      className="rounded-xl border border-app-border bg-app-surface/60 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">
                            Version {version.versionNumber}
                          </p>
                          <p className="mt-0.5 text-xs text-app-muted">
                            Effective from {version.effectiveFrom}
                            {version.effectiveTo
                              ? ` · until ${version.effectiveTo}`
                              : ' · current'}
                          </p>
                        </div>
                        <span className="rounded-full border border-app-border px-2 py-1 text-[11px] font-medium text-app-muted">
                          {version.lines?.length || 0}{' '}
                          {version.lines?.length === 1 ? 'service' : 'services'}
                        </span>
                      </div>
                      {version.lines?.length ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {version.lines.map((line) => (
                            <div
                              key={`${version.id}-${line.serviceKey}-${line.pricingModel}`}
                              className="rounded-lg border border-app-border bg-app-background/60 px-3 py-2.5"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <p className="min-w-0 truncate text-sm font-semibold">
                                  {line.serviceKey}
                                </p>
                                <p className="shrink-0 text-sm font-bold">
                                  {line.currency} {line.unitRate}
                                </p>
                              </div>
                              <p className="mt-1 text-xs capitalize text-app-muted">
                                {line.pricingModel} pricing
                                {line.roleCode ? ` · ${line.roleCode}` : ''}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-app-muted">
                          No service lines in this version.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : details?.id === row.id ? (
                <p className="px-4 py-5 text-sm text-app-muted">
                  No price versions have been added yet.
                </p>
              ) : null}
            </div>
          ))
        ) : (
          <Empty>Create a rate card to version prices by service.</Empty>
        )}
      </Card>
    </div>
  );
}

function Contracts({
  rows,
  options,
  clientName,
  entityName,
  saved,
  error,
}: {
  rows: api.Contract[];
  options: api.FormOptions;
  clientName: (id: string) => string;
  entityName: (id: string) => string;
  saved: () => void;
  error: (value: string) => void;
}) {
  const [clientId, setClientId] = useState('');
  const [entityId, setEntityId] = useState('');
  const [number, setNumber] = useState('');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(today());
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<api.Contract | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [amendedTitle, setAmendedTitle] = useState('');
  const [amendReason, setAmendReason] = useState('');
  const [documents, setDocuments] = useState<api.ContractDocument[]>([]);
  const [docReason, setDocReason] = useState('');
  const [usage, setUsage] = useState('');
  const [usageReason, setUsageReason] = useState('');
  const entity = options.legalEntities.find((item) => item.id === entityId);
  const create = () =>
    void api
      .createContract({
        clientId,
        legalEntityId: entityId,
        contractNumber: number,
        title,
        currency: entity?.baseCurrency || 'INR',
        billingModel: 'hourly',
        startDate: start,
        autoRenew: false,
        renewalNoticeDays: 30,
        signedStatus: 'pending',
        reason,
      })
      .then(saved)
      .catch((e) => error(messageOf(e)));
  const manage = (row: api.Contract) => {
    setSelected(row);
    setAmendedTitle(row.title);
    void api
      .listContractDocuments(row.id)
      .then(setDocuments)
      .catch((e) => error(messageOf(e)));
  };
  const status = (value: 'active' | 'cancelled') =>
    selected &&
    void api
      .changeContractStatus(selected.id, { status: value, reason: statusReason })
      .then(saved)
      .catch((e) => error(messageOf(e)));
  const amend = () =>
    selected &&
    void api
      .amendContract(selected.id, { title: amendedTitle, reason: amendReason })
      .then(saved)
      .catch((e) => error(messageOf(e)));
  const addUsage = () =>
    selected &&
    void api
      .recordContractUsage(selected.id, {
        usageDate: today(),
        unit: 'hours',
        quantity: usage,
        unitRate: '0',
        sourceType: 'manual',
        sourceId: selected.id,
        idempotencyKey: `manual-usage:${selected.id}:${today()}:${usage}`,
        reason: usageReason,
      })
      .then(saved)
      .catch((e) => error(messageOf(e)));
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selected) return;
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        typeof reader.result === 'string'
          ? resolve(reader.result)
          : reject(new Error('Unable to read document.'));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    void api
      .uploadContractDocument(selected.id, {
        originalFilename: file.name,
        mimeType: file.type,
        data,
        reason: docReason,
      })
      .then(() => api.listContractDocuments(selected.id))
      .then(setDocuments)
      .then(saved)
      .catch((e) => error(messageOf(e)));
  };
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[1fr_1.5fr]">
        <Card>
          <h2 className="font-display text-lg font-bold">Create contract</h2>
          <div className="mt-4 grid gap-3">
            <Select label="Client" value={clientId} onChange={setClientId}>
              <option value="">Select client</option>
              {options.clients.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.businessName || row.clientName}
                </option>
              ))}
            </Select>
            <Select label="Legal entity" value={entityId} onChange={setEntityId}>
              <option value="">Select legal entity</option>
              {options.legalEntities.map((row) => (
              <option key={row.id} value={row.id} disabled={row.status !== 'active'}>
                {row.code} · {row.legalName}{row.status !== 'active' ? ` · ${row.status.replace('_', ' ')}` : ''}
                </option>
              ))}
            </Select>
            <Input label="Contract number" value={number} onChange={setNumber} />
            <Input label="Title" value={title} onChange={setTitle} />
            <Input label="Start date" value={start} onChange={setStart} type="date" />
            <Input label="Reason" value={reason} onChange={setReason} />
            <Button
              type="button"
              disabled={
                !clientId ||
                !entityId ||
                !number.trim() ||
                !title.trim() ||
                reason.trim().length < 3
              }
              onClick={create}
            >
              Create contract
            </Button>
          </div>
        </Card>
        <Card>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-app-muted">
                Agreements
              </p>
              <h2 className="mt-1 font-display text-lg font-bold">Contracts</h2>
            </div>
            <span className="rounded-full bg-app-surface px-3 py-1 text-xs font-semibold text-app-muted">
              {rows.length} total
            </span>
          </div>
          {rows.length ? (
            <div className="mt-4 space-y-3">
              {rows.map((row) => (
                <div key={row.id} className="rounded-xl border border-app-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-app-muted">
                        {row.contractNumber}
                      </p>
                      <p className="mt-1 truncate font-semibold">{row.title}</p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${row.status === 'active' ? 'bg-emerald-500/10 text-emerald-700' : row.status === 'draft' ? 'bg-amber-500/10 text-amber-700' : 'bg-app-surface text-app-muted'}`}
                    >
                      {row.status}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 border-t border-app-border pt-3 text-xs sm:grid-cols-2">
                    <div>
                      <p className="text-app-muted">Client</p>
                      <p className="mt-1 font-medium">{clientName(row.clientId)}</p>
                    </div>
                    <div>
                      <p className="text-app-muted">Legal entity</p>
                      <p className="mt-1 font-medium">{entityName(row.legalEntityId)}</p>
                    </div>
                    <div>
                      <p className="text-app-muted">Billing model</p>
                      <p className="mt-1 font-medium capitalize">{row.billingModel}</p>
                    </div>
                    <div>
                      <p className="text-app-muted">Currency</p>
                      <p className="mt-1 font-medium">{row.currency}</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    className="mt-4 w-full px-3 py-2 text-xs"
                    onClick={() => manage(row)}
                  >
                    Manage contract
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <Empty>Contracts will appear here after creation.</Empty>
          )}
        </Card>
      </div>
      {selected && (
        <Card className="mt-5">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-app-border pb-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-app-accent">
                Contract management
              </p>
              <h2 className="mt-1 font-display text-lg font-bold">
                {selected.contractNumber}
              </h2>
              <p className="mt-1 text-sm text-app-muted">
                {selected.title} · {selected.status}
              </p>
            </div>
            <Button
              type="button"
              kind="secondary"
              className="px-3 py-1.5 text-xs"
              onClick={() => setSelected(null)}
            >
              Close
            </Button>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            <section className="rounded-xl border border-app-border p-4">
              <h3 className="text-sm font-bold">Lifecycle</h3>
              <div className="mt-3 grid gap-3">
                <Input
                  label="Status reason"
                  value={statusReason}
                  onChange={setStatusReason}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="px-3 py-2 text-xs"
                    disabled={!statusReason || selected.status !== 'draft'}
                    onClick={() => status('active')}
                  >
                    Activate
                  </Button>
                  <Button
                    type="button"
                    kind="danger"
                    className="px-3 py-2 text-xs"
                    disabled={
                      !statusReason || ['cancelled', 'expired'].includes(selected.status)
                    }
                    onClick={() => status('cancelled')}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </section>
            <section className="rounded-xl border border-app-border p-4">
              <h3 className="text-sm font-bold">Usage</h3>
              <div className="mt-3 grid gap-3">
                <Input
                  label="Usage hours"
                  value={usage}
                  onChange={setUsage}
                  type="number"
                  min="0"
                  step="0.0001"
                />
                <Input
                  label="Usage reason"
                  value={usageReason}
                  onChange={setUsageReason}
                />
                <Button
                  type="button"
                  className="w-full px-3 py-2 text-xs"
                  disabled={!usage || !usageReason}
                  onClick={addUsage}
                >
                  Record usage
                </Button>
              </div>
            </section>
            <section className="rounded-xl border border-app-border p-4">
              <h3 className="text-sm font-bold">Documents</h3>
              <div className="mt-3 grid gap-3">
                <Input
                  label="Document reason"
                  value={docReason}
                  onChange={setDocReason}
                />
                <label className="text-sm font-semibold">
                  Signed contract file
                  <input
                    className={inputClass}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    disabled={!docReason}
                    onChange={(event) => void upload(event)}
                  />
                </label>
                {documents.length ? (
                  <ul className="space-y-1 text-xs">
                    {documents.map((doc) => (
                      <li key={doc.id}>
                        <a
                          className="text-app-accent underline"
                          href={`/api/billing/contracts/${selected.id}/documents/${doc.id}/download`}
                        >
                          {doc.originalFilename}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-app-muted">No documents uploaded.</p>
                )}
              </div>
            </section>
          </div>
          <section className="mt-5 rounded-xl border border-app-border p-4">
            <h3 className="text-sm font-bold">Amend contract</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <Input
                label="Amended title"
                value={amendedTitle}
                onChange={setAmendedTitle}
              />
              <Input
                label="Amendment reason"
                value={amendReason}
                onChange={setAmendReason}
              />
              <Button
                type="button"
                className="px-3 py-2 text-xs"
                disabled={!amendedTitle || !amendReason || selected.status !== 'draft'}
                onClick={amend}
              >
                Save amendment
              </Button>
            </div>
          </section>
        </Card>
      )}
    </div>
  );
}

function Schedules({
  rows,
  contracts,
  clientName,
  saved,
  error,
}: {
  rows: api.Schedule[];
  contracts: api.Contract[];
  clientName: (id: string) => string;
  saved: () => void;
  error: (value: string) => void;
}) {
  const [contractId, setContractId] = useState('');
  const [recurrence, setRecurrence] = useState('monthly');
  const [date, setDate] = useState(today());
  const [day, setDay] = useState('1');
  const [reason, setReason] = useState('');
  const contract = contracts.find((row) => row.id === contractId);
  const create = () =>
    void api
      .createSchedule({
        contractId,
        recurrence,
        localTimezone: 'Asia/Kolkata',
        billingDay: recurrence === 'once' ? null : Number(day),
        nextBillDate: date,
        generationKey: `${contractId}:${recurrence}:${date}`,
        reason,
      })
      .then(saved)
      .catch((e) => error(messageOf(e)));
  return (
    <Card>
      <h2 className="font-display text-lg font-bold">Billing schedules</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <Select label="Contract" value={contractId} onChange={setContractId}>
          <option value="">Select contract</option>
          {contracts
            .filter((row) => !['cancelled', 'expired'].includes(row.status))
            .map((row) => (
              <option key={row.id} value={row.id}>
                {row.contractNumber} · {clientName(row.clientId)}
              </option>
            ))}
        </Select>
        <Select label="Recurrence" value={recurrence} onChange={setRecurrence}>
          {['once', 'monthly', 'quarterly', 'annual'].map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
        <Input label="Next bill date" value={date} onChange={setDate} type="date" />
        <Input label="Billing day" value={day} onChange={setDay} type="number" min="1" />
        <Input label="Reason" value={reason} onChange={setReason} />
        <Button
          type="button"
          disabled={!contract || reason.trim().length < 3}
          onClick={create}
        >
          Add schedule
        </Button>
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {rows.length ? (
          rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-app-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-app-muted">
                    Billing schedule
                  </p>
                  <p className="mt-1 font-semibold">
                    {contracts.find((item) => item.id === row.contractId)
                      ?.contractNumber || row.contractId}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold capitalize text-emerald-700">
                  {row.status}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-app-border pt-3 text-xs">
                <div>
                  <p className="text-app-muted">Recurrence</p>
                  <p className="mt-1 font-medium capitalize">{row.recurrence}</p>
                </div>
                <div>
                  <p className="text-app-muted">Next bill date</p>
                  <p className="mt-1 font-medium">{row.nextBillDate}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-app-muted">Generation key</p>
                  <p className="mt-1 break-all font-mono text-[11px]">
                    {row.generationKey}
                  </p>
                </div>
              </div>
            </div>
          ))
        ) : (
          <Empty>Scheduled billing candidates will appear here.</Empty>
        )}
      </div>
    </Card>
  );
}

function Events({
  rows,
  options,
  clientName,
  saved,
  error,
}: {
  rows: api.BillableEvent[];
  options: api.FormOptions;
  clientName: (id: string) => string;
  saved: () => void;
  error: (value: string) => void;
}) {
  const [clientId, setClientId] = useState('');
  const [sourceType, setSourceType] = useState<'manual' | 'billing_schedule'>('manual');
  const [sourceId, setSourceId] = useState('');
  const [scheduleOptions, setScheduleOptions] = useState<api.Schedule[]>([]);
  const [service, setService] = useState('professional-services');
  const [amount, setAmount] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState('');
  const client = options.clients.find((row) => row.id === clientId);
  useEffect(() => {
    void api
      .listSchedules()
      .then(setScheduleOptions)
      .catch(() => setScheduleOptions([]));
  }, []);
  const create = () =>
    void api
      .createBillableEvent({
        clientId,
        sourceType,
        ...(sourceType === 'billing_schedule' ? { sourceId } : {}),
        serviceKey: service,
        eventDate: date,
        currency: client?.currency || 'INR',
        quantity,
        amount,
        idempotencyKey: `${sourceType}:${sourceType === 'manual' ? crypto.randomUUID() : sourceId}:${date}`,
        reason,
      })
      .then(saved)
      .catch((e) => error(messageOf(e)));
  return (
    <Card>
      <h2 className="font-display text-lg font-bold">Billable events</h2>
      <p className="mt-1 text-sm text-app-muted">
        Manual events receive a source record automatically. Schedule events use the
        selected schedule as their source.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Select
          label="Source type"
          value={sourceType}
          onChange={(value) => {
            setSourceType(value as 'manual' | 'billing_schedule');
            setSourceId('');
          }}
        >
          <option value="manual">Manual</option>
          <option value="billing_schedule">Billing schedule</option>
        </Select>
        <Select label="Client" value={clientId} onChange={setClientId}>
          <option value="">Select client</option>
          {options.clients.map((row) => (
            <option key={row.id} value={row.id}>
              {row.businessName || row.clientName}
            </option>
          ))}
        </Select>
        {sourceType === 'billing_schedule' && (
          <Select label="Source schedule" value={sourceId} onChange={setSourceId}>
            <option value="">Select schedule</option>
            {scheduleOptions.map((row) => (
              <option key={row.id} value={row.id}>
                {row.recurrence} · {row.nextBillDate}
              </option>
            ))}
          </Select>
        )}
        <Input label="Service key" value={service} onChange={setService} />
        <Input label="Event date" value={date} onChange={setDate} type="date" />
        <Input
          label="Quantity"
          value={quantity}
          onChange={setQuantity}
          type="number"
          min="0"
        />
        <Input
          label="Amount"
          value={amount}
          onChange={setAmount}
          type="number"
          min="0"
          step="0.01"
        />
        <Input label="Reason" value={reason} onChange={setReason} />
        <Button
          type="button"
          disabled={
            !clientId ||
            (sourceType === 'billing_schedule' && !sourceId) ||
            !service.trim() ||
            !amount ||
            reason.trim().length < 3
          }
          onClick={create}
        >
          Create event
        </Button>
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {rows.length ? (
          rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-app-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{row.serviceKey}</p>
                  <p className="mt-1 text-xs text-app-muted">
                    {clientName(row.clientId)} · {row.sourceType}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${row.state === 'approved' ? 'bg-emerald-500/10 text-emerald-700' : row.state === 'rejected' ? 'bg-rose-500/10 text-rose-700' : 'bg-amber-500/10 text-amber-700'}`}
                >
                  {row.state}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-app-border pt-3 text-xs">
                <div>
                  <p className="text-app-muted">Event date</p>
                  <p className="mt-1 font-medium">{row.eventDate}</p>
                </div>
                <div>
                  <p className="text-app-muted">Amount</p>
                  <p className="mt-1 font-semibold">
                    {row.amount} {row.currency}
                  </p>
                </div>
                <div>
                  <p className="text-app-muted">Quantity</p>
                  <p className="mt-1 font-medium">{row.quantity}</p>
                </div>
                <div>
                  <p className="text-app-muted">Billed</p>
                  <p className="mt-1 font-medium">{row.billedQuantity}</p>
                </div>
              </div>
              {row.state === 'pending' && (
                <div className="mt-4 flex gap-2 border-t border-app-border pt-3">
                  <Button
                    type="button"
                    className="flex-1 px-3 py-2 text-xs"
                    onClick={() =>
                      void api
                        .decideBillableEvent(row.id, {
                          decision: 'approved',
                          reason: 'Reviewed in Finance UI',
                        })
                        .then(saved)
                        .catch((e) => error(messageOf(e)))
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    kind="danger"
                    className="flex-1 px-3 py-2 text-xs"
                    onClick={() =>
                      void api
                        .decideBillableEvent(row.id, {
                          decision: 'rejected',
                          reason: 'Rejected in Finance UI',
                        })
                        .then(saved)
                        .catch((e) => error(messageOf(e)))
                    }
                  >
                    Reject
                  </Button>
                </div>
              )}
            </div>
          ))
        ) : (
          <Empty>Events from approved source work will appear here.</Empty>
        )}
      </div>
    </Card>
  );
}
