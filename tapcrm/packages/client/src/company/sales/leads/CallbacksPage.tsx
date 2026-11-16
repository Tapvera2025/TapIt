import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Field, Icon, Page, SegmentedTabs, Select, SkeletonTable } from '../../../ui/index.js';
import { createCallback, getAllCallbacks, getLeads, type Lead, type LeadCallback } from './api.js';
import {
  CALLBACK_ORDER_OPTIONS,
  callbackOwnerOptions,
  callbacksByDay,
  callbackStatusLabel,
  filterCallbacks,
  formatCallbackDate,
  isOverdueCallback,
  monthGrid,
  organizationDayKey,
  organizationLocalToIso,
  organizationNowLocal,
  sentenceLabel,
  shiftMonth,
  sortCallbacks,
  type CallbackOrder,
} from './callback-ui.js';

type CallbackView = 'list' | 'calendar' | 'board' | 'schedule';
const statuses = ['pending', 'completed', 'rescheduled', 'not_reachable', 'missed', 'cancelled'];

/** Board columns, in the order a callback moves through them. */
const BOARD_COLUMNS = ['pending', 'not_reachable', 'missed', 'rescheduled', 'completed', 'cancelled'] as const;
/** A long column shows this many cards until "Show all". */
const BOARD_COLUMN_LIMIT = 15;

const VIEW_TABS = [
  { id: 'callbacks-view-list', view: 'list', label: 'List', icon: 'list' },
  { id: 'callbacks-view-calendar', view: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'callbacks-view-board', view: 'board', label: 'Board', icon: 'kanban' },
] as const;

const TONE_CLASSES: Record<string, string> = {
  pending: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  overdue: 'bg-[#d86b6b]/15 text-app-danger',
  completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  not_reachable: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  missed: 'bg-[#d86b6b]/15 text-app-danger',
  rescheduled: 'bg-app-background text-app-muted',
  cancelled: 'bg-app-background text-app-muted',
};

/** A pending callback whose time has passed shows as overdue. */
function toneOf(callback: LeadCallback, now: Date): string {
  return isOverdueCallback(callback, now) ? 'overdue' : callback.status;
}

function toneClass(callback: LeadCallback, now: Date): string {
  return TONE_CLASSES[toneOf(callback, now)] ?? TONE_CLASSES['rescheduled']!;
}

