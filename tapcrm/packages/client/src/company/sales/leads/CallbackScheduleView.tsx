import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Icon, Page, SegmentedTabs, Select } from '../../../ui/index.js';
import { ErrorToast } from '../../../ui/ErrorToast.js';
import { useCompanyPageMetadata } from '../../layout/CompanyNavbarContext.js';
import { getAllCallbacks, type LeadCallback } from './api.js';
import {
  callbackOwnerOptions,
  callbackStatusLabel,
  isOverdueCallback,
  organizationDayKey,
  organizationLocalToIso,
  organizationNowLocal,
  sentenceLabel,
} from './callback-ui.js';

type RangeMode = 'day' | 'week';

function shiftDay(key: string, amount: number): string {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('-');
}

function mondayOf(key: string): string {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return shiftDay(key, -((weekday + 6) % 7));
}

function hourAt(value: string, timezone: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(value)));
}

function timeAt(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeStyle: 'short', timeZone: timezone }).format(new Date(value));
}

function dateAt(key: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(new Date(`${key}T00:00:00.000Z`));
}

function statusClass(callback: LeadCallback, now: Date): string {
  if (isOverdueCallback(callback, now) || callback.status === 'missed' || callback.status === 'cancelled')
    return 'callback-event callback-event-danger';
  if (callback.status === 'completed') return 'callback-event callback-event-complete';
  if (callback.status === 'not_reachable' || callback.status === 'rescheduled') return 'callback-event callback-event-warning';
  return 'callback-event callback-event-pending';
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase() || '?';
}

