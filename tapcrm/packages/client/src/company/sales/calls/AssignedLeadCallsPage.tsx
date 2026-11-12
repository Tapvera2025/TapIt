import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Field, Icon, Modal, Notice, Page, Progress, Select, Skeleton, TimerRing } from '../../../ui/index.js';
import type { CallOutcome } from './api.js';
import { formatCallTime, formatDuration, formatPhone, formatTalkTime, percent, timeAgo } from './calls-format.js';
import {
  CALLS_PATHS,
  CallDetailModal,
  CallsTabs,
  DirectionIcon,
  errorText,
  initialRange,
  OutcomePill,
  RangeFilter,
  SectionTitle,
  StatGrid,
  StatGridSkeleton,
  type CallsAccess,
  type RangeValue,
} from './CallsShared.js';
import {
  getCallTracking,
  getLeadCalls,
  listImports,
  type CallTrackingFilters,
  type CallTrackingLead,
  type CallTrackingOverview,
  type LeadCallHistory,
  type LeadCallStatus,
  type LeadImportSummary,
} from '../leads/imports/api.js';
import { CALL_STATUS_LABELS, callStatusIcon, callStatusTone, IMPORTED_LEADS_PATH, plural } from '../leads/imports/import-format.js';

const PAGE_SIZE = 25;

const STATUS_TABS: ReadonlyArray<{ value: LeadCallStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'not_called', label: 'Not called' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'connected', label: 'Connected' },
  { value: 'other', label: 'Someone else' },
];

const SORTS: ReadonlyArray<{ value: NonNullable<CallTrackingFilters['sort']>; label: string }> = [
  { value: 'assigned_desc', label: 'Newest assignments' },
  { value: 'waiting_longest', label: 'Waiting longest' },
  { value: 'last_call_desc', label: 'Latest calls' },
  { value: 'assigned_asc', label: 'Oldest assignments' },
];

/**
 * Are the people given imported leads calling them? Each assigned lead's
 * number is matched to JustCall/Aircall calls made or taken by its owner
 * after the assignment.
 */