function StatusPill({ callback, now }: { callback: LeadCallback; now: Date }): React.JSX.Element {
  const overdue = toneOf(callback, now) === 'overdue';
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${toneClass(callback, now)}`}>
      {overdue ? 'Overdue' : callbackStatusLabel(callback.status)}
    </span>
  );
}

function timeOf(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeStyle: 'short', timeZone: timezone }).format(new Date(value));
}

export function CallbacksPage({ view, organizationTimezone, onNavigate }: { view: CallbackView; organizationTimezone: string; onNavigate: (path: string) => void }): React.JSX.Element {
  const [callbacks, setCallbacks] = useState<LeadCallback[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [owners, setOwners] = useState<Array<{ value: string; label: string }>>([]);
  const [leadSearch, setLeadSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [order, setOrder] = useState<CallbackOrder>('newest');
  const [error, setError] = useState('');
  const reload = () => getAllCallbacks({ status: status || undefined, from: from ? organizationLocalToIso(from, organizationTimezone) : undefined, to: to ? organizationLocalToIso(to, organizationTimezone) : undefined })
    .then((rows) => { setCallbacks(rows); setOwners((known) => callbackOwnerOptions(rows, known)); setError(''); })
    .catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load callbacks.'))
    .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [status, from, to]);
  const shown = useMemo(() => sortCallbacks(filterCallbacks(callbacks, ownerId, leadSearch), order), [callbacks, ownerId, leadSearch, order]);
  const nav = (next: CallbackView) => onNavigate(`/company/sales/callbacks${next === 'list' ? '' : `/${next}`}`);
  if (view === 'schedule') return <ScheduleCallbackPage organizationTimezone={organizationTimezone} onBack={() => nav('list')} onCreated={(id) => onNavigate(`/company/sales/callbacks/${id}`)} />;

  const now = new Date();
  const todayKey = organizationDayKey(now, organizationTimezone);
  const pending = shown.filter((callback) => callback.status === 'pending');
  const overdue = pending.filter((callback) => isOverdueCallback(callback, now)).length;
  const dueToday = pending.filter((callback) => !isOverdueCallback(callback, now) && organizationDayKey(callback.scheduledAt, organizationTimezone) === todayKey).length;
  const activeTab = VIEW_TABS.find((tab) => tab.view === view)?.id ?? VIEW_TABS[0].id;

  return (
    <Page
      eyebrow="Sales"
      title="Callbacks"
      description={`Follow-up calls booked for leads. A callback is not a missed phone call: JustCall and Aircall calls don't create callbacks. Times are in ${organizationTimezone}.`}
      action={<Button onClick={() => nav('schedule')}>Schedule callback</Button>}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          ariaLabel="Callback views"
          items={VIEW_TABS.map((tab) => ({ id: tab.id, label: tab.label, icon: <Icon name={tab.icon} className="size-4" /> }))}
          value={activeTab}
          onChange={(id) => nav(VIEW_TABS.find((tab) => tab.id === id)?.view ?? 'list')}
        />
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-full bg-app-background px-3 py-1">{pending.length} pending</span>
          <span className={`rounded-full px-3 py-1 ${overdue ? TONE_CLASSES['overdue'] : 'bg-app-background text-app-muted'}`}>{overdue} overdue</span>
          <span className="rounded-full bg-app-background px-3 py-1">{dueToday} still due today</span>
        </div>
      </div>
      {error && <p className="rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger" role="alert">{error}</p>}
      <Card className="p-4">
        <div className={`grid gap-3 sm:grid-cols-2 ${view === 'calendar' ? 'lg:grid-cols-5' : 'lg:grid-cols-6'}`}>
          <Select label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, ...statuses.map((value) => ({ value, label: callbackStatusLabel(value) }))]} />
          <Select label="Owner" value={ownerId} onChange={setOwnerId} options={[{ value: '', label: 'All owners' }, ...owners]} />
          <Field label="Lead" value={leadSearch} onChange={setLeadSearch} placeholder="Name or lead number" />
          <Field label="From" value={from} onChange={setFrom} type="datetime-local" />
          <Field label="To" value={to} onChange={setTo} type="datetime-local" />
          {view !== 'calendar' && <Select label="Order" value={order} onChange={(value) => setOrder(value as CallbackOrder)} options={[...CALLBACK_ORDER_OPTIONS]} />}
        </div>
      </Card>
      {loading && callbacks.length === 0
        ? <SkeletonTable columns={6} rows={5} />
        : view === 'calendar'
          ? <CallbackCalendar callbacks={shown} timezone={organizationTimezone} now={now} onNavigate={onNavigate} />
          : view === 'board'
            ? <CallbackBoard callbacks={shown} timezone={organizationTimezone} now={now} onNavigate={onNavigate} />
            : <CallbackTable callbacks={shown} timezone={organizationTimezone} now={now} onNavigate={onNavigate} />}
    </Page>
  );
}

