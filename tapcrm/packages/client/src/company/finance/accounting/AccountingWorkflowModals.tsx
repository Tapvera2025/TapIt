import { useEffect, useState } from 'react';
import { Button, Field, Modal, Notice, Select } from '../../../ui/components.js';
import type { LedgerAccount } from './accountingApi.js';
import { listSyncSources, type SyncSource } from './completionApi.js';

type Line = {
  accountId: string;
  debit: string;
  credit: string;
  client: string;
  project: string;
  serviceLine: string;
  department: string;
  costCentre: string;
};
const money = /^\d+(\.\d{1,2})?$/;
const currency = /^[A-Z]{3}$/;
const today = () => new Date().toISOString().slice(0, 10);
const accountOptions = (accounts: LedgerAccount[]) => [
  { value: '', label: 'Select account' },
  ...accounts.map((account) => ({
    value: account.id,
    label: `${account.code} · ${account.name}`,
  })),
];
const dimensions = (line: Line) =>
  Object.fromEntries(
    Object.entries({
      client: line.client,
      project: line.project,
      serviceLine: line.serviceLine,
      department: line.department,
      costCentre: line.costCentre,
    }).filter(([, value]) => value.trim()),
  );

export function AccountingReasonModal({
  title,
  description,
  onClose,
  onSubmit,
  submitLabel = 'Confirm',
}: {
  title: string;
  description: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
  submitLabel?: string;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setError('A reason of at least three characters is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit(reason.trim());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to complete the accounting action.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="accounting-reason-form" disabled={busy}>
            {busy ? 'Saving…' : submitLabel}
          </Button>
        </div>
      }
    >
      <form
        id="accounting-reason-form"
        onSubmit={(event) => void submit(event)}
        className="space-y-4"
      >
        {error && <Notice error>{error}</Notice>}
        <p className="text-sm text-app-muted">{description}</p>
        <Field
          label="Reason"
          required
          value={reason}
          onChange={setReason}
          hint="This reason is retained in the accounting audit trail."
        />
      </form>
    </Modal>
  );
}

