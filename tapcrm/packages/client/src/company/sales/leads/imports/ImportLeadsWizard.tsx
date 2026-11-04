import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Button, Field, Icon, Modal, Notice, SearchableSelect, Select, Skeleton } from '../../../../ui/index.js';
import { formatPhone } from '../../calls/calls-format.js';
import { createLeadSource, type Campaign, type LeadSource } from '../api.js';
import {
  createImport,
  discardImport,
  fileToBase64,
  getImport,
  listAssignees,
  previewImport,
  resumeImport,
  startImport,
  type AssigneeOption,
  type CreateImportInput,
  type ImportField,
  type ImportPreview,
  type ImportSettings,
  type LeadImportDetail,
  type LeadImportSummary,
  type PreviewRow,
} from './api.js';
import {
  importProgress,
  looksLikeGoogleSheet,
  MAX_UPLOAD_BYTES,
  plural,
  PREVIEW_STATUS_LABELS,
  previewStatusTone,
  readableBytes,
  TEMPLATE_CSV,
  UPLOAD_ACCEPT,
} from './import-format.js';

type Step = 'source' | 'columns' | 'review' | 'progress';
type SourceMode = 'file' | 'sheet' | 'paste';

/** Fields several columns may feed (their values are joined). */
const MULTI_FIELDS = new Set<ImportField>(['requirement', 'location', 'notes']);

const STEPS: ReadonlyArray<{ id: Step; label: string }> = [
  { id: 'source', label: 'Choose list' },
  { id: 'columns', label: 'Match columns' },
  { id: 'review', label: 'Review' },
  { id: 'progress', label: 'Import' },
];

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/**
 * Bring a lead list into the CRM: pick a file, a Google Sheet or pasted rows,
 * match its columns to lead fields, review what will happen, import.
 */