export function AssignedLeadCallsPage({
  access,
  organizationTimeZone,
  onNavigate,
}: {
  access: CallsAccess;
  organizationTimeZone: string;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const [range, setRange] = useState<RangeValue>(() => initialRange(organizationTimeZone, '30d'));
  const [importId, setImportId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [assignedBy, setAssignedBy] = useState<'anyone' | 'me'>('anyone');
  const [status, setStatus] = useState<LeadCallStatus | 'all'>('all');
  const [sort, setSort] = useState<NonNullable<CallTrackingFilters['sort']>>('assigned_desc');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [overview, setOverview] = useState<CallTrackingOverview | null>(null);
  const [leads, setLeads] = useState<CallTrackingLead[]>([]);
  const [page, setPage] = useState(1);
  const [imports, setImports] = useState<LeadImportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const filters = useMemo<CallTrackingFilters>(
    () => ({
      from: range.from,
      to: range.to,
      importId: importId || undefined,
      ownerId: ownerId || undefined,
      assignedBy,
      status,
      sort,
      search: search || undefined,
    }),
    [range.from, range.to, importId, ownerId, assignedBy, status, sort, search],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getCallTracking({ ...filters, page: 1, pageSize: PAGE_SIZE });
      setOverview(next);
      setLeads(next.leads);
      setPage(1);
      setError(null);
    } catch (cause) {
      setError(errorText(cause, 'Unable to load call tracking.'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    listImports()
      .then((result) => setImports(result.items.filter((item) => item.status !== 'draft')))
      .catch(() => setImports([]));
  }, []);

  async function loadMore(): Promise<void> {
    setLoadingMore(true);
    try {
      const next = await getCallTracking({ ...filters, page: page + 1, pageSize: PAGE_SIZE });
      setLeads((current) => [...current, ...next.leads]);
      setPage(next.page);
    } catch (cause) {
      setError(errorText(cause, 'Unable to load more leads.'));
    } finally {
      setLoadingMore(false);
    }
  }

  const totals = overview?.totals;
  const telephony = overview?.telephony;
  const employees = overview?.employees ?? [];

  return (
    <Page
      eyebrow="Sales · Calls"
      title="Assigned lead calls"
      description="Whether the people you handed imported leads to are calling them. Calls from JustCall and Aircall are matched to each lead by phone number."
      action={
        <div className="flex flex-wrap gap-2">
          <Button kind="secondary" onClick={() => onNavigate(IMPORTED_LEADS_PATH)}>
            <Icon name="upload" className="size-4" /> Imported leads
          </Button>
          <Button kind="secondary" onClick={() => void load()} disabled={loading}>
            <Icon name="refresh" className="size-4" /> Refresh
          </Button>
        </div>
      }
    >
      <CallsTabs active="assigned" access={access} onNavigate={onNavigate} />

      <Card className="grid gap-4 p-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-app-muted">Assigned between</p>
          <RangeFilter value={range} timeZone={organizationTimeZone} onChange={setRange} />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Select label="Import" value={importId} placeholder="All imports" onChange={setImportId} options={imports.map((item) => ({ value: item.id, label: item.name }))} />
          <Select label="Salesperson" value={ownerId} placeholder="Everyone" onChange={setOwnerId} options={employees.map((row) => ({ value: row.employeeId, label: row.employeeName }))} />
          <Select
            label="Assigned by"
            value={assignedBy}
            onChange={(value) => setAssignedBy(value === 'me' ? 'me' : 'anyone')}
            options={[
              { value: 'anyone', label: 'Anyone' },
              { value: 'me', label: 'Me' },
            ]}
          />
          <Field label="Search" value={searchInput} onChange={setSearchInput} placeholder="Lead, business or phone" />
        </div>
      </Card>

      {error && <Notice error>{error}</Notice>}
      {telephony && !telephony.connected && (
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-app-accent"><Icon name="phone" className="size-5" /></span>
            <div>
              <p className="font-display font-bold">No calling platform connected</p>
              <p className="text-sm text-app-muted">Assignments are listed below, but every lead shows as not called until JustCall or Aircall is connected.</p>
            </div>
          </div>
          {access.canManage && <Button onClick={() => onNavigate(CALLS_PATHS.integrations)}>Connect a platform</Button>}
        </Card>
      )}

      {loading && !overview ? (
        <StatGridSkeleton />
      ) : totals ? (
        <StatGrid
          items={[
            { label: 'Assigned leads', value: totals.assigned.toLocaleString(), hint: `${totals.withPhone.toLocaleString()} with a phone number`, icon: 'user-plus' },
            { label: 'Called', value: percent(totals.called, totals.withPhone), hint: `${totals.called.toLocaleString()} of ${totals.withPhone.toLocaleString()} leads`, icon: 'phone-outgoing', tone: 'success' },
            { label: 'Connected', value: totals.connected.toLocaleString(), hint: totals.called ? `${percent(totals.connected, totals.called)} of called leads` : 'Answered calls', icon: 'check', tone: 'success' },
            {
              label: 'Not called yet',
              value: totals.notCalled.toLocaleString(),
              hint: totals.overdue ? `${totals.overdue.toLocaleString()} waiting over a day` : 'None waiting over a day',
              icon: 'clock',
              tone: totals.overdue ? 'danger' : 'default',
            },
            { label: 'First call', value: totals.avgFirstCallSeconds === null ? '—' : formatDuration(totals.avgFirstCallSeconds), hint: 'Avg. after assigning', icon: 'history' },
            { label: 'Talk time', value: formatTalkTime(totals.talkSeconds), hint: 'With assigned leads', icon: 'phone' },
          ]}
        />
      ) : null}

      {overview && totals && (
        <>
          <Card className="grid items-center gap-6 md:grid-cols-[10rem_1fr]">
            <div className="grid place-items-center">
              <TimerRing value={totals.called} max={totals.withPhone} label="Leads called" valueLabel={percent(totals.called, totals.withPhone)} caption="called" className="size-36" />
            </div>
            <div>
              <SectionTitle title="Coverage" description="Assigned leads with a phone number, by what happened after they were assigned." />
              <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                <Progress label="Connected" value={totals.connected} max={totals.withPhone} />
                <Progress label="Tried, no answer" value={totals.noAnswer} max={totals.withPhone} />
                <Progress label="Not called yet" value={totals.notCalled - totals.calledByOthers} max={totals.withPhone} />
                <Progress label="Called by someone else" value={totals.calledByOthers} max={totals.withPhone} />
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="p-5 pb-0">
              <SectionTitle title="By salesperson" description="Click someone to see only their leads." />
            </div>
            {employees.length === 0 ? (
              <p className="px-5 pb-8 pt-2 text-sm text-app-muted">No imported leads were assigned in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-app-border text-left text-[11px] font-bold uppercase tracking-wider text-app-muted">
                      <th className="px-5 py-3">Salesperson</th>
                      <th className="px-3 py-3 text-right">Assigned</th>
                      <th className="w-56 px-3 py-3">Called</th>
                      <th className="px-3 py-3 text-right">Connected</th>
                      <th className="px-3 py-3 text-right">Not called</th>
                      <th className="px-3 py-3 text-right">First call</th>
                      <th className="px-5 py-3 text-right">Last call</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-app-border">
                    {employees.map((row) => {
                      const share = row.assigned ? Math.round((row.called / row.assigned) * 100) : 0;
                      return (
                        <tr
                          key={row.employeeId}
                          className={`cursor-pointer whitespace-nowrap transition hover:bg-app-background/70 ${ownerId === row.employeeId ? 'bg-app-accent/5' : ''}`}
                          onClick={() => setOwnerId(ownerId === row.employeeId ? '' : row.employeeId)}
                        >
                          <td className="px-5 py-3">
                            <p className="font-semibold">{row.employeeName}</p>
                            <p className="text-xs text-app-muted">{row.teamName ?? 'No team'}</p>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">{row.assigned.toLocaleString()}</td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-app-border">
                                <div className={`h-full rounded-full ${share >= 80 ? 'bg-app-success' : share >= 40 ? 'bg-app-accent' : 'bg-app-danger'}`} style={{ width: `${share}%` }} />
                              </div>
                              <span className="w-24 text-right text-xs tabular-nums"><strong>{share}%</strong> · {row.called}/{row.assigned}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">{row.connected.toLocaleString()}</td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            <span className={row.overdue ? 'font-bold text-app-danger' : ''}>{row.notCalled.toLocaleString()}</span>
                            {row.overdue > 0 && <span className="block text-[11px] text-app-danger">{row.overdue} over a day</span>}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">{row.avgFirstCallSeconds === null ? '—' : formatDuration(row.avgFirstCallSeconds)}</td>
                          <td className="px-5 py-3 text-right text-xs text-app-muted">{row.lastCallAt ? timeAgo(row.lastCallAt) : 'Never'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-app-border p-4">
          <div role="group" aria-label="Call status" className="flex flex-wrap gap-1.5 rounded-xl border border-app-border bg-app-surface p-1">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-pressed={status === tab.value}
                onClick={() => setStatus(tab.value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${status === tab.value ? 'ui-primary' : 'text-app-muted hover:bg-app-background hover:text-app-foreground'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="w-full sm:w-56">
            <Select label="Sort" value={sort} onChange={(value) => setSort(value as NonNullable<CallTrackingFilters['sort']>)} options={SORTS.map((option) => ({ value: option.value, label: option.label }))} />
          </div>
        </div>
        {loading && leads.length === 0 ? (
          <div className="space-y-2 p-4" role="status" aria-label="Loading leads">
            {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12" />)}
          </div>
        ) : leads.length === 0 ? (
          <div className="grid place-items-center gap-2 px-6 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-app-accent/10 text-app-accent"><Icon name="user-plus" className="size-5" /></span>
            <p className="text-sm text-app-muted">No assigned leads match these filters.</p>
            <Button kind="secondary" onClick={() => onNavigate(IMPORTED_LEADS_PATH)}>Assign imported leads</Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-app-border text-left text-[11px] font-bold uppercase tracking-wider text-app-muted">
                  <th className="px-4 py-3">Lead</th>
                  <th className="px-4 py-3">Assigned to</th>
                  <th className="px-4 py-3">Calls</th>
                  <th className="px-4 py-3 text-right">Tries</th>
                  <th className="px-4 py-3">First call</th>
                  <th className="px-4 py-3">Last call</th>
                  <th className="px-4 py-3 text-right">Talk time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {leads.map((lead) => (
                  <tr key={lead.leadId} className="cursor-pointer transition hover:bg-app-background/70" onClick={() => setOpenLeadId(lead.leadId)}>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{lead.contactName}</p>
                      <p className="text-xs text-app-muted">{lead.companyName ? `${lead.companyName} · ` : ''}{formatPhone(lead.phone)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{lead.ownerName}</p>
                      <p className="text-xs text-app-muted">{timeAgo(lead.assignedAt)}{lead.assignedByName ? ` · by ${lead.assignedByName}` : ''}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${callStatusTone(lead.status)}`}>
                        <Icon name={callStatusIcon(lead.status)} className="size-3" />
                        {CALL_STATUS_LABELS[lead.status]}
                      </span>
                      {lead.otherCalls > 0 && lead.status !== 'other' && <p className="mt-1 text-[11px] text-app-muted">+{plural(lead.otherCalls, 'call')} by others</p>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{lead.attempts.toLocaleString()}</td>
                    <td className="px-4 py-3 text-xs">
                      {lead.firstCallAt ? (
                        <>
                          <span className="block font-semibold">{formatDuration((new Date(lead.firstCallAt).getTime() - new Date(lead.assignedAt).getTime()) / 1000)} after</span>
                          <span className="block text-app-muted">{formatCallTime(lead.firstCallAt, organizationTimeZone)}</span>
                        </>
                      ) : (
                        <span className="text-app-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {lead.lastCallAt ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {lead.lastOutcome && <OutcomePill outcome={lead.lastOutcome as CallOutcome} />}
                          <span className="text-app-muted">{timeAgo(lead.lastCallAt)}</span>
                        </div>
                      ) : (
                        <span className="text-app-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{lead.talkSeconds ? formatDuration(lead.talkSeconds) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {overview && leads.length < overview.total && (
          <div className="border-t border-app-border p-4 text-center">
            <Button kind="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : `Show more (${(overview.total - leads.length).toLocaleString()} left)`}
            </Button>
          </div>
        )}
      </Card>

      {telephony?.connected && (
        <p className="text-xs text-app-muted">
          Calls sync every 15 minutes{telephony.lastSyncAt ? ` · last synced ${timeAgo(telephony.lastSyncAt)}` : ''}. Numbers match on their last 10 digits, so a missing country code still matches. Only calls after the assignment count.
        </p>
      )}

      {openLeadId && <LeadCallsModal leadId={openLeadId} access={access} timeZone={organizationTimeZone} onClose={() => setOpenLeadId(null)} onNavigate={onNavigate} />}
    </Page>
  );
}

function LeadCallsModal({
  leadId,
  access,
  timeZone,
  onClose,
  onNavigate,
}: {
  leadId: string;
  access: CallsAccess;
  timeZone: string;
  onClose: () => void;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const [history, setHistory] = useState<LeadCallHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    getLeadCalls(leadId)
      .then((result) => {
        if (current) setHistory(result);
      })
      .catch((cause: unknown) => {
        if (current) setError(errorText(cause, 'Unable to load the calls.'));
      });
    return () => {
      current = false;
    };
  }, [leadId]);

  const canOpenCalls = access.canViewCalls !== false;
  return (
    <Modal
      title={history ? history.contactName : 'Lead calls'}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>Close</Button>
          <Button onClick={() => onNavigate(`/company/sales/leads/${leadId}`)}>Open lead</Button>
        </div>
      }
    >
      {error && <Notice error>{error}</Notice>}
      {!history && !error ? (
        <div className="space-y-2" role="status" aria-label="Loading calls">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-12" />)}</div>
      ) : history ? (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-app-muted">Phone</dt>
              <dd className="font-semibold">{formatPhone(history.phone)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-app-muted">Assigned to</dt>
              <dd className="font-semibold">{history.ownerName ?? 'Nobody'}{history.assignedAt ? <span className="block text-xs font-normal text-app-muted">{formatCallTime(history.assignedAt, timeZone)}</span> : null}</dd>
            </div>
          </dl>
          {history.calls.length === 0 ? (
            <p className="rounded-xl border border-dashed border-app-border px-4 py-8 text-center text-sm text-app-muted">No JustCall or Aircall calls with this number yet.</p>
          ) : (
            <ul className="divide-y divide-app-border overflow-hidden rounded-2xl border border-app-border">
              {history.calls.map((call) => (
                <li key={call.id}>
                  <button
                    type="button"
                    disabled={!canOpenCalls}
                    onClick={() => setCallId(call.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition enabled:hover:bg-app-background/70"
                  >
                    <DirectionIcon call={{ direction: call.direction, outcome: call.outcome as CallOutcome }} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{formatCallTime(call.startedAt, timeZone)}</span>
                      <span className="block truncate text-xs text-app-muted">
                        {call.employeeName ?? 'Unknown user'}
                        {!call.byOwner && <span className="text-app-accent"> · not the owner</span>}
                        {!call.afterAssignment && ' · before assignment'}
                      </span>
                    </span>
                    <OutcomePill outcome={call.outcome as CallOutcome} />
                    <span className="w-14 text-right text-xs tabular-nums text-app-muted">{formatDuration(call.talkSeconds)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {callId && <CallDetailModal callId={callId} timeZone={timeZone} canListen={access.canListen} onClose={() => setCallId(null)} />}
    </Modal>
  );
}