export function JournalModal({
  accounts,
  entities,
  defaultDate,
  periodStart,
  periodEnd,
  onClose,
  onSubmit,
}: {
  accounts: LedgerAccount[];
  entities: Array<{ id: string; code: string; legalName: string; baseCurrency: string }>;
  defaultDate: string;
  periodStart?: string | undefined;
  periodEnd?: string | undefined;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}): React.JSX.Element {
  const empty = (): Line => ({
    accountId: '',
    debit: '',
    credit: '',
    client: '',
    project: '',
    serviceLine: '',
    department: '',
    costCentre: '',
  });
  const [date, setDate] = useState(defaultDate || today());
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');
  const [transactionCurrency, setTransactionCurrency] = useState('INR');
  const [baseCurrency, setBaseCurrency] = useState('INR');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [exchangeRateSource, setExchangeRateSource] = useState('');
  const [legalEntityId, setLegalEntityId] = useState('');
  const [lines, setLines] = useState<Line[]>([empty(), empty()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const total = (key: 'debit' | 'credit') =>
    lines.reduce((sum, line) => sum + Number(line[key] || 0), 0);
  const update = (index: number, key: keyof Line, value: string) =>
    setLines((current) =>
      current.map((line, itemIndex) =>
        itemIndex === index
          ? {
              ...line,
              [key]: value,
              ...(key === 'debit' && value ? { credit: '' } : {}),
              ...(key === 'credit' && value ? { debit: '' } : {}),
            }
          : line,
      ),
    );
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!description.trim() || reason.trim().length < 3) {
      setError('Description and an audit reason are required.');
      return;
    }
    if (periodStart && periodEnd && (date < periodStart || date > periodEnd)) {
      setError(
        `Entry date must be within the selected period (${periodStart} to ${periodEnd}).`,
      );
      return;
    }
    if (!currency.test(transactionCurrency) || !currency.test(baseCurrency)) {
      setError('Currencies must be three-letter ISO codes.');
      return;
    }
    if (!money.test(exchangeRate) || Number(exchangeRate) <= 0) {
      setError('Exchange rate must be a positive number.');
      return;
    }
    if (
      lines.some(
        (line) =>
          !line.accountId ||
          !money.test(line.debit || '0') ||
          !money.test(line.credit || '0') ||
          (Number(line.debit || 0) === 0 && Number(line.credit || 0) === 0),
      )
    ) {
      setError(
        'Every journal line needs an account and either a debit or credit amount.',
      );
      return;
    }
    if (Math.abs(total('debit') - total('credit')) >= 0.005) {
      setError('Journal debits and credits must balance exactly.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        entryDate: date,
        description: description.trim(),
        sourceType: 'manual',
        reason: reason.trim(),
        legalEntityId: legalEntityId || null,
        transactionCurrency: transactionCurrency.toUpperCase(),
        baseCurrency: baseCurrency.toUpperCase(),
        exchangeRate,
        exchangeRateSource: exchangeRateSource.trim() || null,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit || '0',
          credit: line.credit || '0',
          dimensions: dimensions(line),
        })),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to post journal.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Create manual journal"
      onClose={onClose}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="journal-form" disabled={busy}>
            {busy ? 'Posting…' : 'Post journal'}
          </Button>
        </div>
      }
    >
      <form
        id="journal-form"
        onSubmit={(event) => void submit(event)}
        className="space-y-5"
      >
        {error && <Notice error>{error}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Entry date"
            required
            type="date"
            value={date}
            onChange={setDate}
          />
          <Field
            label="Description"
            required
            value={description}
            onChange={setDescription}
          />
          <Field label="Reason" required value={reason} onChange={setReason} />
          <Select
            label="Legal entity"
            value={legalEntityId}
            onChange={setLegalEntityId}
            options={[
              { value: '', label: 'Organization default' },
              ...entities.map((entity) => ({
                value: entity.id,
                label: `${entity.code} · ${entity.legalName}`,
              })),
            ]}
          />
          <Field
            label="Transaction currency"
            required
            maxLength={3}
            value={transactionCurrency}
            onChange={(value) => setTransactionCurrency(value.toUpperCase())}
          />
          <Field
            label="Base currency"
            required
            maxLength={3}
            value={baseCurrency}
            onChange={(value) => setBaseCurrency(value.toUpperCase())}
          />
          <Field
            label="Exchange rate"
            required
            type="number"
            value={exchangeRate}
            onChange={setExchangeRate}
          />
          <Field
            label="Exchange-rate source"
            value={exchangeRateSource}
            onChange={setExchangeRateSource}
          />
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Journal lines</h3>
            <span className="text-xs text-app-muted">
              Debit {total('debit').toFixed(2)} · Credit {total('credit').toFixed(2)}
            </span>
          </div>
          {lines.map((line, index) => (
            <div
              className="grid gap-3 rounded-xl border border-app-border p-3 sm:grid-cols-2"
              key={index}
            >
              <Select
                label="Account"
                required
                value={line.accountId}
                onChange={(value) => update(index, 'accountId', value)}
                options={accountOptions(accounts)}
              />
              <div className="grid grid-cols-2 gap-2">
                <Field
                  label="Debit"
                  type="number"
                  value={line.debit}
                  onChange={(value) => update(index, 'debit', value)}
                />
                <Field
                  label="Credit"
                  type="number"
                  value={line.credit}
                  onChange={(value) => update(index, 'credit', value)}
                />
              </div>
              <Field
                label="Client dimension"
                value={line.client}
                onChange={(value) => update(index, 'client', value)}
              />
              <Field
                label="Project dimension"
                value={line.project}
                onChange={(value) => update(index, 'project', value)}
              />
              <Field
                label="Service line"
                value={line.serviceLine}
                onChange={(value) => update(index, 'serviceLine', value)}
              />
              <Field
                label="Department"
                value={line.department}
                onChange={(value) => update(index, 'department', value)}
              />
              <Field
                label="Cost centre"
                value={line.costCentre}
                onChange={(value) => update(index, 'costCentre', value)}
              />
              <Button
                kind="secondary"
                onClick={() =>
                  setLines((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
                disabled={lines.length <= 2}
              >
                Remove line
              </Button>
            </div>
          ))}
          <Button
            kind="secondary"
            onClick={() => setLines((current) => [...current, empty()])}
          >
            Add line
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ScheduleModal({
  accounts,
  entities,
  onClose,
  onSubmit,
}: {
  accounts: LedgerAccount[];
  entities: Array<{ id: string; code: string; legalName: string; baseCurrency: string }>;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}): React.JSX.Element {
  const [type, setType] = useState('deferred_revenue');
  const [description, setDescription] = useState('');
  const [legalEntityId, setLegalEntityId] = useState('');
  const [debitAccountId, setDebitAccountId] = useState('');
  const [creditAccountId, setCreditAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [currencyValue, setCurrencyValue] = useState('INR');
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [nextDate, setNextDate] = useState(today());
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      description.trim().length < 2 ||
      !debitAccountId ||
      !creditAccountId ||
      debitAccountId === creditAccountId ||
      !money.test(amount) ||
      Number(amount) <= 0 ||
      !currency.test(currencyValue) ||
      reason.trim().length < 3
    ) {
      setError(
        'Description, different accounts, positive amount, valid currency, and reason are required.',
      );
      return;
    }
    if (endDate < startDate || nextDate < startDate || nextDate > endDate) {
      setError('Schedule dates are invalid.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        scheduleType: type,
        description: description.trim(),
        legalEntityId: legalEntityId || null,
        sourceType: 'manual',
        sourceId: null,
        debitAccountId,
        creditAccountId,
        totalAmount: amount,
        currency: currencyValue.toUpperCase(),
        startDate,
        endDate,
        nextRecognitionDate: nextDate,
        reason: reason.trim(),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create schedule.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Create recognition schedule"
      onClose={onClose}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="schedule-form" disabled={busy}>
            {busy ? 'Saving…' : 'Create schedule'}
          </Button>
        </div>
      }
    >
      <form
        id="schedule-form"
        onSubmit={(event) => void submit(event)}
        className="space-y-4"
      >
        {error && <Notice error>{error}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Schedule type"
            value={type}
            onChange={setType}
            options={[
              { value: 'deferred_revenue', label: 'Deferred revenue' },
              { value: 'accrual', label: 'Accrual' },
              { value: 'prepayment', label: 'Prepayment' },
            ]}
          />
          <Select
            label="Legal entity"
            value={legalEntityId}
            onChange={setLegalEntityId}
            options={[
              { value: '', label: 'Organization default' },
              ...entities.map((entity) => ({
                value: entity.id,
                label: `${entity.code} · ${entity.legalName}`,
              })),
            ]}
          />
          <Field
            label="Description"
            required
            value={description}
            onChange={setDescription}
          />
          <Field
            label="Amount"
            required
            type="number"
            value={amount}
            onChange={setAmount}
          />
          <Field
            label="Currency"
            required
            maxLength={3}
            value={currencyValue}
            onChange={(value) => setCurrencyValue(value.toUpperCase())}
          />
          <Select
            label="Debit account"
            required
            value={debitAccountId}
            onChange={setDebitAccountId}
            options={accountOptions(accounts)}
          />
          <Select
            label="Credit account"
            required
            value={creditAccountId}
            onChange={setCreditAccountId}
            options={accountOptions(accounts)}
          />
          <Field
            label="Start date"
            required
            type="date"
            value={startDate}
            onChange={setStartDate}
          />
          <Field
            label="End date"
            required
            type="date"
            value={endDate}
            onChange={setEndDate}
          />
          <Field
            label="Next recognition date"
            required
            type="date"
            value={nextDate}
            onChange={setNextDate}
          />
          <Field label="Reason" required value={reason} onChange={setReason} />
        </div>
      </form>
    </Modal>
  );
}

export function RecognitionModal({
  schedule,
  onClose,
  onSubmit,
}: {
  schedule: {
    description: string;
    recognizedAmount: string;
    totalAmount: string;
    currency: string;
  };
  onClose: () => void;
  onSubmit: (amount: string, entryDate: string, reason: string) => Promise<void>;
}): React.JSX.Element {
  const [amount, setAmount] = useState('');
  const [entryDate, setEntryDate] = useState(today());
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !money.test(amount) ||
      Number(amount) <= 0 ||
      Number(amount) > Number(schedule.totalAmount) - Number(schedule.recognizedAmount) ||
      reason.trim().length < 3
    ) {
      setError(
        'Enter a positive amount within the remaining balance and a reason of at least three characters.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit(amount, entryDate, reason.trim());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to recognize the schedule.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Recognize schedule amount"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="recognition-form" disabled={busy}>
            {busy ? 'Posting…' : 'Recognize amount'}
          </Button>
        </div>
      }
    >
      <form
        id="recognition-form"
        onSubmit={(event) => void submit(event)}
        className="space-y-4"
      >
        {error && <Notice error>{error}</Notice>}
        <p className="text-sm text-app-muted">
          {schedule.description} · {schedule.recognizedAmount} / {schedule.totalAmount}{' '}
          {schedule.currency} recognized.
        </p>
        <Field
          label="Recognition amount"
          required
          type="number"
          value={amount}
          onChange={setAmount}
        />
        <Field
          label="Entry date"
          required
          type="date"
          value={entryDate}
          onChange={setEntryDate}
        />
        <Field label="Reason" required value={reason} onChange={setReason} />
      </form>
    </Modal>
  );
}

export function RevaluationModal({
  accounts,
  entities,
  onClose,
  onSubmit,
}: {
  accounts: LedgerAccount[];
  entities: Array<{ id: string; code: string; legalName: string; baseCurrency: string }>;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}): React.JSX.Element {
  const [entityId, setEntityId] = useState('');
  const [date, setDate] = useState(today());
  const [base, setBase] = useState('INR');
  const [gainLoss, setGainLoss] = useState('');
  const [accountId, setAccountId] = useState('');
  const [fxCurrency, setFxCurrency] = useState('AUD');
  const [foreignAmount, setForeignAmount] = useState('');
  const [oldBase, setOldBase] = useState('');
  const [newBase, setNewBase] = useState('');
  const [rate, setRate] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !gainLoss ||
      !accountId ||
      !currency.test(base) ||
      !currency.test(fxCurrency) ||
      base === fxCurrency ||
      !money.test(foreignAmount) ||
      Number(foreignAmount) <= 0 ||
      !money.test(oldBase) ||
      !money.test(newBase) ||
      !money.test(rate) ||
      Number(rate) <= 0 ||
      idempotencyKey.trim().length < 8 ||
      reason.trim().length < 3
    ) {
      setError(
        'Use different base and foreign currencies, positive amounts/rate, an idempotency key of at least 8 characters, and an audit reason.',
      );
      return;
    }
    if (accountId === gainLoss) {
      setError('The FX gain/loss account must differ from the account being revalued.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        legalEntityId: entityId || null,
        asOfDate: date,
        baseCurrency: base.toUpperCase(),
        idempotencyKey: idempotencyKey.trim(),
        gainLossAccountId: gainLoss,
        lines: [
          {
            accountId,
            currency: fxCurrency.toUpperCase(),
            foreignAmount,
            oldBaseAmount: oldBase,
            newBaseAmount: newBase,
            rate,
          },
        ],
        reason: reason.trim(),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to post FX revaluation.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Post FX revaluation"
      onClose={onClose}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="revaluation-form" disabled={busy}>
            {busy ? 'Posting…' : 'Post revaluation'}
          </Button>
        </div>
      }
    >
      <form
        id="revaluation-form"
        onSubmit={(event) => void submit(event)}
        className="space-y-4"
      >
        {error && <Notice error>{error}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Legal entity"
            value={entityId}
            onChange={setEntityId}
            options={[
              { value: '', label: 'Organization default' },
              ...entities.map((entity) => ({
                value: entity.id,
                label: `${entity.code} · ${entity.legalName}`,
              })),
            ]}
          />
          <Field
            label="As-of date"
            required
            type="date"
            value={date}
            onChange={setDate}
          />
          <Field
            label="Base currency"
            required
            maxLength={3}
            value={base}
            onChange={(value) => setBase(value.toUpperCase())}
          />
          <Field
            label="Foreign currency"
            required
            maxLength={3}
            value={fxCurrency}
            onChange={(value) => setFxCurrency(value.toUpperCase())}
          />
          <Select
            label="Account being revalued"
            required
            value={accountId}
            onChange={setAccountId}
            options={accountOptions(accounts)}
          />
          <Select
            label="FX gain/loss account"
            required
            value={gainLoss}
            onChange={setGainLoss}
            options={accountOptions(accounts)}
          />
          <Field
            label="Foreign amount"
            required
            type="number"
            value={foreignAmount}
            onChange={setForeignAmount}
          />
          <Field
            label="Old base amount"
            required
            type="number"
            value={oldBase}
            onChange={setOldBase}
          />
          <Field
            label="New base amount"
            required
            type="number"
            value={newBase}
            onChange={setNewBase}
          />
          <Field
            label="Exchange rate"
            required
            type="number"
            value={rate}
            onChange={setRate}
          />
          <Field
            label="Idempotency key"
            required
            value={idempotencyKey}
            onChange={setIdempotencyKey}
            hint="Reuse this exact key to safely retry without another journal."
          />
          <Field label="Reason" required value={reason} onChange={setReason} />
        </div>
      </form>
    </Modal>
  );
}

export function SyncModal({
  entities,
  onClose,
  onSubmit,
}: {
  entities: Array<{ id: string; code: string; legalName: string; baseCurrency: string }>;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}): React.JSX.Element {
  const [provider, setProvider] = useState('xero');
  const [entityId, setEntityId] = useState('');
  const [sourceType, setSourceType] = useState<'journal' | 'accounting-schedule'>(
    'journal',
  );
  const [sourceId, setSourceId] = useState('');
  const [key, setKey] = useState('');
  const [sources, setSources] = useState<SyncSource[]>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = sources.find((source) => source.id === sourceId);
  useEffect(() => {
    setSourceId('');
    void listSyncSources(sourceType)
      .then(setSources)
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to load synchronization sources.',
        ),
      );
  }, [sourceType]);
  useEffect(() => {
    if (selected) setKey(`${provider}:${selected.sourceType}:${selected.id}`);
  }, [provider, selected]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < 3 || !selected || key.trim().length < 8) {
      setError(
        'Select a source record, use an idempotency key of at least 8 characters, and provide a reason.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        provider,
        entityId: entityId || null,
        sourceType: selected.sourceType,
        sourceId: selected.id,
        idempotencyKey: key.trim(),
        reason: reason.trim(),
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to queue synchronization.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Queue accounting synchronization"
      onClose={onClose}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="sync-form" disabled={busy || !selected}>
            {busy ? 'Queueing…' : 'Queue sync'}
          </Button>
        </div>
      }
    >
      <form id="sync-form" onSubmit={(event) => void submit(event)} className="space-y-4">
        {error && <Notice error>{error}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Provider" required value={provider} onChange={setProvider} />
          <Select
            label="Legal entity"
            value={entityId}
            onChange={setEntityId}
            options={[
              { value: '', label: 'Organization default' },
              ...entities.map((entity) => ({
                value: entity.id,
                label: `${entity.code} · ${entity.legalName}`,
              })),
            ]}
          />
          <Select
            label="Source type"
            required
            value={sourceType}
            onChange={(value) =>
              setSourceType(value as 'journal' | 'accounting-schedule')
            }
            options={[
              { value: 'journal', label: 'Journal' },
              { value: 'accounting-schedule', label: 'Recognition schedule' },
            ]}
          />
          <Select
            label="Source record"
            required
            value={sourceId}
            onChange={setSourceId}
            options={[
              {
                value: '',
                label: sources.length
                  ? 'Select source record'
                  : 'No source records available',
              },
              ...sources.map((source) => ({ value: source.id, label: source.label })),
            ]}
          />
          <Field
            label="Idempotency key"
            required
            value={key}
            onChange={setKey}
            hint="Generated from the selected source; keep it unchanged when retrying."
          />
          <Field label="Reason" required value={reason} onChange={setReason} />
        </div>
        <label className="text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Payload preview</span>
          <pre className="min-h-32 w-full overflow-auto rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm">
            {selected
              ? JSON.stringify(selected.payload, null, 2)
              : 'Select a source record to preview the server payload.'}
          </pre>
        </label>
      </form>
    </Modal>
  );
}