export function CallbackScheduleView({ canSchedule, organizationTimezone, onNavigate }: { canSchedule: boolean; organizationTimezone: string; onNavigate: (path: string) => void }): React.JSX.Element {
  const pageMetadata = useMemo(() => ({
    eyebrow: 'Sales',
    title: 'Callbacks',
    description: `Plan and track scheduled sales follow-ups in ${organizationTimezone}.`,
  }), [organizationTimezone]);
  useCompanyPageMetadata(pageMetadata);
  const [day, setDay] = useState(() => organizationDayKey(new Date(), organizationTimezone));
  const [mode, setMode] = useState<RangeMode>('day');
  const [ownerId, setOwnerId] = useState('');
  const [callbacks, setCallbacks] = useState<LeadCallback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const localNow = organizationNowLocal(organizationTimezone, now);
  const start = mode === 'day' ? day : mondayOf(day);
  const end = shiftDay(start, mode === 'day' ? 1 : 7);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setCallbacks([]);
    getAllCallbacks({
      from: organizationLocalToIso(`${start}T00:00`, organizationTimezone),
      to: organizationLocalToIso(`${end}T00:00`, organizationTimezone),
    }).then((rows) => {
      if (!active) return;
      setCallbacks(rows);
      setError('');
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Unable to load callbacks.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [start, end, organizationTimezone]);

  const owners = useMemo(() => callbackOwnerOptions(callbacks), [callbacks]);
  const shown = useMemo(() => ownerId ? callbacks.filter((callback) => callback.ownerId === ownerId) : callbacks, [callbacks, ownerId]);
  const agents = useMemo(() => callbackOwnerOptions(shown), [shown]);
  const laneAgents = agents.length ? agents : [{ value: '', label: 'No assigned callbacks' }];
  const modeItems = [
    { id: 'day', label: 'Day' },
    { id: 'week', label: 'Week' },
  ];
  const today = organizationDayKey(now, organizationTimezone);
  const dateTitle = mode === 'day'
    ? dateAt(day, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : `${dateAt(start, { day: 'numeric', month: 'short' })} – ${dateAt(shiftDay(end, -1), { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const rangeDays = Array.from({ length: 7 }, (_, index) => shiftDay(start, index));
  const hours = useMemo(() => {
    const values = shown.map((callback) => hourAt(callback.scheduledAt, organizationTimezone));
    const first = Math.min(9, ...values);
    const last = Math.max(17, ...values);
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  }, [shown, organizationTimezone]);

  const step = mode === 'day' ? 1 : 7;
  const move = (direction: number) => { setOwnerId(''); setDay((current) => shiftDay(current, direction * step)); };
  const openCallback = (callback: LeadCallback) => onNavigate(`/company/sales/callbacks/${callback.id}`);
  const schedule = (date = '') => {
    const query = date ? `?at=${encodeURIComponent(date)}` : '';
    onNavigate(`/company/sales/callbacks/schedule${query}`);
  };
  const hourNow = Number(localNow.slice(11, 13));
  const minuteNow = Number(localNow.slice(14, 16));

  return (
    <Page
      eyebrow="Sales"
      title="Callbacks"
      description={`Scheduled follow-ups · ${organizationTimezone}`}
      action={canSchedule && <Button onClick={() => schedule()}><Icon name="calendar-plus" className="size-4" /> Schedule callback</Button>}
    >
      {error && <ErrorToast message={error} />}
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-app-accent/10 text-app-accent"><Icon name="calendar" className="size-5" /></span>
        <strong className="font-display text-3xl tracking-tight">{loading ? '—' : callbacks.length}</strong>
        <span className="text-sm text-app-muted">callbacks in view</span>
      </div>

      <section className="callback-schedule-toolbar" aria-label="Calendar controls">
        <div className="flex flex-wrap items-center gap-2">
          <Button kind="secondary" onClick={() => { setOwnerId(''); setDay(today); }}>Today</Button>
          <button type="button" aria-label="Previous date range" className="callback-nav-button" onClick={() => move(-1)}><Icon name="chevron-left" className="size-4" /></button>
          <button type="button" aria-label="Next date range" className="callback-nav-button" onClick={() => move(1)}><Icon name="chevron-right" className="size-4" /></button>
          <h2 className="min-w-44 px-2 font-display text-lg font-bold">{dateTitle}</h2>
          <SegmentedTabs ariaLabel="Callback date range" items={modeItems} value={mode} onChange={(value) => { setOwnerId(''); setMode(value as RangeMode); }} density="compact" />
        </div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-48">
            <Select label="Agent" value={ownerId} onChange={setOwnerId} placeholder={`All Agents (${owners.length})`} options={owners} />
          </div>
          <nav aria-label="Other callback views" className="flex items-center gap-3 text-xs font-semibold">
            <button type="button" className="text-app-accent hover:underline" onClick={() => onNavigate('/company/sales/callbacks/list')}>List</button>
            <button type="button" className="text-app-muted hover:text-app-foreground" onClick={() => onNavigate('/company/sales/callbacks/calendar')}>Month</button>
            <button type="button" className="text-app-muted hover:text-app-foreground" onClick={() => onNavigate('/company/sales/callbacks/board')}>Board</button>
          </nav>
        </div>
      </section>

      {loading && callbacks.length === 0 ? <Card><p className="text-sm text-app-muted">Loading callbacks…</p></Card> : mode === 'day' ? (
        <Card className="callback-schedule-card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <div className="callback-day-grid" style={{ gridTemplateColumns: `5.25rem repeat(${laneAgents.length}, minmax(15rem, 1fr))` }}>
            <div className="callback-agent-heading callback-timezone-heading"><span>Time</span><span>{organizationTimezone}</span></div>
            {laneAgents.map((agent) => {
              const count = shown.filter((callback) => callback.ownerId === agent.value).length;
              return <div className="callback-agent-heading" key={agent.value || 'none'}>
                {agent.value ? <span className="callback-agent-avatar">{initials(agent.label)}</span> : null}
                <span className="min-w-0"><strong className="block truncate">{agent.label}</strong><small>{count} {count === 1 ? 'callback' : 'callbacks'}</small></span>
              </div>;
            })}
            {hours.map((hour) => {
              const slotAt = `${day}T${String(hour).padStart(2, '0')}:00`;
              return <div key={hour} className="callback-hour-row">
              {day === today && hour === hourNow && (
                <div className="callback-now" style={{ top: `${(minuteNow / 60) * 100}%` }}>
                  <time dateTime={now.toISOString()}>{timeAt(now.toISOString(), organizationTimezone)}</time>
                </div>
              )}
              <div className="callback-time-cell">{hour % 12 || 12}{hour < 12 ? 'am' : 'pm'}</div>
              {laneAgents.map((agent) => {
                const events = shown.filter((callback) => callback.ownerId === agent.value && hourAt(callback.scheduledAt, organizationTimezone) === hour);
                return <div className="callback-slot" key={`${agent.value}-${hour}`}>
                  {events.map((callback) => (
                    <button type="button" key={callback.id} className={statusClass(callback, now)} onClick={() => openCallback(callback)}>
                      <span className="callback-event-heading"><span className="callback-event-icon"><Icon name={callback.status === 'completed' ? 'check' : 'clock'} className="size-4" /></span><strong className="min-w-0 flex-1 break-words">{callback.leadContactName}</strong><span className="callback-event-status">{isOverdueCallback(callback, now) ? 'Overdue' : callbackStatusLabel(callback.status)}</span></span>
                      <span className="callback-event-time">{timeAt(callback.scheduledAt, organizationTimezone)}</span>
                      {callback.reason && <span className="callback-event-reason">{callback.reason}</span>}
                    </button>
                  ))}
                  {canSchedule && events.length === 0 && slotAt >= localNow && <button type="button" className="callback-empty-slot" onClick={() => schedule(slotAt)} aria-label={`Schedule a callback at ${hour}:00`}><Icon name="plus" className="size-4" /></button>}
                </div>;
              })}
            </div>;
            })}
            </div>
          </div>
        </Card>
      ) : (
        <div className="callback-week-grid">
          {rangeDays.map((key) => {
            const dayCallbacks = shown.filter((callback) => organizationDayKey(callback.scheduledAt, organizationTimezone) === key);
            return <Card className="callback-week-day" key={key}>
              <header className="border-b border-app-border pb-3">
                <h3 className="font-display font-bold">{dateAt(key, { weekday: 'long' })}</h3>
                <p className="mt-0.5 text-xs text-app-muted">{dateAt(key, { day: 'numeric', month: 'short' })} · {dayCallbacks.length} {dayCallbacks.length === 1 ? 'callback' : 'callbacks'}</p>
              </header>
              <div className="mt-3 space-y-2">
                {dayCallbacks.map((callback) => (
                  <button type="button" key={callback.id} className={`${statusClass(callback, now)} w-full`} onClick={() => openCallback(callback)}>
                    <strong className="block truncate">{callback.leadContactName}</strong>
                    <span className="mt-1 block">{timeAt(callback.scheduledAt, organizationTimezone)}</span>
                    <span className="mt-1 block truncate text-xs">{callback.ownerName ?? 'Unknown agent'} · {sentenceLabel(callback.status)}</span>
                  </button>
                ))}
                {dayCallbacks.length === 0 && <p className="py-4 text-center text-xs text-app-muted">No callbacks</p>}
              </div>
              {canSchedule && key >= today && <Button kind="secondary" className="mt-3 w-full" onClick={() => schedule(`${key}T09:00` >= localNow ? `${key}T09:00` : localNow)}><Icon name="plus" className="size-4" /> Add callback</Button>}
            </Card>;
          })}
        </div>
      )}
    </Page>
  );
}
