import { useEffect, useState } from 'react';
import { Button, Card, Loading, Notice } from '../../../ui/components.js';
import { listAccounts, type LedgerAccount } from '../accounting/accountingApi.js';
import {
  getReconciliationSettings,
  updateReconciliationSettings,
  type ReconciliationSettings,
} from './reconciliationApi.js';

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to update reconciliation settings.';
const inputClass =
  'mt-2 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal';
const parseHeader = (line: string): string[] => {
  const headers: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) {
      headers.push(value.trim());
      value = '';
    } else value += character;
  }
  headers.push(value.trim());
  return headers.filter(Boolean);
};
const parsePreview = (text: string, headers: string[]): string[][] =>
  text
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(1, 4)
    .map((line) => {
      const cells = line.split(',').map((cell) => cell.trim());
      return headers.map((_, index) => cells[index] ?? '');
    });

export function ReconciliationSettingsCard(): React.JSX.Element {
  const [data, setData] = useState<ReconciliationSettings | null>(null);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mappingMode, setMappingMode] = useState<'manual' | 'csv'>('manual');
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<string[][]>([]);
  const [fileName, setFileName] = useState('');
  useEffect(() => {
    void Promise.all([getReconciliationSettings(), listAccounts('active')])
      .then(([settings, accountResult]) => {
        setData(settings);
        setAccounts(accountResult.accounts);
      })
      .catch((cause) => setError(messageOf(cause)));
  }, []);
  if (!data)
    return error ? (
      <Notice error>{error}</Notice>
    ) : (
      <Card>
        <Loading />
      </Card>
    );
  const update = (patch: Partial<ReconciliationSettings>) =>
    setData({ ...data, ...patch });
  const setColumn = (
    key: keyof Pick<
      ReconciliationSettings,
      | 'csvDateColumn'
      | 'csvReferenceColumn'
      | 'csvDescriptionColumn'
      | 'csvDebitColumn'
      | 'csvCreditColumn'
    >,
    value: string,
  ) => update({ [key]: value });
  const mappings: Array<
    [
      keyof Pick<
        ReconciliationSettings,
        | 'csvDateColumn'
        | 'csvReferenceColumn'
        | 'csvDescriptionColumn'
        | 'csvDebitColumn'
        | 'csvCreditColumn'
      >,
      string,
    ]
  > = [
    ['csvDateColumn', 'Date'],
    ['csvReferenceColumn', 'Reference'],
    ['csvDescriptionColumn', 'Description'],
    ['csvDebitColumn', 'Debit'],
    ['csvCreditColumn', 'Credit'],
  ];
  const uploadSample = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('Sample CSV must be smaller than 5 MB.');
      return;
    }
    try {
      const text = await file.text();
      const nextHeaders = parseHeader(text.split(/\r?\n/, 1)[0] ?? '');
      if (nextHeaders.length < 3)
        throw new Error('The sample CSV must contain at least three column headers.');
      setHeaders(nextHeaders);
      setPreview(parsePreview(text, nextHeaders));
      setFileName(file.name);
      setMappingMode('csv');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to read the sample CSV.');
    }
  };
  const save = async () => {
    if (reason.trim().length < 3) {
      setError('A reason of at least 3 characters is required.');
      return;
    }
    if (
      mappingMode === 'csv' &&
      (!headers.length || mappings.some(([key]) => !headers.includes(data[key])))
    ) {
      setError('Select a detected CSV header for every mapped column.');
      return;
    }
    if (
      new Set(mappings.map(([key]) => data[key].toLowerCase())).size !== mappings.length
    ) {
      setError('Each mapped CSV column must be different.');
      return;
    }
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      setData(await updateReconciliationSettings({ ...data, reason: reason.trim() }));
      setReason('');
      setSaved(true);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <h2 className="text-lg font-semibold">Bank and reconciliation setup</h2>
      <p className="mt-1 text-sm text-app-muted">
        Configure this company’s bank source. You can enter headers manually or upload a
        sample CSV to select detected headers.
      </p>
      {error && (
        <div className="mt-3">
          <Notice error>{error}</Notice>
        </div>
      )}
      {saved && (
        <div className="mt-3">
          <Notice>Reconciliation settings saved and audited.</Notice>
        </div>
      )}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-sm font-semibold">
          Bank mode
          <select
            className={inputClass}
            value={data.bankMode}
            onChange={(event) =>
              update({
                bankMode: event.target.value as ReconciliationSettings['bankMode'],
              })
            }
          >
            <option value="manual_csv">Manual CSV import</option>
            <option value="api">Bank API connector</option>
          </select>
        </label>
        <label className="text-sm font-semibold">
          Bank/provider name
          <input
            className={inputClass}
            value={data.bankProvider ?? ''}
            onChange={(event) => update({ bankProvider: event.target.value || null })}
            placeholder="e.g. HDFC Bank"
          />
        </label>
        <label className="text-sm font-semibold">
          Account label
          <input
            className={inputClass}
            value={data.bankAccountName ?? ''}
            onChange={(event) => update({ bankAccountName: event.target.value || null })}
            placeholder="e.g. Operating account"
          />
        </label>
        <label className="text-sm font-semibold">
          Currency
          <select
            className={inputClass}
            value={data.bankCurrency}
            onChange={(event) => update({ bankCurrency: event.target.value })}
          >
            {['INR', 'USD', 'AUD', 'EUR', 'GBP'].map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold md:col-span-2">
          Ledger bank account
          <select
            className={inputClass}
            value={data.bankLedgerAccountId ?? ''}
            onChange={(event) =>
              update({ bankLedgerAccountId: event.target.value || null })
            }
          >
            <option value="">Select a ledger account</option>
            {accounts
              .filter((account) => account.accountType === 'asset')
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="mt-6 rounded-xl border border-app-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">CSV column mapping</h3>
            <p className="mt-1 text-xs text-app-muted">
              Manual mode accepts the exact header names. CSV mode detects headers from a
              sample file.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              kind={mappingMode === 'manual' ? 'primary' : 'secondary'}
              onClick={() => setMappingMode('manual')}
            >
              Manual entry
            </Button>
            <Button
              kind={mappingMode === 'csv' ? 'primary' : 'secondary'}
              onClick={() => setMappingMode('csv')}
            >
              CSV upload
            </Button>
          </div>
        </div>
        <label className="mt-4 block text-sm font-semibold">
          Sample bank CSV{' '}
          <input
            type="file"
            accept=".csv,text/csv"
            className={`${inputClass} text-sm`}
            onChange={(event) => void uploadSample(event.target.files?.[0])}
          />
          <span className="mt-1 block text-xs font-normal text-app-muted">
            Optional mapping file; it is read in the browser and is not uploaded or
            stored.
          </span>
        </label>
        {fileName && (
          <p className="mt-2 text-xs text-app-muted">Detected from: {fileName}</p>
        )}
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {mappings.map(([key, label]) => (
            <label className="text-sm font-semibold" key={key}>
              {label} column
              {mappingMode === 'csv' && headers.length ? (
                <select
                  className={inputClass}
                  value={data[key]}
                  onChange={(event) => setColumn(key, event.target.value)}
                >
                  <option value="">Select CSV header</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={inputClass}
                  value={data[key]}
                  onChange={(event) => setColumn(key, event.target.value)}
                  placeholder={`e.g. ${label}`}
                />
              )}
            </label>
          ))}
        </div>
        {preview.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <p className="mb-2 text-xs font-semibold text-app-muted">Sample preview</p>
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  {headers.map((header) => (
                    <th className="border-b border-app-border p-2" key={header}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td
                        className="border-b border-app-border p-2"
                        key={`${rowIndex}-${cellIndex}`}
                      >
                        {cell || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <label className="mt-5 block text-sm font-semibold">
        Reason for change
        <textarea
          className="mt-2 min-h-20 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Required for every change"
        />
      </label>
      <div className="mt-4 flex justify-end">
        <Button onClick={() => void save()} disabled={busy || reason.trim().length < 3}>
          {busy ? 'Saving…' : 'Save reconciliation settings'}
        </Button>
      </div>
    </Card>
  );
}