export function ImportLeadsWizard({
  sources: initialSources,
  campaigns,
  onClose,
  onDone,
}: {
  sources: LeadSource[];
  campaigns: Campaign[];
  onClose: () => void;
  /** After a finished import: show its leads. */
  onDone: (importId: string) => void;
}): React.JSX.Element {
  const [step, setStep] = useState<Step>('source');
  const [mode, setMode] = useState<SourceMode>('file');
  const [file, setFile] = useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = useState('');
  const [pasted, setPasted] = useState('');
  const [draft, setDraft] = useState<LeadImportDetail | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [settings, setSettings] = useState<ImportSettings | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [summary, setSummary] = useState<LeadImportSummary | null>(null);
  const [sources, setSources] = useState<LeadSource[]>(initialSources);
  const [people, setPeople] = useState<AssigneeOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    listAssignees()
      .then((result) => setPeople(result.items))
      .catch(() => setPeople([]));
  }, []);

  // A draft nobody imported is discarded when the window closes.
  const draftRef = useRef<LeadImportDetail | null>(null);
  draftRef.current = draft;
  useEffect(
    () => () => {
      if (draftRef.current && !started.current) void discardImport(draftRef.current.id).catch(() => undefined);
    },
    [],
  );

  async function upload(sheet?: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      let input: CreateImportInput;
      if (mode === 'file') {
        if (!file) throw new Error('Choose a file first.');
        if (file.size > MAX_UPLOAD_BYTES) throw new Error('This file is larger than 10 MB. Split it into smaller files.');
        input = { kind: 'file', fileName: file.name, fileBase64: await fileToBase64(file), sheet };
      } else if (mode === 'sheet') {
        if (!looksLikeGoogleSheet(sheetUrl)) throw new Error('Paste the link of a Google Sheet (it starts with https://docs.google.com/spreadsheets/).');
        input = { kind: 'google_sheet', url: sheetUrl.trim() };
      } else {
        if (!pasted.trim()) throw new Error('Paste the rows first.');
        input = { kind: 'paste', text: pasted };
      }
      const created = await createImport(input);
      if (draft && draft.id !== created.id) void discardImport(draft.id).catch(() => undefined);
      setDraft(created);
      if (created.sheets.length) setSheets(created.sheets);
      setSettings(created.settings);
      setPreview(null);
      setStep('columns');
    } catch (cause) {
      setError(errorText(cause, 'The list could not be read.'));
    } finally {
      setBusy(false);
    }
  }

  async function runPreview(next: ImportSettings): Promise<void> {
    if (!draft) return;
    setPreviewing(true);
    setError(null);
    try {
      setPreview(await previewImport(draft.id, next));
    } catch (cause) {
      setError(errorText(cause, 'The preview could not be made.'));
    } finally {
      setPreviewing(false);
    }
  }

  async function begin(): Promise<void> {
    if (!draft || !settings) return;
    setBusy(true);
    setError(null);
    try {
      const result = await startImport(draft.id, settings);
      started.current = true;
      setSummary(result);
      setStep('progress');
    } catch (cause) {
      setError(errorText(cause, 'The import could not start.'));
    } finally {
      setBusy(false);
    }
  }

  // While importing, follow the progress.
  useEffect(() => {
    if (step !== 'progress' || !summary || summary.status === 'completed' || summary.status === 'failed') return;
    const timer = window.setTimeout(() => {
      getImport(summary.id)
        .then(setSummary)
        .catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [step, summary]);

  async function resume(): Promise<void> {
    if (!summary) return;
    setBusy(true);
    try {
      setSummary(await resumeImport(summary.id));
    } catch (cause) {
      setError(errorText(cause, 'The import could not be resumed.'));
    } finally {
      setBusy(false);
    }
  }

  const mappedFields = new Set(Object.values(settings?.columnMapping ?? {}));
  const canContinueColumns = Boolean(settings && settings.name.trim() && settings.leadSourceId && (mappedFields.has('phone') || mappedFields.has('email')));
  const footer = (() => {
    if (step === 'source') {
      const ready = mode === 'file' ? Boolean(file) : mode === 'sheet' ? sheetUrl.trim().length > 0 : pasted.trim().length > 0;
      return (
        <div className="flex flex-wrap justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void upload()} disabled={!ready || busy}>{busy ? 'Reading…' : 'Continue'}</Button>
        </div>
      );
    }
    if (step === 'columns') {
      return (
        <div className="flex flex-wrap justify-between gap-2">
          <Button kind="secondary" onClick={() => setStep('source')}>Back</Button>
          <Button
            disabled={!canContinueColumns || busy}
            onClick={() => {
              if (!settings) return;
              setStep('review');
              void runPreview(settings);
            }}
          >
            Review
          </Button>
        </div>
      );
    }
    if (step === 'review') {
      const count = preview ? preview.ready : 0;
      return (
        <div className="flex flex-wrap justify-between gap-2">
          <Button kind="secondary" onClick={() => setStep('columns')}>Back</Button>
          <Button onClick={() => void begin()} disabled={!preview || previewing || busy || count === 0}>
            {busy ? 'Starting…' : `Import ${plural(count, 'lead')}`}
          </Button>
        </div>
      );
    }
    const finished = summary?.status === 'completed';
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button kind="secondary" onClick={onClose}>{finished ? 'Close' : 'Keep importing in the background'}</Button>
        {finished && summary && <Button onClick={() => onDone(summary.id)}>View imported leads</Button>}
      </div>
    );
  })();

  return (
    <Modal title="Import leads" onClose={onClose} footer={footer} size="lg" dirty={Boolean(draft) && step !== 'progress'}>
      <Stepper current={step} finished={summary?.status === 'completed'} />
      {error && (
        <div className="mt-4">
          <Notice error>{error}</Notice>
        </div>
      )}
      <div className="mt-5">
        {step === 'source' && (
          <SourceStep
            mode={mode}
            onMode={(next) => {
              setMode(next);
              setError(null);
            }}
            file={file}
            onFile={(next) => {
              setFile(next);
              setError(null);
            }}
            sheetUrl={sheetUrl}
            onSheetUrl={setSheetUrl}
            pasted={pasted}
            onPasted={setPasted}
          />
        )}
        {step === 'columns' && draft && settings && (
          <ColumnsStep
            draft={draft}
            sheets={sheets}
            settings={settings}
            sources={sources}
            campaigns={campaigns}
            busy={busy}
            onSettings={setSettings}
            onSheet={(sheet) => void upload(sheet)}
            onSourceCreated={(source) => {
              setSources((current) => [...current, source]);
              setSettings((current) => (current ? { ...current, leadSourceId: source.id } : current));
            }}
          />
        )}
        {step === 'review' && settings && (
          <ReviewStep
            preview={preview}
            loading={previewing}
            people={people}
            settings={settings}
            onAssigneeMapping={(mapping) => {
              const next = { ...settings, assigneeMapping: mapping };
              setSettings(next);
              void runPreview(next);
            }}
          />
        )}
        {step === 'progress' && summary && <ProgressStep summary={summary} busy={busy} onResume={() => void resume()} />}
      </div>
    </Modal>
  );
}

/* ==================================================================== *
 * Steps
 * ==================================================================== */

function Stepper({ current, finished }: { current: Step; finished: boolean }): React.JSX.Element {
  const index = finished ? STEPS.length : STEPS.findIndex((step) => step.id === current);
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="Import steps">
      {STEPS.map((step, position) => {
        const done = position < index;
        const active = position === index;
        return (
          <li key={step.id} className="min-w-0" aria-current={active ? 'step' : undefined}>
            <div className={`h-1.5 rounded-full ${done || active ? 'bg-app-accent' : 'bg-app-border'}`} />
            <p className={`mt-2 flex items-center gap-1.5 truncate text-xs font-bold ${active ? 'text-app-foreground' : 'text-app-muted'}`}>
              <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] ${done ? 'bg-app-accent text-white' : active ? 'border border-app-accent text-app-accent' : 'border border-app-border'}`}>
                {done ? <Icon name="check" className="size-3" /> : position + 1}
              </span>
              <span className="truncate">{step.label}</span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: ReadonlyArray<{ value: T; label: string; icon: string }>; onChange: (value: T) => void; label: string }): React.JSX.Element {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-3 gap-1.5 rounded-xl border border-app-border bg-app-surface p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition ${
            value === option.value ? 'ui-primary' : 'text-app-muted hover:bg-app-background hover:text-app-foreground'
          }`}
        >
          <Icon name={option.icon} className="size-4" />
          <span className="truncate">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function SourceStep({
  mode,
  onMode,
  file,
  onFile,
  sheetUrl,
  onSheetUrl,
  pasted,
  onPasted,
}: {
  mode: SourceMode;
  onMode: (mode: SourceMode) => void;
  file: File | null;
  onFile: (file: File | null) => void;
  sheetUrl: string;
  onSheetUrl: (value: string) => void;
  pasted: string;
  onPasted: (value: string) => void;
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function drop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  }

  function downloadTemplate(): void {
    const url = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lead-import-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <Segmented
        label="Where the leads are"
        value={mode}
        onChange={onMode}
        options={[
          { value: 'file', label: 'Upload a file', icon: 'upload' },
          { value: 'sheet', label: 'Google Sheets', icon: 'link' },
          { value: 'paste', label: 'Paste rows', icon: 'clipboard' },
        ]}
      />

      {mode === 'file' && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
          className={`grid place-items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
            dragging ? 'border-app-accent bg-app-accent/10' : 'border-app-border bg-app-surface-raised'
          }`}
        >
          <span className="grid size-12 place-items-center rounded-2xl bg-app-accent/10 text-app-accent">
            <Icon name={file ? 'file-text' : 'upload'} className="size-6" />
          </span>
          {file ? (
            <div>
              <p className="font-display text-base font-bold">{file.name}</p>
              <p className="mt-0.5 text-xs text-app-muted">{readableBytes(file.size)}</p>
            </div>
          ) : (
            <div>
              <p className="font-display text-base font-bold">Drop your lead list here</p>
              <p className="mt-0.5 text-xs text-app-muted">CSV, TSV or Excel (.xlsx), up to 10 MB and 10,000 rows</p>
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <Button kind="secondary" onClick={() => input.current?.click()}>{file ? 'Choose another file' : 'Browse files'}</Button>
            {file && <Button kind="secondary" onClick={() => onFile(null)}>Remove</Button>}
          </div>
          <input
            ref={input}
            type="file"
            accept={UPLOAD_ACCEPT}
            className="sr-only"
            aria-label="Lead list file"
            onChange={(event) => {
              onFile(event.target.files?.[0] ?? null);
              event.target.value = '';
            }}
          />
        </div>
      )}

      {mode === 'sheet' && (
        <div className="space-y-3">
          <Field label="Google Sheets link" value={sheetUrl} onChange={onSheetUrl} placeholder="https://docs.google.com/spreadsheets/d/…" />
          <Tip icon="link">
            In Google Sheets choose <strong>Share → General access → Anyone with the link</strong> (Viewer). Open the tab you want, then copy the link from the address bar.
          </Tip>
        </div>
      )}

      {mode === 'paste' && (
        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Rows copied from a spreadsheet</span>
          <textarea
            value={pasted}
            onChange={(event) => onPasted(event.target.value)}
            rows={9}
            placeholder={'Client Name\tBusiness Name\tNumber\tAssigned To\nAmit Shah\tShah Traders\t98765 43210\tRahul'}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 font-mono text-xs text-app-foreground"
          />
          <span className="mt-1.5 block font-normal">Select the cells in Excel or Google Sheets, header row included, copy and paste them here.</span>
        </label>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border p-3 text-xs text-app-muted">
        <span>
          Typical columns: <strong className="text-app-foreground">Client name, Business name, Owner name, Number, Assigned to</strong>. Old .xls files: save as .xlsx first.
        </span>
        <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1.5 font-bold text-app-accent hover:underline">
          <Icon name="download" className="size-3.5" /> Template
        </button>
      </div>
    </div>
  );
}

function Tip({ icon, children }: { icon: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex gap-3 rounded-xl border border-app-accent/30 bg-app-accent/10 p-3 text-xs text-app-foreground">
      <Icon name={icon} className="mt-0.5 size-4 shrink-0 text-app-accent" />
      <p>{children}</p>
    </div>
  );
}

function ColumnsStep({
  draft,
  sheets,
  settings,
  sources,
  campaigns,
  busy,
  onSettings,
  onSheet,
  onSourceCreated,
}: {
  draft: LeadImportDetail;
  sheets: string[];
  settings: ImportSettings;
  sources: LeadSource[];
  campaigns: Campaign[];
  busy: boolean;
  onSettings: (settings: ImportSettings) => void;
  onSheet: (sheet: string) => void;
  onSourceCreated: (source: LeadSource) => void;
}): React.JSX.Element {
  const [newSource, setNewSource] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const fieldOptions = useMemo(
    () => [{ value: '', label: 'Don’t import' }, ...draft.fields.map((option) => ({ value: option.field, label: option.label }))],
    [draft.fields],
  );
  const mapped = new Set(Object.values(settings.columnMapping));

  function setColumn(column: number, field: string): void {
    const next: Record<string, ImportField> = {};
    for (const [key, value] of Object.entries(settings.columnMapping)) {
      if (key === String(column)) continue;
      // A single-value field moves to the column just chosen.
      if (field && value === field && !MULTI_FIELDS.has(value)) continue;
      next[key] = value;
    }
    if (field) next[String(column)] = field as ImportField;
    onSettings({ ...settings, columnMapping: next });
  }

  async function createSource(): Promise<void> {
    if (!newSource?.trim()) return;
    setSourceError(null);
    try {
      const created = await createLeadSource({ name: newSource.trim(), direction: 'outbound' });
      onSourceCreated(created);
      setNewSource(null);
    } catch (cause) {
      setSourceError(errorText(cause, 'The source could not be created.'));
    }
  }

  const samples = (column: number): string[] =>
    draft.sampleRows
      .map((row) => (row[column] ?? '').trim())
      .filter(Boolean)
      .slice(0, 3);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Import name" value={settings.name} onChange={(name) => onSettings({ ...settings, name })} required />
        <div>
          {newSource === null ? (
            <Select
              label="Lead source"
              value={settings.leadSourceId ?? ''}
              placeholder="Where did this list come from?"
              onChange={(value) => {
                if (value === '__new') setNewSource('');
                else onSettings({ ...settings, leadSourceId: value || null });
              }}
              options={[
                ...sources.filter((source) => source.status === 'active').map((source) => ({ value: source.id, label: source.name })),
                { value: '__new', label: '+ New source…' },
              ]}
              required
            />
          ) : (
            <div>
              <Field label="New lead source" value={newSource} onChange={setNewSource} placeholder="e.g. Expo list, Purchased data" />
              <div className="mt-2 flex gap-2">
                <Button kind="secondary" onClick={() => setNewSource(null)}>Cancel</Button>
                <Button onClick={() => void createSource()} disabled={!newSource.trim()}>Create source</Button>
              </div>
              {sourceError && <p className="mt-1 text-xs text-app-danger">{sourceError}</p>}
            </div>
          )}
        </div>
        <Select
          label="Campaign"
          value={settings.campaignId ?? ''}
          placeholder="No campaign"
          onChange={(value) => onSettings({ ...settings, campaignId: value || null })}
          options={campaigns.filter((campaign) => campaign.status === 'active').map((campaign) => ({ value: campaign.id, label: campaign.name }))}
        />
        <Field
          label="Country code for numbers without one"
          value={settings.defaultCountryCode ? `+${settings.defaultCountryCode}` : ''}
          onChange={(value) => onSettings({ ...settings, defaultCountryCode: value.replace(/[^\d]/g, '').slice(0, 3) || null })}
          placeholder="+91"
          hint="98765 43210 becomes +91 98765 43210."
        />
        {sheets.length > 1 && (
          <Select
            label="Sheet"
            value={draft.sheetName ?? ''}
            onChange={(sheet) => {
              if (sheet && sheet !== draft.sheetName) onSheet(sheet);
            }}
            options={sheets.map((sheet) => ({ value: sheet, label: sheet }))}
            disabled={busy}
          />
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-app-border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-app-border bg-app-surface-raised px-4 py-3">
          <div>
            <p className="font-display text-sm font-bold">Match the columns</p>
            <p className="text-xs text-app-muted">{plural(draft.totalRows, 'row')} · {plural(draft.headers.length, 'column')}{draft.sheetName ? ` · sheet “${draft.sheetName}”` : ''}</p>
          </div>
          {!mapped.has('phone') && !mapped.has('email') && <span className="rounded-full border border-app-danger/30 bg-app-danger/10 px-2.5 py-1 text-[11px] font-bold text-app-danger">Match a phone or email column</span>}
        </div>
        <div className="max-h-[46vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-app-surface">
              <tr className="border-b border-app-border text-left text-[11px] font-bold uppercase tracking-wider text-app-muted">
                <th className="px-4 py-2.5">Column in your list</th>
                <th className="hidden px-4 py-2.5 sm:table-cell">Example values</th>
                <th className="w-56 px-4 py-2.5">Import as</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app-border">
              {draft.headers.map((header, column) => {
                const field = settings.columnMapping[String(column)] ?? '';
                const auto = field !== '' && draft.suggestedMapping[String(column)] === field;
                return (
                  <tr key={`${header}-${column}`}>
                    <td className="px-4 py-3 align-top">
                      <p className="font-semibold">{header}</p>
                      {auto && <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-app-success"><Icon name="sparkles" className="size-3" />Matched automatically</span>}
                    </td>
                    <td className="hidden px-4 py-3 align-top text-xs text-app-muted sm:table-cell">
                      {samples(column).length ? samples(column).map((value, index) => <span key={index} className="block truncate">{value}</span>) : <span className="italic">empty</span>}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <label className="sr-only" htmlFor={`import-column-${column}`}>Import “{header}” as</label>
                      <select
                        id={`import-column-${column}`}
                        value={field}
                        onChange={(event) => setColumn(column, event.target.value)}
                        className={`w-full rounded-lg border bg-app-background px-3 py-2 text-sm ${field ? 'border-app-accent/50 font-semibold' : 'border-app-border text-app-muted'}`}
                      >
                        {fieldOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                            {option.value && option.value !== field && mapped.has(option.value as ImportField) && !MULTI_FIELDS.has(option.value as ImportField) ? ' (in use)' : ''}
                          </option>
                        ))}
                      </select>
                      {field === 'assignedTo' && <p className="mt-1 text-[11px] text-app-muted">Names or emails of salespeople</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-[var(--theme-primary)]"
          checked={settings.extraColumnsToNotes}
          onChange={(event) => onSettings({ ...settings, extraColumnsToNotes: event.target.checked })}
        />
        <span>
          <span className="font-semibold">Keep the other columns in the lead’s notes</span>
          <span className="block text-xs text-app-muted">Columns set to “Don’t import” are added as “Column: value” lines, so nothing in the sheet is lost.</span>
        </span>
      </label>
    </div>
  );
}

function ReviewStep({
  preview,
  loading,
  people,
  settings,
  onAssigneeMapping,
}: {
  preview: ImportPreview | null;
  loading: boolean;
  people: AssigneeOption[];
  settings: ImportSettings;
  onAssigneeMapping: (mapping: Record<string, string | null>) => void;
}): React.JSX.Element {
  const [problemsOnly, setProblemsOnly] = useState(false);
  if (!preview) {
    return (
      <div className="space-y-4" role="status" aria-label="Checking the list">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24 rounded-2xl" />)}
        </div>
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }
  const needsFixing = preview.missingContact + preview.invalidPhone + preview.ambiguousPhone + preview.invalidEmail;
  const rows = problemsOnly ? preview.problemRows : preview.rows;
  const personOptions = [
    { value: '__none', label: 'Leave unassigned' },
    ...people.map((person) => ({ value: person.id, label: person.teamName ? `${person.fullName} · ${person.teamName}` : person.fullName })),
  ];

  return (
    <div className={`space-y-5 transition ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryTile label="New leads" value={preview.ready} hint={preview.willBeAssigned ? `${preview.willBeAssigned.toLocaleString()} get an owner from the sheet` : 'Ready to import'} icon="user-plus" tone="success" />
        <SummaryTile label="Already in CRM" value={preview.alreadyInCrm} hint="Kept on their current lead" icon="users" tone="accent" />
        <SummaryTile label="Repeated in file" value={preview.duplicateInFile} hint="Same phone or email twice" icon="copy" tone="accent" />
        <SummaryTile label="Need fixing" value={needsFixing} hint="No usable phone or email" icon="alert-circle" tone={needsFixing ? 'danger' : 'default'} />
      </div>

      {preview.assigneeColumn && preview.assignees.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-app-border">
          <div className="border-b border-app-border bg-app-surface-raised px-4 py-3">
            <p className="font-display text-sm font-bold">Assigned to</p>
            <p className="text-xs text-app-muted">Who each name in the sheet is. Leads go to them as soon as the import finishes.</p>
          </div>
          <ul className="divide-y divide-app-border">
            {preview.assignees.map((entry) => (
              <li key={entry.key} className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_16rem] [&_label>span:first-child]:sr-only">
                <div className="min-w-0">
                  <p className="truncate font-semibold">“{entry.value}”</p>
                  <p className="text-xs text-app-muted">
                    {plural(entry.rows, 'lead')} ·{' '}
                    {entry.match === 'auto' ? <span className="text-app-success">matched automatically</span> : entry.match === 'manual' ? 'chosen by you' : <span className="text-app-danger">no match — stays unassigned</span>}
                  </p>
                </div>
                <SearchableSelect
                  label={`Employee for “${entry.value}”`}
                  value={entry.employeeId ?? (Object.prototype.hasOwnProperty.call(settings.assigneeMapping, entry.key) ? '__none' : '')}
                  placeholder="Pick a salesperson…"
                  options={personOptions}
                  onChange={(value) => onAssigneeMapping({ ...settings.assigneeMapping, [entry.key]: value && value !== '__none' ? value : null })}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-app-border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-app-border bg-app-surface-raised px-4 py-3">
          <p className="font-display text-sm font-bold">{problemsOnly ? 'Rows that will not become new leads' : preview.rows.length >= preview.total ? `All ${plural(preview.total, 'row')}` : `First ${preview.rows.length} of ${plural(preview.total, 'row')}`}</p>
          <label className="flex items-center gap-2 text-xs font-semibold text-app-muted">
            <input type="checkbox" className="size-4 accent-[var(--theme-primary)]" checked={problemsOnly} onChange={(event) => setProblemsOnly(event.target.checked)} />
            Only rows with a problem ({(preview.total - preview.ready).toLocaleString()})
          </label>
        </div>
        <div className="max-h-[38vh] overflow-auto">
          <PreviewTable rows={rows} />
        </div>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, hint, icon, tone }: { label: string; value: number; hint: string; icon: string; tone: 'success' | 'accent' | 'danger' | 'default' }): React.JSX.Element {
  const tones = {
    success: 'bg-app-success/10 text-app-success',
    accent: 'bg-app-accent/10 text-app-accent',
    danger: 'bg-app-danger/10 text-app-danger',
    default: 'bg-app-surface-raised text-app-muted',
  };
  return (
    <div className="ui-card flex min-h-[112px] flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-bold uppercase leading-4 tracking-[0.12em] text-app-muted">{label}</p>
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${tones[tone]}`}>
          <Icon name={icon} className="size-4" />
        </span>
      </div>
      <p className="mt-auto pt-2 text-2xl font-bold tabular-nums">{value.toLocaleString()}</p>
      <p className="text-xs leading-snug text-app-muted">{hint}</p>
    </div>
  );
}

function PreviewTable({ rows }: { rows: readonly PreviewRow[] }): React.JSX.Element {
  if (rows.length === 0) return <p className="px-4 py-8 text-center text-sm text-app-muted">Nothing to show here.</p>;
  return (
    <table className="w-full min-w-[640px] text-sm">
      <thead className="sticky top-0 bg-app-surface">
        <tr className="border-b border-app-border text-left text-[11px] font-bold uppercase tracking-wider text-app-muted">
          <th className="px-4 py-2.5">Row</th>
          <th className="px-4 py-2.5">Client</th>
          <th className="px-4 py-2.5">Phone / email</th>
          <th className="px-4 py-2.5">Goes to</th>
          <th className="px-4 py-2.5">Result</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-app-border">
        {rows.map((row) => (
          <tr key={row.rowNumber}>
            <td className="px-4 py-2.5 tabular-nums text-app-muted">{row.rowNumber}</td>
            <td className="px-4 py-2.5">
              <p className="font-semibold">{row.contactName ?? '—'}</p>
              {row.companyName && <p className="text-xs text-app-muted">{row.companyName}</p>}
            </td>
            <td className="px-4 py-2.5 text-xs">
              <span className="block whitespace-nowrap">{row.phone ? (row.phone.startsWith('+') ? formatPhone(row.phone) : row.phone) : '—'}</span>
              {row.email && <span className="block text-app-muted">{row.email}</span>}
            </td>
            <td className="px-4 py-2.5 text-xs">
              {row.status === 'already_in_crm' ? (
                <span className="text-app-muted">Stays with {row.existingOwnerName ?? 'its owner'}</span>
              ) : row.status !== 'ready' ? (
                <span className="text-app-muted">—</span>
              ) : (
                (row.assigneeName ?? (row.assignedTo ? <span className="text-app-danger">“{row.assignedTo}” — no match</span> : <span className="text-app-muted">Unassigned</span>))
              )}
            </td>
            <td className="px-4 py-2.5">
              <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${previewStatusTone(row.status)}`}>{PREVIEW_STATUS_LABELS[row.status]}</span>
              {row.existingLeadNumber && <p className="mt-1 text-[11px] text-app-muted">Lead #{row.existingLeadNumber}{row.existingOwnerName ? ` · ${row.existingOwnerName}` : ''}</p>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProgressStep({ summary, busy, onResume }: { summary: LeadImportSummary; busy: boolean; onResume: () => void }): React.JSX.Element {
  const percent = importProgress(summary.processedRows, summary.totalRows);
  const finished = summary.status === 'completed';
  const failed = summary.status === 'failed';
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <span className={`grid size-14 shrink-0 place-items-center rounded-2xl ${finished ? 'bg-app-success/10 text-app-success' : failed ? 'bg-app-danger/10 text-app-danger' : 'bg-app-accent/10 text-app-accent'}`}>
          <Icon name={finished ? 'check' : failed ? 'alert-circle' : 'refresh'} className={`size-7 ${!finished && !failed ? 'animate-spin' : ''}`} />
        </span>
        <div className="min-w-0">
          <p className="font-display text-lg font-bold">{finished ? `${plural(summary.createdCount, 'lead')} imported` : failed ? 'The import stopped' : 'Importing your leads…'}</p>
          <p className="text-sm text-app-muted">
            {finished
              ? summary.assignedCount
                ? `${summary.assignedCount.toLocaleString()} assigned from the sheet · ${summary.unassignedCount.toLocaleString()} waiting for an owner`
                : 'Assign them to your sales team from the Imported leads view.'
              : failed
                ? (summary.lastError ?? 'Something went wrong part-way.')
                : 'You can close this window; the import carries on.'}
          </p>
        </div>
      </div>

      <div>
        <div className="mb-2 flex justify-between text-xs font-semibold text-app-muted">
          <span>{summary.processedRows.toLocaleString()} of {summary.totalRows.toLocaleString()} rows</span>
          <span className="tabular-nums">{percent}%</span>
        </div>
        <div role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2.5 overflow-hidden rounded-full bg-app-border">
          <div className={`h-full rounded-full transition-all ${failed ? 'bg-app-danger' : 'bg-app-accent'}`} style={{ width: `${percent}%` }} />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['New leads', summary.createdCount],
          ['Already in CRM', summary.existingCount],
          ['Repeated in file', summary.duplicateCount],
          ['Not imported', summary.invalidCount + summary.failedCount],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-app-border p-3">
            <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-app-muted">{label}</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums">{Number(value).toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      {failed && (
        <Button onClick={onResume} disabled={busy}>
          {busy ? 'Resuming…' : 'Resume the import'}
        </Button>
      )}
    </div>
  );
}