function CallbackTable({ callbacks, timezone, now, onNavigate }: { callbacks: LeadCallback[]; timezone: string; now: Date; onNavigate: (path: string) => void }): React.JSX.Element {
  if (callbacks.length === 0) return <Card><p className="text-sm text-app-muted">No callbacks match the selected filters.</p></Card>;
  const open = (callback: LeadCallback) => onNavigate(`/company/sales/callbacks/${callback.id}`);
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-app-border text-left text-[11px] font-bold uppercase tracking-wider text-app-muted">
              <th className="px-5 py-3">Lead</th>
              <th className="px-4 py-3">Callback time</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Outcome</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-5 py-3">Booked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border">
            {callbacks.map((callback) => (
              <tr key={callback.id} className="cursor-pointer align-top transition hover:bg-app-background" onClick={() => open(callback)}>
                <td className="px-5 py-3">
                  <button type="button" className="text-left font-semibold hover:underline" onClick={(event) => { event.stopPropagation(); open(callback); }}>{callback.leadContactName}</button>
                  <p className="mt-0.5 max-w-xs truncate text-xs text-app-muted">Lead #{callback.leadNumber}{callback.reason ? ` · ${callback.reason}` : ''}</p>
                </td>
                <td className="whitespace-nowrap px-4 py-3">{formatCallbackDate(callback.scheduledAt, timezone)}</td>
                <td className="px-4 py-3"><StatusPill callback={callback} now={now} /></td>
                <td className="px-4 py-3 text-app-muted">{callback.outcome ? sentenceLabel(callback.outcome) : '—'}</td>
                <td className="px-4 py-3">{callback.ownerName ?? 'Unknown owner'}</td>
                <td className="whitespace-nowrap px-5 py-3 text-xs text-app-muted">{callback.createdAt ? formatCallbackDate(callback.createdAt, timezone) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A month of callbacks, with the chosen day's callbacks listed beside it. */
function CallbackCalendar({ callbacks, timezone, now, onNavigate }: { callbacks: LeadCallback[]; timezone: string; now: Date; onNavigate: (path: string) => void }): React.JSX.Element {
  const todayKey = organizationDayKey(now, timezone);
  const [todayYear = 1970, todayMonth = 1] = todayKey.split('-').map(Number);
  const [cursor, setCursor] = useState({ year: todayYear, month: todayMonth });
  const [selected, setSelected] = useState(todayKey);
  const byDay = useMemo(() => callbacksByDay(callbacks, timezone), [callbacks, timezone]);
  const weeks = monthGrid(cursor.year, cursor.month);
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(cursor.year, cursor.month - 1, 1)));
  const dayLabel = (key: string, style: 'long' | 'full' = 'full') => {
    const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
    return new Intl.DateTimeFormat(undefined, { dateStyle: style, timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)));
  };
  const move = (step: number) => setCursor((current) => shiftMonth(current.year, current.month, step));
  const goToday = () => { setCursor({ year: todayYear, month: todayMonth }); setSelected(todayKey); };
  const selectedItems = byDay.get(selected) ?? [];
  const inMonth = callbacks.filter((callback) => organizationDayKey(callback.scheduledAt, timezone).startsWith(`${cursor.year}-${String(cursor.month).padStart(2, '0')}`)).length;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-border px-4 py-3">
          <div>
            <h2 className="font-display text-lg font-bold">{monthLabel}</h2>
            <p className="text-xs text-app-muted">{inMonth === 1 ? '1 callback' : `${inMonth} callbacks`} this month</p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous month" className="rounded-lg border border-app-border p-2 hover:border-app-accent" onClick={() => move(-1)}><Icon name="chevron-left" className="size-4" /></button>
            <Button kind="secondary" className="px-3 py-1.5" onClick={goToday}>Today</Button>
            <button type="button" aria-label="Next month" className="rounded-lg border border-app-border p-2 hover:border-app-accent" onClick={() => move(1)}><Icon name="chevron-right" className="size-4" /></button>
          </div>
        </div>
        <div className="grid grid-cols-7 border-b border-app-border text-center text-[11px] font-bold uppercase tracking-wider text-app-muted">
          {WEEKDAYS.map((name) => <div key={name} className="py-2">{name}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {weeks.flat().map((day) => {
            const items = byDay.get(day.key) ?? [];
            const isToday = day.key === todayKey;
            const isSelected = day.key === selected;
            return (
              <button
                key={day.key}
                type="button"
                aria-pressed={isSelected}
                aria-label={`${dayLabel(day.key)}: ${items.length === 1 ? '1 callback' : `${items.length} callbacks`}`}
                onClick={() => setSelected(day.key)}
                className={`flex min-h-[4.5rem] min-w-0 flex-col items-stretch border-b border-r border-app-border p-1.5 text-left transition hover:bg-app-background md:min-h-[6.5rem] [&:nth-child(7n)]:border-r-0 ${day.inMonth ? '' : 'opacity-45'} ${isSelected ? 'bg-app-accent/10 ring-1 ring-inset ring-app-accent' : ''}`}
              >
                <span className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isToday ? 'bg-app-accent text-white' : ''}`}>{day.day}</span>
                {items.length > 0 && (
                  <span className="mt-1 inline-flex w-fit rounded-full bg-app-accent/15 px-1.5 text-[11px] font-bold text-app-accent md:hidden">{items.length}</span>
                )}
                <span className="mt-1 hidden min-w-0 space-y-1 md:block">
                  {items.slice(0, 3).map((callback) => (
                    <span key={callback.id} className={`block truncate rounded px-1.5 py-0.5 text-[11px] font-semibold ${toneClass(callback, now)}`}>
                      {timeOf(callback.scheduledAt, timezone)} {callback.leadContactName}
                    </span>
                  ))}
                  {items.length > 3 && <span className="block px-1.5 text-[11px] font-semibold text-app-muted">+{items.length - 3} more</span>}
                </span>
              </button>
            );
          })}
        </div>
      </Card>
      <Card>
        <h2 className="font-display text-lg font-bold">{dayLabel(selected)}</h2>
        <p className="mt-1 text-xs text-app-muted">{selectedItems.length === 0 ? 'No callbacks on this day.' : selectedItems.length === 1 ? '1 callback' : `${selectedItems.length} callbacks`}</p>
        <div className="mt-4 space-y-2">
          {selectedItems.map((callback) => (
            <button key={callback.id} type="button" onClick={() => onNavigate(`/company/sales/callbacks/${callback.id}`)} className="block w-full rounded-xl border border-app-border p-3 text-left text-sm transition hover:border-app-accent">
              <span className="flex items-center justify-between gap-2">
                <span className="font-bold">{timeOf(callback.scheduledAt, timezone)}</span>
                <StatusPill callback={callback} now={now} />
              </span>
              <span className="mt-1 block truncate font-semibold">{callback.leadContactName}</span>
              <span className="block truncate text-xs text-app-muted">Lead #{callback.leadNumber} · {callback.ownerName ?? 'Unknown owner'}</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

/** Callbacks in columns by status; the row scrolls sideways on narrow screens. */
function CallbackBoard({ callbacks, timezone, now, onNavigate }: { callbacks: LeadCallback[]; timezone: string; now: Date; onNavigate: (path: string) => void }): React.JSX.Element {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-2">
      <div className="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-4">
        {BOARD_COLUMNS.map((column) => {
          const items = callbacks.filter((callback) => callback.status === column);
          const visible = expanded[column] ? items : items.slice(0, BOARD_COLUMN_LIMIT);
          return (
            <section key={column} className="flex min-h-48 min-w-0 flex-col rounded-2xl border border-app-border bg-app-surface p-3">
              <header className="flex items-center justify-between gap-2 px-1 pb-2">
                <h2 className="font-display text-sm font-bold">{callbackStatusLabel(column)}</h2>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${TONE_CLASSES[column] ?? ''}`}>{items.length}</span>
              </header>
              <div className="space-y-2">
                {items.length === 0 && <p className="px-1 py-3 text-xs text-app-muted">Nothing here.</p>}
                {visible.map((callback) => (
                  <button key={callback.id} type="button" onClick={() => onNavigate(`/company/sales/callbacks/${callback.id}`)} className="block w-full rounded-xl border border-app-border bg-app-background/40 p-3 text-left text-xs transition hover:border-app-accent">
                    <span className="block truncate text-sm font-bold">{callback.leadContactName}</span>
                    <span className="mt-0.5 block text-app-muted">Lead #{callback.leadNumber}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold">{formatCallbackDate(callback.scheduledAt, timezone)}</span>
                      {isOverdueCallback(callback, now) && <span className={`rounded-full px-2 py-0.5 font-bold ${TONE_CLASSES['overdue']}`}>Overdue</span>}
                    </span>
                    <span className="mt-1 block truncate text-app-muted">{callback.ownerName ?? 'Unknown owner'}{callback.outcome ? ` · ${sentenceLabel(callback.outcome)}` : ''}</span>
                  </button>
                ))}
                {items.length > BOARD_COLUMN_LIMIT && (
                  <button type="button" className="w-full rounded-lg px-2 py-1.5 text-xs font-semibold text-app-accent hover:underline" onClick={() => setExpanded((current) => ({ ...current, [column]: !current[column] }))}>
                    {expanded[column] ? 'Show fewer' : `Show all ${items.length}`}
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleCallbackPage({ organizationTimezone, onBack, onCreated }: { organizationTimezone: string; onBack: () => void; onCreated: (id: string) => void }): React.JSX.Element {
  const [leads, setLeads] = useState<Lead[]>([]); const [leadId, setLeadId] = useState(''); const [scheduledAt, setScheduledAt] = useState(''); const [reason, setReason] = useState(''); const [error, setError] = useState('');
  useEffect(() => { void getLeads().then((page) => setLeads(page.items)).catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load Leads.')); }, []);
  const save = async () => { try { const callback = await createCallback({ leadId, scheduledAt: organizationLocalToIso(scheduledAt, organizationTimezone), reason: reason.trim() || undefined }); onCreated(callback.id); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to schedule callback.'); } };
  return <Page eyebrow="Sales" title="Schedule callback" description={`Times are interpreted in ${organizationTimezone}.`} action={<Button kind="secondary" onClick={onBack}>Back to callbacks</Button>}>{error && <p className="mb-4 text-sm text-app-danger">{error}</p>}<Card className="max-w-2xl"><div className="grid gap-4 md:grid-cols-2"><Select label="Lead" value={leadId} onChange={setLeadId} options={leads.map((lead) => ({ value: lead.id, label: `${lead.contactName} · #${lead.leadNumber}` }))} /><Field label="Date and time" value={scheduledAt} onChange={setScheduledAt} type="datetime-local" min={organizationNowLocal(organizationTimezone)} /><Field label="Reason" value={reason} onChange={setReason} /></div><div className="mt-5 flex justify-end"><Button disabled={!leadId || !scheduledAt} onClick={() => void save()}>Schedule</Button></div></Card></Page>;
}
