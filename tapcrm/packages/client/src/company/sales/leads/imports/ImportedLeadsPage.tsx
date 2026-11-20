import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Field, Icon, Modal, Notice, Page, SearchableSelect, Select, Skeleton } from '../../../../ui/index.js';
import { formatPhone, timeAgo } from '../../calls/calls-format.js';
import { getCampaigns, getLeadSources, type Campaign, type LeadSource } from '../api.js';
import { leadStatusLabel } from '../lead-status.js';
import {
  assignLeads,
  getImport,
  listAssignees,
  listImportedLeads,
  listImportRows,
  listImports,
  resumeImport,
  type AssigneeOption,
  type AssignResult,
  type ImportedLeadItem,
  type ImportedLeadsFilter,
  type ImportedLeadsPage as ImportedPage,
  type ImportRowView,
  type LeadCallStatus,
  type LeadImportSummary,
} from './api.js';
import { ImportLeadsWizard } from './ImportLeadsWizard.js';
import {
  ASSIGNED_LEAD_CALLS_PATH,
  CALL_STATUS_LABELS,
  callStatusIcon,
  callStatusTone,
  IMPORT_STATUS_LABELS,
  importProgress,
  importStatusTone,
  plural,
  ROW_STATUS_LABELS,
  rowStatusTone,
  SOURCE_KIND_LABELS,
  sourceKindIcon,
  splitCounts,
} from './import-format.js';
import { LeadsViewTabs } from './LeadsViewTabs.js';
import { ErrorToast } from '../../../../ui/ErrorToast.js';
import { useCompanyPageMetadata } from '../../../layout/CompanyNavbarContext.js';
import './imported-leads.css';

const PAGE_SIZE = 50;
const pageMetadata = {
  eyebrow: 'Sales · Leads',
  title: 'Imported Leads',
  description: 'Find leads brought in from files and spreadsheets, review their assignments, and hand them to your sales team.',
  lockTitle: true,
};

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/**
 * Leads that came from imported lists, ready to hand to the Sales team.
 * Select some (or every lead matching the filters) and assign them to one
 * person or split them evenly across several.
 */
