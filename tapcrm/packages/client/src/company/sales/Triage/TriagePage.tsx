import { useEffect, useState } from 'react';
import { Button, Card, Field, Icon, Modal, Page, Select } from '../../../ui/index.js';
import {
  closeTriageLead,
  getHandoverTargets,
  listTriage,
  rescueFromTriage,
  returnTriageToPool,
  type HandoverTarget,
  type TriageRow,
} from '../leads/api.js';
import { formatAge, labelForReason } from './triage-helpers.js';
import { ErrorToast } from '../../../ui/ErrorToast.js';
import { useCompanyPageMetadata } from '../../layout/CompanyNavbarContext.js';
import { LeadsViewTabs } from '../leads/imports/LeadsViewTabs.js';
import './triage.css';

type Dialog =
  | { kind: 'none' }
  | { kind: 'rescue'; row: TriageRow }
  | { kind: 'close'; row: TriageRow };

const POLL_INTERVAL_MS = 20_000;
const pageMetadata = {
  eyebrow: 'Sales',
  title: 'Needs Review',
  description: 'Review unassigned enquiries, assign an owner, or return them to the live pool.',
  lockTitle: true,
};

export function TriagePage({ canViewLeads, canViewImports, canViewCallbacks, onNavigate }: {
  canViewLeads: boolean;
  canViewImports: boolean;
  canViewCallbacks: boolean;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  useCompanyPageMetadata(pageMetadata);
  const [rows, setRows] = useState<TriageRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [reviewReason, setReviewReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });

  const reload = async (): Promise<void> => {
    try {
      const result = await listTriage();
      setRows(result.items);
      setError(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the triage queue.');
    }
  };

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  async function onReturn(leadId: string): Promise<void> {
    try {
      await returnTriageToPool(leadId);
      await reload();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Return-to-pool failed.');
    }
  }

  const query = search.trim().toLowerCase();
  const reasons = [...new Set((rows ?? []).map((row) => labelForReason(row.reason)))].sort();
  const reasonOptions = [...new Set([...reasons, ...(reviewReason ? [reviewReason] : [])])];
  const shown = (rows ?? []).filter((row) => (
    (!reviewReason || labelForReason(row.reason) === reviewReason) &&
    [row.contactName, `#${row.leadNumber}`, row.sourceName, row.service, row.location].some((value) => value?.toLowerCase().includes(query))
  ));
  const filtering = Boolean(query || reviewReason);

  return (
    <Page
      eyebrow={pageMetadata.eyebrow}
      title={pageMetadata.title}
      description={pageMetadata.description}
      hideMobileAction
      action={
        <Button kind="secondary" onClick={() => void reload()}>
          <Icon name="refresh" className="size-4" /> Refresh
        </Button>
      }
    >
      <LeadsViewTabs active="review" count={rows?.length} canViewLeads={canViewLeads} canViewImports={canViewImports} canViewCallbacks={canViewCallbacks} onNavigate={onNavigate} />
      {error && <ErrorToast message={error} />}

      <Card className="bid-pool-filter-card">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-48 flex-1">
            <Field label="Search leads needing review" value={search} onChange={setSearch} placeholder="Search by name, lead ID, source, or location…" />
          </div>
          <div className="w-full sm:w-64">
            <Select label="Review reason" value={reviewReason} onChange={setReviewReason} placeholder="All reasons" options={reasonOptions.map((reason) => ({ value: reason, label: reason }))} />
          </div>
          {rows && <p className="ml-auto pb-2 text-sm text-app-muted" aria-live="polite">{shown.length} {shown.length === 1 ? 'record' : 'records'}</p>}
        </div>
      </Card>

      {!rows && !error && <Card><p role="status" className="text-sm text-app-muted">Loading leads for review…</p></Card>}
      {rows && shown.length === 0 && (
        <Card className="bid-pool-empty">
          <span className="sales-work-icon"><Icon name="inbox" className="size-5" /></span>
          <div>
            <h2 className="font-display text-xl font-bold">{filtering ? 'No leads match these filters' : 'No leads need review'}</h2>
            <p className="mt-1 text-sm text-app-muted">{filtering ? 'Try a different search or review reason.' : 'Unassigned enquiries that need a decision will appear here.'}</p>
            {filtering && <Button className="mt-3" kind="secondary" onClick={() => { setSearch(''); setReviewReason(''); }}>Clear filters</Button>}
          </div>
        </Card>
      )}
      {shown.length > 0 && (
        <Card className="bid-pool-table-card overflow-hidden">
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Leads needing review">
            <table className="sales-queue-table sales-review-table">
              <thead>
                <tr>
                  <th scope="col">Lead &amp; enquiry</th>
                  <th scope="col">Source</th>
                  <th scope="col">Review reason</th>
                  <th scope="col">Age</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.leadId}>
                    <th scope="row">
                      <div className="flex items-center gap-3">
                        <span className="sales-queue-id">#{row.leadNumber}</span>
                        <div className="min-w-0">
                          <button type="button" className="text-left font-semibold hover:text-app-accent hover:underline" onClick={() => onNavigate(`/company/sales/leads/${row.leadId}`)}>
                            {row.contactName}
                          </button>
                          {(row.service || row.location) && <p className="mt-1 text-sm font-normal text-app-muted">{[row.service, row.location].filter(Boolean).join(' · ')}</p>}
                        </div>
                      </div>
                    </th>
                    <td><span className="sales-queue-chip">{row.sourceName}</span></td>
                    <td><span className="sales-queue-state">{labelForReason(row.reason)}</span></td>
                    <td className="font-mono font-semibold tabular-nums">{formatAge(row.ageSeconds)}</td>
                    <td>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button onClick={() => setDialog({ kind: 'rescue', row })}>Assign</Button>
                        <Button kind="secondary" onClick={() => void onReturn(row.leadId)}>Return to pool</Button>
                        <Button kind="danger" onClick={() => setDialog({ kind: 'close', row })}>Close</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {dialog.kind === 'rescue' && (
        <RescueDialog
          row={dialog.row}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={async () => {
            setDialog({ kind: 'none' });
            await reload();
          }}
        />
      )}
      {dialog.kind === 'close' && (
        <CloseDialog
          row={dialog.row}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={async () => {
            setDialog({ kind: 'none' });
            await reload();
          }}
        />
      )}
    </Page>
  );
}

function RescueDialog({
  row,
  onClose,
  onDone,
}: {
  row: TriageRow;
  onClose: () => void;
  onDone: () => Promise<void>;
}): React.JSX.Element {
  const [targets, setTargets] = useState<HandoverTarget[]>([]);
  const [newOwnerId, setNewOwnerId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getHandoverTargets(row.leadId).then(setTargets).catch(() => setTargets([]));
  }, [row.leadId]);
  const canSubmit = !submitting && newOwnerId.length > 0 && reason.trim().length >= 5;
  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await rescueFromTriage(row.leadId, { newOwnerId, reason: reason.trim() });
      await onDone();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Rescue failed.');
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <ActionDialog title={`Assign lead #${row.leadNumber}`} onClose={onClose} submitting={submitting} canSubmit={canSubmit} submitLabel="Assign lead" onSubmit={() => void submit()} error={error}>
      <label className="text-xs font-semibold text-app-muted">
        <span className="mb-2 block">New owner</span>
        <select
          value={newOwnerId}
          onChange={(event) => setNewOwnerId(event.target.value)}
          className="ui-form-control w-full px-3 py-2.5 text-sm"
        >
          <option value="">Pick an eligible agent</option>
          {targets.map((target) => (
            <option key={target.id} value={target.id} disabled={!target.selectable}>
              {target.fullName} · {target.availability.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-4">
        <Field label="Reason" value={reason} onChange={setReason} required placeholder="Why this agent, at least 5 characters" />
      </div>
    </ActionDialog>
  );
}

function CloseDialog({
  row,
  onClose,
  onDone,
}: {
  row: TriageRow;
  onClose: () => void;
  onDone: () => Promise<void>;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [lossReason, setLossReason] = useState<'not_interested' | 'no_budget' | 'unqualified' | 'duplicate' | 'other'>('unqualified');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = !submitting && reason.trim().length >= 5;
  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await closeTriageLead(row.leadId, { reason: reason.trim(), lossReason });
      await onDone();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Close failed.');
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <ActionDialog title={`Close #${row.leadNumber}`} onClose={onClose} submitting={submitting} canSubmit={canSubmit} submitLabel="Close lead" onSubmit={() => void submit()} error={error}>
      <label className="text-xs font-semibold text-app-muted">
        <span className="mb-2 block">Loss reason</span>
        <select
          value={lossReason}
          onChange={(event) => setLossReason(event.target.value as typeof lossReason)}
          className="ui-form-control w-full px-3 py-2.5 text-sm"
        >
          <option value="unqualified">Unqualified</option>
          <option value="not_interested">Not interested</option>
          <option value="no_budget">No budget</option>
          <option value="duplicate">Duplicate</option>
          <option value="other">Other</option>
        </select>
      </label>
      <div className="mt-4">
        <Field label="Reason" value={reason} onChange={setReason} required placeholder="Explain the close in the audit trail" />
      </div>
    </ActionDialog>
  );
}

function ActionDialog({
  title,
  onClose,
  submitting,
  canSubmit,
  submitLabel,
  onSubmit,
  error,
  children,
}: {
  title: string;
  onClose: () => void;
  submitting: boolean;
  canSubmit: boolean;
  submitLabel: string;
  onSubmit: () => void;
  error: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Modal
      title={title}
      onClose={() => { if (!submitting) onClose(); }}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button kind="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button disabled={!canSubmit} onClick={onSubmit}>{submitting ? 'Working…' : submitLabel}</Button>
        </div>
      }
    >
      {children}
      {error && <ErrorToast message={error} />}
    </Modal>
  );
}
