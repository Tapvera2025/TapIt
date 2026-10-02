import { useEffect, useState } from 'react';
import { Icon } from '../../../ui/Icon.js';
import { getMySessions, type IdentitySession } from '../../../identity/api/sessionsApi.js';
import { loadTodayStatus, type TodayStatus } from '../../live/liveApi.js';
import { getMyShiftAssignment, type ShiftAssignment } from '../../api/shiftsApi.js';
import { listTasks } from '../../tasks/api/tasksApi.js';
import type { Task } from '../../tasks/types/index.js';
import { listLeaves, getLeaveBalances, type LeaveBalanceDto, type LeaveRequestSummary } from '../../api/leaveApi.js';
import { listHolidays, type Holiday } from '../../api/holidaysApi.js';
import type { WidgetContext } from '../widget-types.js';

function Panel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex h-full flex-col overflow-hidden">{children}</div>;
}

function Empty({ icon, text }: { icon?: string; text: string }): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-app-muted">
      {icon && (
        <span className="rounded-full bg-app-surface/60 p-2 opacity-60">
          <Icon name={icon} className="size-4" />
        </span>
      )}
      <span className="text-xs">{text}</span>
    </div>
  );
}

function Loading(): React.JSX.Element {
  return <div className="flex-1 animate-pulse rounded-lg bg-app-surface/60" />;
}

/* ------------------------------------------------------------------ Punch */

export function PunchStateWidget(): React.JSX.Element {
  const [status, setStatus] = useState<TodayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    loadTodayStatus(controller.signal)
      .then((s) => setStatus(s))
      .catch(() => setError('Unable to load today'))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  if (loading) return <Panel><Loading /></Panel>;
  if (error) return <Panel><Empty text={error} /></Panel>;

  const row = status?.row ?? null;
  const state = row?.state ?? 'NOT_IN';
  const worked = row?.workedMinutes ?? 0;
  const hours = Math.floor(worked / 60);
  const minutes = worked % 60;
  const stateLabel: Record<string, string> = {
    WORKING: 'Working',
    ON_BREAK: 'On break',
    FINISHED: 'Finished',
    NOT_IN: 'Not punched in',
  };

  return (
    <Panel>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-app-muted">Today</p>
        <span className="rounded-lg bg-app-accent/10 p-2 text-app-accent">
          <Icon name="clock" />
        </span>
      </div>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{hours}h {minutes}m</p>
      <p className="mt-2 text-xs text-app-muted">{stateLabel[state] ?? state}</p>
    </Panel>
  );
}

/* ------------------------------------------------------------------ Shift */