export function ImportedLeadsPage({
  canViewLeads = true,
  canViewCallbacks = false,
  canReviewTriage = false,
  canManage,
  canTrackCalls,
  initialImportId,
  onNavigate,
}: {
  canViewLeads?: boolean;
  canViewCallbacks?: boolean;
  canReviewTriage?: boolean;
  canManage: boolean;
  /** Call Analytics is on: show whether assignees called. */
  canTrackCalls: boolean;
  initialImportId: string | null;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  useCompanyPageMetadata(pageMetadata);
  const queueTop = useRef<HTMLDivElement>(null);
  const queueRequest = useRef(0);
  const [imports, setImports] = useState<LeadImportSummary[] | null>(null);
  const [importId, setImportId] = useState(initialImportId ?? '');
  const [assignment, setAssignment] = useState<'all' | 'unassigned' | 'assigned'>('all');
  const [ownerId, setOwnerId] = useState('');
  const [callStatus, setCallStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<ImportedPage | null>(null);
  const [items, setItems] = useState<ImportedLeadItem[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [assignmentSelection, setAssignmentSelection] = useState<{
    count: number;
    hasOwners: boolean;
    target: { filter: ImportedLeadsFilter } | { leadIds: string[] };
  } | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [reportFor, setReportFor] = useState<LeadImportSummary | null>(null);
  const [people, setPeople] = useState<AssigneeOption[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [showAllImports, setShowAllImports] = useState(false);

  const filter = useMemo<ImportedLeadsFilter>(
    () => ({
      importId: importId || undefined,
      assignment,
      ownerId: ownerId || undefined,
      callStatus: (callStatus || undefined) as LeadCallStatus | undefined,
      search: search || undefined,
    }),
    [importId, assignment, ownerId, callStatus, search],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadImports = useCallback(async () => {
    try {
      setImports((await listImports()).items.filter((item) => item.status !== 'draft'));
    } catch (cause) {
      setError(errorText(cause, 'Unable to load imports.'));
      setImports([]);
    }
  }, []);

  const load = useCallback(async () => {
    const request = ++queueRequest.current;
    setLoading(true);
    setLoadingMore(false);
    setSelected(new Set());
    setAllMatching(false);
    try {
      const next = await listImportedLeads({ ...filter, page: 1, pageSize: PAGE_SIZE });
      if (request !== queueRequest.current) return;
      setData(next);
      setItems(next.items);
      setPage(1);
      setError(null);
    } catch (cause) {
      if (request !== queueRequest.current) return;
      setData(null);
      setItems([]);
      setError(errorText(cause, 'Unable to load imported leads.'));
    } finally {
      if (request === queueRequest.current) setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadImports();
    if (canManage) {
      listAssignees()
        .then((result) => setPeople(result.items))
        .catch(() => setPeople([]));
      Promise.all([getLeadSources(), getCampaigns()])
        .then(([nextSources, nextCampaigns]) => {
          setSources(nextSources);
          setCampaigns(nextCampaigns);
        })
        .catch(() => undefined);
    }
  }, [canManage, loadImports]);

  // While an import is running, refresh its card and the list.
  const running = (imports ?? []).some((item) => item.status === 'queued' || item.status === 'importing');
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      void loadImports();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [running, loadImports]);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) void load();
    wasRunning.current = running;
  }, [running, load]);

  async function loadMore(): Promise<void> {
    const request = queueRequest.current;
    setLoadingMore(true);
    try {
      const next = await listImportedLeads({ ...filter, page: page + 1, pageSize: PAGE_SIZE });
      if (request !== queueRequest.current) return;
      setItems((current) => [...current, ...next.items]);
      setPage(next.page);
    } catch (cause) {
      if (request === queueRequest.current) setError(errorText(cause, 'Unable to load more leads.'));
    } finally {
      if (request === queueRequest.current) setLoadingMore(false);
    }
  }

  function toggle(leadId: string): void {
    setAllMatching(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }

  const allShownSelected = items.length > 0 && (allMatching || items.every((item) => selected.has(item.leadId)));
  function toggleAllShown(): void {
    setAllMatching(false);
    setSelected(allShownSelected ? new Set() : new Set(items.map((item) => item.leadId)));
  }

  const total = data?.total ?? 0;
  const filtersPending = loading || searchInput.trim() !== search;
  const filtering = Boolean(importId || searchInput.trim() || ownerId || callStatus || assignment !== 'all');

  function clearFilters(): void {
    setImportId('');
    setSearchInput('');
    setSearch('');
    setOwnerId('');
    setCallStatus('');
    setAssignment('all');
  }
  const selectionCount = allMatching ? total : selected.size;
  const selectedItems = items.filter((item) => selected.has(item.leadId));
  const selectionHasOwners = allMatching ? assignment !== 'unassigned' && (data?.counts.assigned ?? 0) > 0 : selectedItems.some((item) => item.ownerId);
  const callTracking = canTrackCalls && Boolean(data?.callTracking);
  const visibleImports = showAllImports ? (imports ?? []) : (imports ?? []).slice(0, 6);
  const activeImport = imports?.find((item) => item.id === importId) ?? null;

  return (
    <Page
      eyebrow={pageMetadata.eyebrow}
      title={pageMetadata.title}
      description={pageMetadata.description}
      hideMobileAction
      action={
        <div className="flex flex-wrap gap-2">
          {callTracking && (
            <Button kind="secondary" onClick={() => onNavigate(ASSIGNED_LEAD_CALLS_PATH)}>
              <Icon name="phone" className="size-4" /> Call tracking
            </Button>
          )}
          <Button kind="secondary" onClick={() => void Promise.all([load(), loadImports()])} disabled={loading}>
            <Icon name="refresh" className="size-4" /> Refresh
          </Button>
          {canManage && (
            <Button onClick={() => setWizardOpen(true)}>
              <Icon name="upload" className="size-4" /> Import leads
            </Button>
          )}
        </div>
      }
    >
      <LeadsViewTabs active="imported" count={filtering || loading ? undefined : data?.counts.all} canViewImports canViewLeads={canViewLeads} canViewCallbacks={canViewCallbacks} canReviewTriage={canReviewTriage} onNavigate={onNavigate} />
      {error && <ErrorToast message={error} />}
      {message && <Notice>{message}</Notice>}

      <div ref={queueTop} tabIndex={-1} className="scroll-mt-6" aria-label="Imported lead filters">
        <Card className="bid-pool-filter-card">
          <div className="imported-leads-filters">
            <div className="imported-leads-search">
              <Field label="Search imported leads" value={searchInput} onChange={setSearchInput} placeholder="Search by name, business, phone, or owner…" />
            </div>
            <Select
              label="Import"
              value={importId}
              placeholder="All imports"
              onChange={setImportId}
              options={(imports ?? []).map((item) => ({ value: item.id, label: item.name }))}
            />
            <SearchableSelect
              label="Sales owner"
              value={ownerId}
              placeholder="All owners"
              onChange={setOwnerId}
              options={[{ value: '', label: 'All owners' }, ...people.map((person) => ({ value: person.id, label: person.fullName }))]}
            />
            {callTracking && (
              <Select
                label="Calls"
                value={callStatus}
                placeholder="Any call status"
                onChange={setCallStatus}
                options={(Object.keys(CALL_STATUS_LABELS) as LeadCallStatus[]).map((status) => ({ value: status, label: CALL_STATUS_LABELS[status] }))}
              />
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-app-border pt-3">
            <button type="button" className="inline-flex items-center gap-2 text-sm font-semibold text-app-accent hover:underline" onClick={() => document.getElementById('import-history-title')?.focus()}>
              <Icon name="clock" className="size-4" /> View import history
            </button>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {filtering && <button type="button" className="font-semibold text-app-accent hover:underline" onClick={clearFilters}>Clear filters</button>}
              <p aria-live="polite" className="text-app-muted">{filtersPending ? 'Updating records…' : data ? plural(total, 'record') : 'Records unavailable'}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="bid-pool-table-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-border p-4">
          <div role="group" aria-label="Assignment" className="flex flex-wrap gap-1.5 rounded-xl border border-app-border bg-app-surface p-1">
            {(
              [
                ['all', 'All', data?.counts.all],
                ['unassigned', 'Unassigned', data?.counts.unassigned],
                ['assigned', 'Assigned', data?.counts.assigned],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={assignment === value}
                onClick={() => setAssignment(value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${assignment === value ? 'ui-primary' : 'text-app-muted hover:bg-app-background hover:text-app-foreground'}`}
              >
                {label}
                {count !== undefined && <span className="ml-1.5 tabular-nums opacity-75">{count.toLocaleString()}</span>}
              </button>
            ))}
          </div>
          {activeImport && (
            <p className="text-xs text-app-muted">
              Showing <strong className="text-app-foreground">{activeImport.name}</strong> ·{' '}
              <button type="button" className="font-bold text-app-accent hover:underline" onClick={() => setImportId('')}>show every import</button>
            </p>
          )}
        </div>

        {canManage && !filtersPending && selectionCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-border bg-app-accent/10 px-4 py-3" role="region" aria-label="Selected leads">
            <p className="text-sm">
              <strong>{plural(selectionCount, 'lead')}</strong> selected
              {!allMatching && allShownSelected && total > items.length && (
                <>
                  {' · '}
                  <button type="button" className="font-bold text-app-accent hover:underline" onClick={() => setAllMatching(true)}>
                    Select all {total.toLocaleString()} matching
                  </button>
                </>
              )}
              {' · '}
              <button
                type="button"
                className="font-bold text-app-accent hover:underline"
                onClick={() => {
                  setSelected(new Set());
                  setAllMatching(false);
                }}
              >
                Clear
              </button>
            </p>
            <Button onClick={() => setAssignmentSelection({
              count: selectionCount,
              hasOwners: selectionHasOwners,
              target: allMatching ? { filter } : { leadIds: [...selected] },
            })}>
              <Icon name="user-plus" className="size-4" /> Assign…
            </Button>
          </div>
        )}

        {loading ? (
          <div className="divide-y divide-app-border" role="status" aria-label="Loading imported leads">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="size-4 rounded" />
                <div className="flex-1">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="mt-2 h-3 w-1/4" />
                </div>
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-start gap-4 p-6">
            <span className="sales-work-icon"><Icon name="users" className="size-5" /></span>
            <div>
              <h2 className="font-display text-lg font-bold">{data ? (filtering ? 'No leads match these filters' : 'No imported leads yet') : 'Imported leads unavailable'}</h2>
              {data && <p className="mt-1 text-sm text-app-muted">{filtering ? 'Change the search or clear the filters to see more leads.' : 'Newly imported leads will appear here.'}</p>}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Imported leads table">
            <table className="sales-queue-table imported-leads-table">
              <thead>
                <tr>
                  {canManage && (
                    <th scope="col" className="imported-leads-checkbox">
                      <input type="checkbox" aria-label="Select every lead shown" className="size-4 accent-[var(--theme-primary)]" checked={allShownSelected} onChange={toggleAllShown} disabled={filtersPending} />
                    </th>
                  )}
                  <th scope="col">Lead &amp; company</th>
                  <th scope="col">Sales owner</th>
                  <th scope="col">Stage &amp; status</th>
                  {callTracking && <th scope="col">Calls</th>}
                  <th scope="col">Import</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {items.map((item) => (
                  <tr
                    key={item.leadId}
                    className="cursor-pointer"
                    data-selected={selected.has(item.leadId) || allMatching}
                    onClick={() => onNavigate(`/company/sales/leads/${item.leadId}`)}
                  >
                    {canManage && (
                      <td className="imported-leads-checkbox" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.contactName}`}
                          className="size-4 accent-[var(--theme-primary)]"
                          checked={allMatching || selected.has(item.leadId)}
                          onChange={() => toggle(item.leadId)}
                          disabled={filtersPending}
                        />
                      </td>
                    )}
                    <th scope="row" className="imported-leads-name">
                      <div className="flex items-center gap-3">
                        <span className="sales-queue-id">#{item.leadNumber}</span>
                        <div className="min-w-0">
                          <button type="button" className="break-words text-left font-semibold hover:text-app-accent hover:underline" onClick={(event) => {
                            event.stopPropagation();
                            onNavigate(`/company/sales/leads/${item.leadId}`);
                          }}>{item.contactName}</button>
                          {item.companyName && <p className="mt-0.5 break-words text-sm font-normal text-app-muted">{item.companyName}</p>}
                          {(item.phone || item.email) && <p className="mt-0.5 break-all text-xs font-normal text-app-muted">{item.phone ? formatPhone(item.phone) : item.email}</p>}
                        </div>
                      </div>
                    </th>
                    <td>
                      {item.ownerName ? (
                        <>
                          <p className="font-semibold">{item.ownerName}</p>
                          <p className="text-xs text-app-muted">
                            {item.assignedAt ? timeAgo(item.assignedAt) : ''}
                            {item.assignedVia === 'sheet' ? ' · from the sheet' : item.assignedByName ? ` · by ${item.assignedByName}` : ''}
                          </p>
                        </>
                      ) : (
                        <span className="inline-flex rounded-full border border-app-border bg-app-surface-raised px-2.5 py-0.5 text-[11px] font-bold text-app-muted">Unassigned</span>
                      )}
                    </td>
                    <td>
                      <span className="sales-queue-state">{leadStatusLabel(item.leadStatus)}</span>
                    </td>
                    {callTracking && (
                      <td>
                        {item.callStatus ? (
                          <>
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${callStatusTone(item.callStatus)}`}>
                              <Icon name={callStatusIcon(item.callStatus)} className="size-3" />
                              {CALL_STATUS_LABELS[item.callStatus]}
                            </span>
                            {item.lastCallAt && <p className="mt-1 text-xs text-app-muted">{plural(item.callAttempts, 'try', 'tries')} · last {timeAgo(item.lastCallAt)}</p>}
                          </>
                        ) : (
                          <span className="text-xs text-app-muted">—</span>
                        )}
                      </td>
                    )}
                    <td>
                      <p className="max-w-[14rem] break-words text-sm font-semibold">{item.importName}</p>
                      <p className="text-xs text-app-muted">Row {item.rowNumber}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && items.length < total && (
          <div className="border-t border-app-border p-4 text-center">
            <Button kind="secondary" onClick={() => void loadMore()} disabled={loadingMore || filtersPending}>
              {loadingMore ? 'Loading…' : `Show more (${(total - items.length).toLocaleString()} left)`}
            </Button>
          </div>
        )}
      </Card>

      <section aria-labelledby="import-history-title">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="import-history-title" tabIndex={-1} className="scroll-mt-6 font-display text-xl font-bold tracking-tight">Import history</h2>
          {imports && <span className="text-sm text-app-muted">{plural(imports.length, 'import')}</span>}
        </div>
        {imports === null ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-36 rounded-2xl" />)}
          </div>
        ) : imports.length === 0 ? (
          <Card className="bid-pool-empty flex-wrap">
            <span className="sales-work-icon"><Icon name="upload" className="size-5" /></span>
            <div>
              <h2 className="font-display text-lg font-bold">No lead lists imported yet</h2>
              <p className="mt-1 text-sm text-app-muted">Upload a CSV or Excel file, paste a Google Sheets link or paste rows from a spreadsheet.</p>
            </div>
            {canManage && <Button onClick={() => setWizardOpen(true)}><Icon name="upload" className="size-4" /> Import your first list</Button>}
          </Card>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleImports.map((item) => (
                <ImportCard
                  key={item.id}
                  item={item}
                  active={item.id === importId}
                  onSelect={() => {
                    setImportId(item.id === importId ? '' : item.id);
                    queueTop.current?.scrollIntoView({ block: 'start' });
                    queueTop.current?.focus({ preventScroll: true });
                  }}
                  onReport={() => setReportFor(item)}
                />
              ))}
            </div>
            {imports.length > 6 && (
              <button type="button" className="mt-2 text-xs font-bold text-app-accent hover:underline" onClick={() => setShowAllImports((value) => !value)}>
                {showAllImports ? 'Show fewer imports' : `Show all ${imports.length} imports`}
              </button>
            )}
          </>
        )}
      </section>

      {assignmentSelection && (
        <AssignLeadsModal
          count={assignmentSelection.count}
          people={people}
          includeAssignedChoice={assignmentSelection.hasOwners}
          onClose={() => setAssignmentSelection(null)}
          onAssign={async (employeeIds, includeAssigned) => {
            const result = await assignLeads({ ...assignmentSelection.target, employeeIds, includeAssigned });
            setAssignmentSelection(null);
            setMessage(assignMessage(result));
            await Promise.all([load(), loadImports()]);
            listAssignees()
              .then((next) => setPeople(next.items))
              .catch(() => undefined);
          }}
        />
      )}
      {wizardOpen && (
        <ImportLeadsWizard
          sources={sources}
          campaigns={campaigns}
          onClose={() => {
            setWizardOpen(false);
            void loadImports();
          }}
          onDone={(id) => {
            setWizardOpen(false);
            setImportId(id);
            setAssignment('all');
            void loadImports();
          }}
        />
      )}
      {reportFor && <ImportReportModal item={reportFor} onClose={() => setReportFor(null)} onNavigate={onNavigate} onChanged={() => void loadImports()} />}
    </Page>
  );
}

function assignMessage(result: AssignResult): string {
  const moved = result.assigned + result.reassigned;
  const people = result.byEmployee.filter((entry) => entry.count > 0).map((entry) => `${entry.fullName} ${entry.count}`).join(', ');
  const skipped = result.skipped.alreadyAssigned + result.skipped.closed + result.skipped.notImported;
  const parts = [`${plural(moved, 'lead')} assigned${people ? ` (${people})` : ''}.`];
  if (result.skipped.alreadyAssigned) parts.push(`${plural(result.skipped.alreadyAssigned, 'lead')} already had an owner and stayed with them.`);
  else if (skipped) parts.push(`${plural(skipped, 'lead')} skipped.`);
  return parts.join(' ');
}

function ImportCard({ item, active, onSelect, onReport }: { item: LeadImportSummary; active: boolean; onSelect: () => void; onReport: () => void }): React.JSX.Element {
  const running = item.status === 'queued' || item.status === 'importing';
  const progress = importProgress(item.processedRows, item.totalRows);
  return (
    <div className="ui-card imported-leads-history-card flex flex-col gap-3 p-4" data-active={active}>
      <button type="button" onClick={onSelect} className="flex items-start gap-3 text-left" aria-pressed={active}>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-app-accent">
          <Icon name={sourceKindIcon(item.sourceKind)} className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-base font-bold">{item.name}</span>
          <span className="block truncate text-xs text-app-muted">
            {SOURCE_KIND_LABELS[item.sourceKind]} · {item.createdByName ?? 'Someone'} · {timeAgo(item.startedAt ?? item.createdAt)}
          </span>
        </span>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${importStatusTone(item.status)}`}>{IMPORT_STATUS_LABELS[item.status]}</span>
      </button>
      {running ? (
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-app-muted">
            <span>{item.processedRows.toLocaleString()} of {item.totalRows.toLocaleString()} rows</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-app-border">
            <div className="h-full rounded-full bg-app-accent transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            ['Imported', item.createdCount, ''],
            ['Assigned', item.assignedCount, 'text-app-success'],
            ['Unassigned', item.unassignedCount, item.unassignedCount ? 'text-app-danger' : ''],
          ].map(([label, value, tone]) => (
            <div key={String(label)} className="rounded-xl bg-app-background px-2 py-2">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-app-muted">{label}</dt>
              <dd className={`text-lg font-bold tabular-nums ${tone}`}>{Number(value).toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-app-muted">
          {item.existingCount + item.duplicateCount + item.invalidCount + item.failedCount > 0
            ? `${(item.existingCount + item.duplicateCount).toLocaleString()} matched existing leads · ${(item.invalidCount + item.failedCount).toLocaleString()} not imported`
            : item.leadSourceName ?? ''}
        </span>
        <button type="button" onClick={onReport} className="shrink-0 font-bold text-app-accent hover:underline">Report</button>
      </div>
    </div>
  );
}

const AVAILABILITY_LABELS: Readonly<Record<AssigneeOption['availability'], string | null>> = {
  available: null,
  on_leave: 'On leave today',
  not_punched_in: 'Not in yet',
  unknown: null,
};

function AssignLeadsModal({
  count,
  people,
  includeAssignedChoice,
  onClose,
  onAssign,
}: {
  count: number;
  people: AssigneeOption[];
  includeAssignedChoice: boolean;
  onClose: () => void;
  onAssign: (employeeIds: string[], includeAssigned: boolean) => Promise<void>;
}): React.JSX.Element {
  const [chosen, setChosen] = useState<string[]>([]);
  const [includeAssigned, setIncludeAssigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(people.map((person) => [person.id, person]));
  const counts = splitCounts(count, chosen.length);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onAssign(chosen, includeAssigned);
    } catch (cause) {
      setError(errorText(cause, 'The leads could not be assigned.'));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Assign ${plural(count, 'lead')}`}
      onClose={onClose}
      dirty={chosen.length > 0}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || chosen.length === 0}>
            {busy ? 'Assigning…' : chosen.length > 1 ? `Split between ${chosen.length} people` : 'Assign'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <ErrorToast message={error} />}
        <SearchableSelect
          label="Add a salesperson"
          value=""
          placeholder="Search the Sales department…"
          onChange={(value) => {
            if (value && !chosen.includes(value)) setChosen((current) => [...current, value]);
          }}
          options={people
            .filter((person) => !chosen.includes(person.id))
            .map((person) => ({ value: person.id, label: [person.fullName, person.positionName, person.teamName].filter(Boolean).join(' · ') }))}
        />
        {chosen.length === 0 ? (
          <p className="rounded-xl border border-dashed border-app-border px-4 py-6 text-center text-sm text-app-muted">
            Pick one person to give them every lead, or several to split the leads evenly.
          </p>
        ) : (
          <ul className="divide-y divide-app-border overflow-hidden rounded-2xl border border-app-border">
            {chosen.map((id, index) => {
              const person = byId.get(id);
              const availability = person ? AVAILABILITY_LABELS[person.availability] : null;
              return (
                <li key={id} className="flex items-center gap-3 px-4 py-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-app-accent/10 text-xs font-bold text-app-accent">
                    {(person?.fullName ?? '?').split(' ').map((part) => part[0]).slice(0, 2).join('')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{person?.fullName ?? 'Unknown'}</p>
                    <p className="truncate text-xs text-app-muted">
                      {[person?.teamName ?? 'No team', person ? `${plural(person.openLeads, 'open lead')}` : null].filter(Boolean).join(' · ')}
                      {availability && <span className={`ml-1 font-semibold ${person?.availability === 'on_leave' ? 'text-app-danger' : 'text-app-muted'}`}>· {availability}</span>}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-app-background px-2.5 py-1 text-xs font-bold tabular-nums">+{(counts[index] ?? 0).toLocaleString()}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${person?.fullName ?? 'person'}`}
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-app-muted hover:bg-app-background hover:text-app-foreground"
                    onClick={() => setChosen((current) => current.filter((entry) => entry !== id))}
                  >
                    <Icon name="close" className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {chosen.length > 1 && (
          <p className="flex items-center gap-2 text-xs text-app-muted">
            <Icon name="shuffle" className="size-4" /> Leads are dealt out in turn, in the order the people are listed.
          </p>
        )}
        {includeAssignedChoice && (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--theme-primary)]" checked={includeAssigned} onChange={(event) => setIncludeAssigned(event.target.checked)} />
            <span>
              <span className="font-semibold">Also move leads that already have an owner</span>
              <span className="block text-xs text-app-muted">Their pending callbacks move too, and the previous owner is told. Leave it off to hand out only unassigned leads.</span>
            </span>
          </label>
        )}
        <p className="text-xs text-app-muted">Each person gets one notification for the whole batch, and the leads appear in their My Work.</p>
      </div>
    </Modal>
  );
}

function ImportReportModal({
  item,
  onClose,
  onNavigate,
  onChanged,
}: {
  item: LeadImportSummary;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onChanged: () => void;
}): React.JSX.Element {
  const [summary, setSummary] = useState(item);
  const [status, setStatus] = useState<'all' | 'problems'>(item.invalidCount + item.failedCount + item.existingCount + item.duplicateCount > 0 ? 'problems' : 'all');
  const [rows, setRows] = useState<ImportRowView[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setRows(null);
    listImportRows(item.id, { status, page: 1, pageSize: 100 })
      .then((result) => {
        if (!current) return;
        setRows(result.items);
        setTotal(result.total);
        setPage(1);
      })
      .catch((cause: unknown) => {
        if (current) setError(errorText(cause, 'Unable to load the report.'));
      });
    return () => {
      current = false;
    };
  }, [item.id, status]);

  async function more(): Promise<void> {
    const next = await listImportRows(item.id, { status, page: page + 1, pageSize: 100 });
    setRows((current) => [...(current ?? []), ...next.items]);
    setPage(next.page);
  }

  async function resume(): Promise<void> {
    setBusy(true);
    try {
      await resumeImport(item.id);
      setSummary(await getImport(item.id));
      onChanged();
    } catch (cause) {
      setError(errorText(cause, 'The import could not be resumed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Report · ${summary.name}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        {error && <ErrorToast message={error} />}
        {summary.status === 'failed' && (
          <Notice error>
            {summary.lastError ?? 'The import stopped part-way.'}{' '}
            <button type="button" className="font-bold underline" onClick={() => void resume()} disabled={busy}>{busy ? 'Resuming…' : 'Resume it'}</button>
          </Notice>
        )}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ['Rows', summary.totalRows],
            ['New leads', summary.createdCount],
            ['Already in CRM', summary.existingCount],
            ['Repeated', summary.duplicateCount],
            ['Not imported', summary.invalidCount + summary.failedCount],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-app-border p-3">
              <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-app-muted">{label}</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums">{Number(value).toLocaleString()}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-app-muted">
          {SOURCE_KIND_LABELS[summary.sourceKind]}
          {summary.fileName ? ` · ${summary.fileName}` : ''}
          {summary.sheetName ? ` · sheet “${summary.sheetName}”` : ''}
          {summary.leadSourceName ? ` · source ${summary.leadSourceName}` : ''}
          {summary.campaignName ? ` · campaign ${summary.campaignName}` : ''}
        </p>
        <div role="group" aria-label="Rows to show" className="inline-flex gap-1.5 rounded-xl border border-app-border bg-app-surface p-1">
          {(
            [
              ['problems', 'Not new leads'],
              ['all', 'Every row'],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${status === value ? 'ui-primary' : 'text-app-muted hover:bg-app-background'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="max-h-[50vh] overflow-auto rounded-2xl border border-app-border">
          {rows === null ? (
            <div className="space-y-2 p-4">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-8" />)}</div>
          ) : rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-app-muted">{status === 'problems' ? 'Every row became a new lead.' : 'No rows.'}</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-app-surface">
                <tr className="border-b border-app-border text-left text-[11px] font-bold uppercase tracking-wider text-app-muted">
                  <th className="px-4 py-2.5">Row</th>
                  <th className="px-4 py-2.5">Client</th>
                  <th className="px-4 py-2.5">Phone / email</th>
                  <th className="px-4 py-2.5">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td className="px-4 py-2.5 tabular-nums text-app-muted">{row.rowNumber}</td>
                    <td className="px-4 py-2.5 font-semibold">{row.contactName ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className="block">{row.phone ?? '—'}</span>
                      {row.email && <span className="block text-app-muted">{row.email}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${rowStatusTone(row.status)}`}>{ROW_STATUS_LABELS[row.status]}</span>
                      {row.reason && <p className="mt-1 text-xs text-app-muted">{row.reason}</p>}
                      {row.leadId && row.status !== 'created' && (
                        <button type="button" className="mt-1 block text-xs font-bold text-app-accent hover:underline" onClick={() => onNavigate(`/company/sales/leads/${row.leadId}`)}>
                          Open lead #{row.leadNumber}{row.ownerName ? ` · ${row.ownerName}` : ''}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {rows !== null && rows.length < total && (
          <Button kind="secondary" onClick={() => void more()}>Show more ({(total - rows.length).toLocaleString()} left)</Button>
        )}
      </div>
    </Modal>
  );
}
