import { useEffect, useMemo, useState } from 'react';
import { BarChart, Icon, TimerRing } from '../../../ui/index.js';
import { getAuditEntries, type AuditEntry } from '../../../audit/api/auditApi.js';
import { getCompanyEmployees, type CompanyEmployee } from '../../api/companyApi.js';
import { listLeaveAcknowledgements, listLeaveDecisions } from '../../api/leaveApi.js';
import { listCorrections } from '../../attendance/attendanceApi.js';
import { loadLiveBoard, type LiveRow } from '../../live/liveApi.js';
import { getCallOverview, type CallOverview } from '../../sales/calls/api.js';
import { localDate } from '../../sales/calls/calls-format.js';
import { getAllCallbacks, type LeadCallback } from '../../sales/leads/api.js';
import { listPendingApprovals } from '../../sales/approvals/api.js';
import { listApprovals as listExpenseApprovals } from '../../expenses/api/expensesApi.js';
import { listAllMeetings, type Meeting } from '../../../meetings/api.js';
import type { WidgetContext } from '../widget-types.js';

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <div className={`dashboard-widget-shell flex h-full min-h-0 w-full flex-col gap-3 overflow-hidden ${className}`}>{children}</div>;
}

function Heading({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-app-accent/10 text-app-accent">
          <Icon name={icon} className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold tracking-tight text-app-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 truncate text-[11px] text-app-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

function OpenLink({ onClick, children = 'Open' }: { onClick: () => void; children?: React.ReactNode }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className="shrink-0 rounded-full border border-app-border/80 bg-app-surface/70 px-3 py-1.5 text-[10px] font-semibold text-app-muted transition hover:border-app-accent/40 hover:text-app-accent">
      {children} <span aria-hidden="true">↗</span>
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="grid min-h-24 flex-1 place-items-center rounded-2xl border border-dashed border-app-border/80 px-4 text-center text-xs text-app-muted">{children}</div>;
}

function Loading({ rows = 3 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="flex-1 space-y-3 py-2" aria-label="Loading dashboard data">
      {Array.from({ length: rows }, (_, index) => <div key={index} className="h-8 animate-pulse rounded-xl bg-app-border/40" />)}
    </div>
  );
}

function elapsedLabel(since: string | null, now: number): string {
  if (!since) return '—';
  const sinceMs = new Date(since).getTime();
  if (!Number.isFinite(sinceMs)) return '—';
  const seconds = Math.max(0, Math.floor((now - sinceMs) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatTime(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone }).format(date);
}

function formatMeetingTime(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone }).format(date);
}

function timeUntil(value: string, now: number): string {
  const delta = new Date(value).getTime() - now;
  if (!Number.isFinite(delta)) return 'Time unavailable';
  if (delta < 0) return 'Overdue';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `in ${hours}h ${remainder}m` : `in ${hours}h`;
  return `in ${Math.floor(hours / 24)}d`;
}

/* ---------------------------------------------------------- Team attendance */

export function AdminTeamAttendanceWidget({ ctx }: { ctx: WidgetContext }): React.JSX.Element {
  const [rows, setRows] = useState<LiveRow[] | null>(null);
  const [groups, setGroups] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const [attendanceView, setAttendanceView] = useState<'breaks' | 'punches'>('breaks');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const board = await loadLiveBoard();
        if (!active) return;
        setRows(board.rows);
        setGroups(board.groups ?? {});
        setError('');
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Attendance data is unavailable.');
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 30_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [ctx.refreshKey]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const breakRows = useMemo(
    () => (rows ?? []).filter((row) => row.state === 'ON_BREAK').sort((a, b) => new Date(a.since ?? 0).getTime() - new Date(b.since ?? 0).getTime()),
    [rows],
  );
  const recentPunches = useMemo(() => (rows ?? []).flatMap((row) => [
    ...(row.arrivalAt ? [{ id: `${row.userId}-in`, row, kind: 'In', at: row.arrivalAt }] : []),
    ...(row.departureAt ? [{ id: `${row.userId}-out`, row, kind: 'Out', at: row.departureAt }] : []),
  ]).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 5), [rows]);
  const active = (groups['working'] ?? 0) + (groups['onBreak'] ?? 0);
  const finished = (groups['finished'] ?? 0) + (groups['possiblyFinished'] ?? 0);
  const notIn = (groups['notInDue'] ?? 0) + (groups['notInNotYetDue'] ?? 0);
  const headcount = rows?.length ?? 0;

  return (
    <Panel>
      <Heading
        icon="clock"
        title="Team attendance"
        subtitle="Employee punch status · live refresh every 30s"
        action={<OpenLink onClick={() => ctx.onNavigate('/company/attendance/live')}>Live board</OpenLink>}
      />
      {rows === null ? (
        error ? <Empty>{error}</Empty> : <Loading rows={2} />
      ) : (
        <>
          <div className="dashboard-team-attendance-summary grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-4 rounded-2xl border border-app-border/60 bg-app-surface/55 p-3 sm:p-4">
            <TimerRing
              value={active}
              max={headcount}
              label="Employees active now"
              valueLabel={String(active)}
              caption={`of ${headcount} employees`}
              className="dashboard-team-attendance-ring size-28 sm:size-32"
            />
            <div className="dashboard-team-attendance-metrics grid min-w-0 grid-cols-4 gap-2">
              <StatusMetric label="Working" value={groups['working'] ?? 0} tone="green" />
              <StatusMetric label="On break" value={groups['onBreak'] ?? 0} tone="amber" />
              <StatusMetric label="Finished" value={finished} tone="blue" />
              <StatusMetric label="Not punched in" value={notIn} tone="muted" />
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1 rounded-full bg-app-surface/60 p-1">
                <button type="button" aria-pressed={attendanceView === 'breaks'} onClick={() => setAttendanceView('breaks')} className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${attendanceView === 'breaks' ? 'bg-app-accent text-app-on-accent' : 'text-app-muted'}`}>On break · {breakRows.length}</button>
                <button type="button" aria-pressed={attendanceView === 'punches'} onClick={() => setAttendanceView('punches')} className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${attendanceView === 'punches' ? 'bg-app-accent text-app-on-accent' : 'text-app-muted'}`}>Latest punches</button>
              </div>
              <span className="shrink-0 text-[9px] text-app-muted">Today</span>
            </div>
            {attendanceView === 'breaks' ? breakRows.length === 0 ? (
              <p className="rounded-xl bg-app-surface/55 px-3 py-2.5 text-xs text-app-muted">No employees are on break right now.</p>
            ) : (
              <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
                {breakRows.slice(0, 4).map((row) => (
                  <li key={row.userId} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-amber-500/[0.06] px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold">{row.fullName}</p>
                      <p className="truncate text-[10px] text-app-muted">{row.departmentName ?? row.teamName ?? 'Team member'}</p>
                    </div>
                    <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-amber-700 dark:text-amber-300" aria-label={`On break for ${elapsedLabel(row.since, now)}`}>{elapsedLabel(row.since, now)}</span>
                  </li>
                ))}
              </ul>
            ) : recentPunches.length === 0 ? (
              <p className="rounded-xl bg-app-surface/55 px-3 py-2.5 text-xs text-app-muted">No punch events are available today.</p>
            ) : (
              <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
                {recentPunches.map((event) => (
                  <li key={event.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-app-surface/55 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold">{event.row.fullName}</p>
                      <p className="mt-0.5 truncate text-[10px] text-app-muted">{event.kind === 'In' ? 'Punched in' : 'Punched out'} · {event.row.departmentName ?? event.row.teamName ?? 'Team member'}</p>
                    </div>
                    <time dateTime={event.at} className="shrink-0 font-mono text-[10px] font-semibold tabular-nums text-app-muted">{formatTime(event.at, ctx.identity.organization?.timezone ?? 'UTC')}</time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

function StatusMetric({ label, value, tone }: { label: string; value: number; tone: 'green' | 'amber' | 'blue' | 'muted' }): React.JSX.Element {
  const color = {
    green: 'text-emerald-700 dark:text-emerald-300',
    amber: 'text-amber-700 dark:text-amber-300',
    blue: 'text-sky-700 dark:text-sky-300',
    muted: 'text-app-foreground',
  }[tone];
  return <div className="dashboard-team-attendance-metric min-w-0 rounded-xl bg-app-background/65 px-2.5 py-2"><p className="dashboard-team-attendance-label truncate text-[10px] text-app-muted">{label}</p><p className={`dashboard-team-attendance-value mt-0.5 text-lg font-semibold tabular-nums ${color}`}>{value}</p></div>;
}

/* ---------------------------------------------------------- Recent activity */

function activityLabel(action: string, targetType: string): string {
  const key = action.toLowerCase();
  const known: Record<string, string> = {
    'lead.created': 'Added a lead',
    'lead.assigned': 'Assigned a lead',
    'lead.reassigned': 'Reassigned a lead',
    'lead.status_changed': 'Updated a lead',
    'callback.scheduled': 'Scheduled a callback',
    'callback.rescheduled': 'Rescheduled a callback',
    'callback.completed': 'Completed a callback',
    'meeting.scheduled': 'Scheduled a meeting',
    'meeting.accepted': 'Accepted a meeting',
    'task.created': 'Created a task',
    'task.completed': 'Completed a task',
  };
  if (known[key]) return known[key];
  const words = key.replace(/[._-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words.slice(1).join(' ').replace(/^./, (letter) => letter.toUpperCase())} ${targetType.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}`;
  return key.replace(/^./, (letter) => letter.toUpperCase());
}

function relativeTime(value: string): string {
  const delta = Math.max(0, Date.now() - new Date(value).getTime());
  if (!Number.isFinite(delta)) return 'Recently';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function AdminActivityWidget({ ctx }: { ctx: WidgetContext }): React.JSX.Element {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = (): void => {
      void Promise.all([getAuditEntries({ stream: 'activity', limit: 100 }), getCompanyEmployees()])
        .then(([audit, people]) => {
          if (!active) return;
          setEntries(audit.entries);
          setEmployees(people);
          setError('');
        })
        .catch((cause: unknown) => {
          if (active) {
            setEntries([]);
            setError(cause instanceof Error ? cause.message : 'Recent activity is unavailable.');
          }
        });
    };
    load();
    const interval = window.setInterval(load, 60_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [ctx.refreshKey]);

  const employeeNames = useMemo(() => new Map(employees.map((employee) => [employee.id, employee.fullName])), [employees]);
  const recent = (entries ?? [])
    .filter((entry) => entry.actorType === 'employee' && entry.actorId)
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, 7);

  return (
    <Panel>
      <Heading icon="history" title="Recent team activity" subtitle="Employee actions across the workspace" action={<OpenLink onClick={() => ctx.onNavigate('/company/audit')}>Activity log</OpenLink>} />
      {entries === null ? <Loading /> : error ? <Empty>{error}</Empty> : recent.length === 0 ? <Empty>No recent employee activity yet.</Empty> : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {recent.map((entry) => (
            <li key={entry.id} className="flex min-w-0 items-start gap-3 rounded-xl px-2.5 py-2 transition hover:bg-app-surface/60">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-app-accent shadow-[0_0_0_4px_color-mix(in_srgb,var(--app-accent)_12%,transparent)]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{employeeNames.get(entry.actorId ?? '') ?? 'Employee'} <span className="font-normal text-app-muted">{activityLabel(entry.action, entry.targetType)}</span></p>
                <p className="mt-0.5 truncate text-[10px] text-app-muted">{entry.targetType.replace(/([a-z])([A-Z])/g, '$1 $2')} · {relativeTime(entry.occurredAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------- Sales calls */

export function AdminSalesCallsWidget({ ctx }: { ctx: WidgetContext }): React.JSX.Element {
  const timeZone = ctx.identity.organization?.timezone ?? 'UTC';
  const [overview, setOverview] = useState<CallOverview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = (): void => {
      const today = localDate(new Date(), timeZone);
      void getCallOverview({ from: today, to: today })
        .then((data) => { if (active) { setOverview(data); setError(''); } })
        .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Call analytics are unavailable.'); });
    };
    load();
    const interval = window.setInterval(load, 5 * 60_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [ctx.refreshKey, timeZone]);

  const people = [...(overview?.employees ?? [])]
    .filter((person) => person.employeeId && person.employeeName)
    .sort((a, b) => b.totalCalls - a.totalCalls)
    .slice(0, 5);
  const usedLabels = new Map<string, number>();
  const chart = people.map((person) => {
    const base = (person.employeeName ?? 'Employee').trim().split(/\s+/).slice(0, 2).join(' ');
    const count = usedLabels.get(base) ?? 0;
    usedLabels.set(base, count + 1);
    return { label: count ? `${base} ${count + 1}` : base, value: person.totalCalls };
  });

  return (
    <Panel>
      <Heading icon="phone" title="Sales calls today" subtitle={`Call activity · ${localDate(new Date(), timeZone)}`} action={<OpenLink onClick={() => ctx.onNavigate('/company/sales/calls')}>Team calls</OpenLink>} />
      {overview === null ? error ? <Empty>{error}</Empty> : <Loading rows={2} /> : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-app-border/60 bg-app-surface/55 p-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-app-background/65 p-3"><p className="text-[10px] text-app-muted">Calls handled</p><p className="mt-1 text-2xl font-semibold tabular-nums">{overview.totals.totalCalls.toLocaleString()}</p></div>
              <div className="rounded-xl bg-app-background/65 p-3"><p className="text-[10px] text-app-muted">Answered</p><p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{overview.totals.answered.toLocaleString()}</p></div>
              <p className="col-span-2 text-[10px] text-app-muted">{overview.totals.inbound} inbound · {overview.totals.outbound} outbound · {overview.totals.missedInbound} missed</p>
            </div>
            <TimerRing
              value={overview.totals.answered}
              max={overview.totals.totalCalls}
              label="Calls answered"
              valueLabel={overview.totals.totalCalls ? `${Math.round((overview.totals.answered / overview.totals.totalCalls) * 100)}%` : '—'}
              caption="answer rate"
              className="size-24"
            />
          </div>
          {error && <p className="text-[10px] text-amber-700 dark:text-amber-300">Showing the last available call snapshot.</p>}
          {overview.connections.length === 0 ? (
            <p className="rounded-xl border border-dashed border-app-border px-3 py-2 text-[11px] text-app-muted">No call integration is connected yet.</p>
          ) : (
            <>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-app-muted">Calls by salesperson</p>
              <div className="min-h-0 flex-1"><BarChart label="Calls handled today by salesperson" data={chart} /></div>
            </>
          )}
        </>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------- Sales callbacks */

export function AdminCallbacksWidget({ ctx }: { ctx: WidgetContext }): React.JSX.Element {
  const timeZone = ctx.identity.organization?.timezone ?? 'UTC';
  const [callbacks, setCallbacks] = useState<LeadCallback[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState('');

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    const load = (): void => {
      void getAllCallbacks({ status: 'pending' })
        .then((items) => { if (active) { setCallbacks(items); setError(''); } })
        .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Callback data is unavailable.'); });
    };
    load();
    const interval = window.setInterval(load, 60_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [ctx.refreshKey]);

  const pending = callbacks ?? [];
  const recentThreshold = now - 24 * 60 * 60_000;
  const added = pending.filter((callback) => callback.createdAt && new Date(callback.createdAt).getTime() >= recentThreshold).length;
  const upcoming = pending
    .filter((callback) => new Date(callback.scheduledAt).getTime() >= now)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const dueSoon = upcoming.filter((callback) => new Date(callback.scheduledAt).getTime() < now + 24 * 60 * 60_000).length;
  const overdue = pending.filter((callback) => new Date(callback.scheduledAt).getTime() < now).length;

  return (
    <Panel>
      <Heading icon="phone-outgoing" title="Upcoming calls" subtitle="Scheduled sales follow-ups" action={<OpenLink onClick={() => ctx.onNavigate('/company/sales/callbacks')}>Callbacks</OpenLink>} />
      <div className="grid grid-cols-3 gap-2">
        <SmallMetric label="Added · 24h" value={callbacks === null ? '—' : added.toLocaleString()} tone="accent" />
        <SmallMetric label="Due · 24h" value={callbacks === null ? '—' : dueSoon.toLocaleString()} tone="blue" />
        <SmallMetric label="Overdue" value={callbacks === null ? '—' : overdue.toLocaleString()} tone={overdue ? 'amber' : 'muted'} />
      </div>
      {callbacks === null ? error ? <Empty>{error}</Empty> : <Loading rows={2} /> : (
        <>
          {error && <p className="rounded-xl bg-amber-500/[0.07] px-3 py-2 text-[10px] text-amber-700 dark:text-amber-300">{error} Showing the last available snapshot.</p>}
          {upcoming.length === 0 ? <Empty>No upcoming callbacks are scheduled.</Empty> : (
            <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {upcoming.slice(0, 4).map((callback) => (
                <li key={callback.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-app-surface/55 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">{callback.leadContactName || `Lead #${callback.leadNumber}`}</p>
                    <p className="mt-0.5 truncate text-[10px] text-app-muted">{callback.ownerName ?? 'Unassigned'} · {formatTime(callback.scheduledAt, timeZone)}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-app-accent/10 px-2 py-1 text-[10px] font-semibold tabular-nums text-app-accent">{timeUntil(callback.scheduledAt, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

function SmallMetric({ label, value, tone }: { label: string; value: string; tone: 'accent' | 'blue' | 'amber' | 'muted' }): React.JSX.Element {
  const toneClass = {
    accent: 'text-app-accent',
    blue: 'text-sky-700 dark:text-sky-300',
    amber: 'text-amber-700 dark:text-amber-300',
    muted: 'text-app-foreground',
  }[tone];
  return <div className="min-w-0 rounded-xl bg-app-surface/55 px-2.5 py-2"><p className="truncate text-[9px] text-app-muted">{label}</p><p className={`mt-1 text-lg font-semibold tabular-nums ${toneClass}`}>{value}</p></div>;
}

/* --------------------------------------------------------- Upcoming meetings */

export function AdminMeetingsWidget({ ctx }: { ctx: WidgetContext }): React.JSX.Element {
  const timeZone = ctx.identity.organization?.timezone ?? 'UTC';
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = (): void => {
      const now = Date.now();
      void listAllMeetings({ from: new Date(now).toISOString(), to: new Date(now + 14 * 24 * 60 * 60_000).toISOString() })
        .then((items) => { if (active) { setMeetings(items); setError(''); } })
        .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Meeting data is unavailable.'); });
    };
    load();
    const interval = window.setInterval(load, 2 * 60_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [ctx.refreshKey]);

  const upcoming = (meetings ?? [])
    .filter((meeting) => ['confirmed', 'requested', 'proposed'].includes(meeting.status) && new Date(meeting.startsAt).getTime() >= Date.now())
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .slice(0, 5);

  return (
    <Panel>
      <Heading icon="calendar" title="Upcoming meetings" subtitle="Next two weeks · company calendar" action={<OpenLink onClick={() => ctx.onNavigate('/company/meetings')}>Calendar</OpenLink>} />
      {meetings === null ? error ? <Empty>{error}</Empty> : <Loading /> : (
        <>
          {error && <p className="rounded-xl bg-amber-500/[0.07] px-3 py-2 text-[10px] text-amber-700 dark:text-amber-300">{error} Showing the last available snapshot.</p>}
          {upcoming.length === 0 ? <Empty>No upcoming meetings on the calendar.</Empty> : (
            <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {upcoming.map((meeting) => (
                <li key={meeting.id} className="flex min-w-0 items-center gap-3 rounded-xl bg-app-surface/55 px-3 py-2.5">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-center text-[9px] font-bold uppercase leading-tight text-app-accent">
                    {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone }).format(new Date(meeting.startsAt))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{meeting.title}</p>
                    <p className="mt-0.5 truncate text-[10px] text-app-muted">{meeting.client?.businessName ?? meeting.host.name} · {formatMeetingTime(meeting.startsAt, timeZone)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold ${meeting.status === 'confirmed' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>{meeting.status}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------- Pending queues */

type RequestQueue = { id: string; label: string; path: string; count: number | null };

export function AdminPendingRequestsWidget({ ctx }: { ctx: WidgetContext }): React.JSX.Element {
  const [queues, setQueues] = useState<RequestQueue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const tasks: Array<{ id: string; label: string; path: string; request: () => Promise<number> }> = [];
    const actions = new Set<string>(ctx.identity.capabilities.map((item) => item.action));
    const isSuperAdmin = ctx.identity.user.accountType === 'super-admin';
    const allowed = (action: string): boolean => isSuperAdmin || actions.has(action);

    if (allowed('leave:decide') || allowed('leave:acknowledge')) {
      tasks.push({ id: 'leave', label: 'Leave requests', path: '/company/leave/queue', request: async () => {
        const [decisions, acknowledgements] = await Promise.all([listLeaveDecisions(), listLeaveAcknowledgements()]);
        return decisions.length + acknowledgements.length;
      } });
    }
    if (allowed('attendance:correct')) tasks.push({ id: 'attendance', label: 'Attendance fixes', path: '/company/attendance/corrections', request: async () => (await listCorrections({ status: 'pending' })).corrections.length });
    if (allowed('approvals:decide')) tasks.push({ id: 'sales', label: 'Sales approvals', path: '/company/sales/approvals', request: async () => (await listPendingApprovals()).length });
    if (allowed('payables:approve-claim')) tasks.push({ id: 'expenses', label: 'Expense claims', path: '/company/expenses/approvals', request: async () => (await listExpenseApprovals({ page: 1, pageSize: 1, status: 'pending' })).total });

    void Promise.all(tasks.map(async (task) => {
      try { return { ...task, count: await task.request() }; }
      catch { return { ...task, count: null }; }
    })).then((result) => {
      if (active) setQueues(result.map(({ id, label, path, count }) => ({ id, label, path, count })));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ctx.refreshKey, ctx.identity]);

  const total = queues.reduce((sum, queue) => sum + (queue.count ?? 0), 0);
  const unavailable = queues.some((queue) => queue.count === null);

  return (
    <Panel>
      <Heading icon="inbox" title="Pending requests" subtitle="Queues that need a decision" />
      {loading ? <Loading rows={3} /> : queues.length === 0 ? (
        <Empty>No approval queues are available for this account.</Empty>
      ) : (
        <>
          <div className="flex items-end justify-between rounded-2xl border border-app-border/60 bg-app-surface/55 px-4 py-3">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-app-muted">Open items</p><p className="mt-1 text-3xl font-semibold tabular-nums">{unavailable && total === 0 ? '—' : total}</p></div>
            <span className="rounded-full bg-amber-500/10 px-3 py-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">{unavailable ? 'Some queues unavailable' : total === 0 ? 'All clear' : 'Needs review'}</span>
          </div>
          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
            {queues.map((queue) => (
              <li key={queue.id}>
                <button type="button" onClick={() => ctx.onNavigate(queue.path)} className="flex w-full items-center justify-between gap-3 rounded-xl bg-app-surface/55 px-3 py-2.5 text-left transition hover:bg-app-accent/[0.08]">
                  <span className="text-xs font-medium">{queue.label}</span>
                  <span className={`min-w-8 rounded-full px-2 py-1 text-center text-[10px] font-semibold tabular-nums ${queue.count === null ? 'bg-app-border/50 text-app-muted' : queue.count > 0 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'}`}>{queue.count ?? '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