export function TodaysShiftWidget(): React.JSX.Element {
  const [shifts, setShifts] = useState<ShiftAssignment[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    getMyShiftAssignment(controller.signal)
      .then((s) => setShifts(s))
      .catch(() => setShifts([]))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  if (loading) return <Panel><Loading /></Panel>;
  const first = shifts?.[0];
  if (!first) {
    return (
      <Panel>
        <p className="text-sm text-app-muted">Today's shift</p>
        <Empty icon="calendar" text="No shift assigned" />
      </Panel>
    );
  }
  return (
    <Panel>
      <p className="text-sm text-app-muted">Today's shift</p>
      <p className="mt-1 text-lg font-semibold">{first.shiftName ?? first.shiftCode ?? 'Assigned'}</p>
      {first.effectiveFrom && (
        <p className="mt-2 text-xs text-app-muted">Since {new Date(first.effectiveFrom).toLocaleDateString()}</p>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ Tasks */

export function MyTasksWidget({ ctx }: { ctx: WidgetContext }): React.JSX.Element {
  const [tasks, setTasks] = useState<readonly Task[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listTasks({ assigneeId: ctx.userId, status: 'pending', sortBy: 'dueDate', sortOrder: 'asc', pageSize: 5 })
      .then((r) => setTasks(r.items))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, [ctx.userId]);

  if (loading) return <Panel><Loading /></Panel>;
  if (!tasks?.length) {
    return (
      <Panel>
        <p className="text-sm text-app-muted">My open tasks</p>
        <Empty icon="check" text="No open tasks" />
      </Panel>
    );
  }
  return (
    <Panel>
      <div className="flex items-center justify-between">
        <p className="text-sm text-app-muted">My open tasks</p>
        <button type="button" className="text-xs font-semibold text-app-accent hover:underline" onClick={() => ctx.onNavigate('/company/tasks')}>
          View all →
        </button>
      </div>
      <ul className="mt-3 flex-1 space-y-2 overflow-auto pr-1">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-start justify-between gap-2 rounded-lg border border-app-border bg-app-background/40 p-2 text-xs">
            <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
            {task.dueDate && (
              <span className="shrink-0 text-app-muted">{new Date(task.dueDate).toLocaleDateString()}</span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ------------------------------------------------------------------- Leave */

export function MyLeaveWidget({ ctx }: { ctx: WidgetContext }): React.JSX.Element {
  const [balances, setBalances] = useState<LeaveBalanceDto[] | null>(null);
  const [pending, setPending] = useState<LeaveRequestSummary[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const year = new Date().getFullYear();
    void Promise.allSettled([
      getLeaveBalances(ctx.userId, year),
      listLeaves({ userId: ctx.userId, status: 'pending' }),
    ]).then(([b, p]) => {
      if (b.status === 'fulfilled') setBalances(b.value);
      else setBalances([]);
      if (p.status === 'fulfilled') setPending(p.value);
      else setPending([]);
      setLoading(false);
    });
  }, [ctx.userId]);

  if (loading) return <Panel><Loading /></Panel>;
  const totalAvailable = balances?.reduce((sum, item) => sum + item.available, 0) ?? 0;
  const pendingCount = pending?.length ?? 0;

  return (
    <Panel>
      <div className="flex items-center justify-between">
        <p className="text-sm text-app-muted">My leave</p>
        <button type="button" className="text-xs font-semibold text-app-accent hover:underline" onClick={() => ctx.onNavigate('/company/leave/my')}>
          View →
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-app-border bg-app-background/40 p-3">
          <p className="text-xs text-app-muted">Available</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{totalAvailable.toFixed(1)}</p>
        </div>
        <div className="rounded-lg border border-app-border bg-app-background/40 p-3">
          <p className="text-xs text-app-muted">Pending</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{pendingCount}</p>
        </div>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- Holidays */

export function UpcomingHolidaysWidget(): React.JSX.Element {
  const [holidays, setHolidays] = useState<Holiday[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const from = new Date().toISOString().slice(0, 10);
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 60);
    const to = toDate.toISOString().slice(0, 10);
    listHolidays({ from, to })
      .then((r) => setHolidays(r.holidays.filter((h) => h.holidayDate).slice(0, 5)))
      .catch(() => setHolidays([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Panel><Loading /></Panel>;
  if (!holidays?.length) {
    return (
      <Panel>
        <p className="text-sm text-app-muted">Upcoming holidays</p>
        <Empty icon="calendar" text="No holidays coming up" />
      </Panel>
    );
  }
  return (
    <Panel>
      <p className="text-sm text-app-muted">Upcoming holidays</p>
      <ul className="mt-3 flex-1 space-y-2 overflow-auto pr-1 text-xs">
        {holidays.map((holiday) => (
          <li key={holiday.id} className="flex items-center justify-between gap-2 rounded-lg border border-app-border bg-app-background/40 p-2">
            <span className="min-w-0 flex-1 truncate font-medium">{holiday.name}</span>
            <span className="shrink-0 text-app-muted">
              {holiday.holidayDate ? new Date(holiday.holidayDate).toLocaleDateString() : '—'}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ---------------------------------------------------------------- Sessions */

export function MySessionsWidget({ ctx }: { ctx: WidgetContext }): React.JSX.Element {
  const [sessions, setSessions] = useState<IdentitySession[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMySessions()
      .then((s) => setSessions(s))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Panel><Loading /></Panel>;
  return (
    <Panel>
      <div className="flex items-center justify-between">
        <p className="text-sm text-app-muted">Sessions & devices</p>
        <button type="button" className="text-xs font-semibold text-app-accent hover:underline" onClick={() => ctx.onNavigate('/company/sessions')}>
          View →
        </button>
      </div>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{sessions?.length ?? 0}</p>
      <p className="mt-2 text-xs text-app-muted">Active sessions</p>
    </Panel>
  );
}
