import { useEffect, useState } from 'react';
import { Icon } from '../../../ui/Icon.js';
import { getMySessions, revokeMySession, signOutLocally, type IdentitySession } from '../../../identity/api/sessionsApi.js';
import { loadTodayStatus, punch, type PunchKind, type TodayStatus } from '../../live/liveApi.js';
import { getMyShiftAssignment, type ShiftAssignment } from '../../api/shiftsApi.js';
import { listTasks, transitionTask } from '../../tasks/api/tasksApi.js';
import type { Task, TaskStatus } from '../../tasks/types/index.js';
import { listLeaves, getLeaveBalances, type LeaveBalanceDto, type LeaveRequestSummary } from '../../api/leaveApi.js';
import { listHolidays, type Holiday } from '../../api/holidaysApi.js';
import type { WidgetContext } from '../widget-types.js';

const ATTENDANCE_UPDATED_EVENT = 'tapcrm:attendance-updated';

function notifyAttendanceUpdated(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ATTENDANCE_UPDATED_EVENT));
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <div className={`dashboard-widget-shell flex h-full min-h-0 w-full flex-col gap-3 overflow-x-hidden overflow-y-auto ${className}`}>{children}</div>;
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

function holidayDateParts(value: string): { day: string; month: string; weekday: string } {
  const date = new Date(`${value}T12:00:00Z`);
  return {
    day: new Intl.DateTimeFormat('en-IN', { day: '2-digit', timeZone: 'UTC' }).format(date),
    month: new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(date),
    weekday: new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' }).format(date),
  };
}

function taskStatusForUser(task: Task, userId: string): TaskStatus {
  return task.assignees.find((assignee) => assignee.id === userId)?.status ?? task.status;
}

type TaskFilter = 'all' | 'pending' | 'in_progress';

function TaskProgressGraph({
  tasks,
  userId,
  filter,
  onFilterChange,
}: {
  tasks: readonly Task[];
  userId: string;
  filter: TaskFilter;
  onFilterChange: (nextFilter: TaskFilter) => void;
}): React.JSX.Element {
  const pending = tasks.filter((task) => taskStatusForUser(task, userId) === 'pending').length;
  const inProgress = tasks.filter((task) => taskStatusForUser(task, userId) === 'in_progress').length;
  const total = tasks.length;
  const movingPercent = total ? Math.round((inProgress / total) * 100) : 0;
  const pendingPercent = total ? 100 - movingPercent : 0;

  return (
    <div className="dashboard-task-progress relative min-w-0 overflow-hidden rounded-[1.35rem] border border-app-border/80 bg-app-surface/55 p-3 backdrop-blur-xl sm:p-4">
      <div className="pointer-events-none absolute -right-10 -top-12 size-32 rounded-full bg-app-accent/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-14 left-8 size-28 rounded-full bg-app-accent/10 blur-3xl" />
      <div className="relative flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-app-accent">Task pulse</p>
          <p className="mt-1 text-sm font-semibold">Your open-work flow</p>
        </div>
        <span className="rounded-full border border-app-border/80 bg-app-background/35 px-2.5 py-1 text-[10px] font-semibold text-app-muted">
          {total} open
        </span>
      </div>

      <div className="dashboard-task-progress-rail relative mt-4 min-w-0">
        <div className="flex h-3 min-w-0 gap-1 overflow-hidden rounded-full border border-app-border/70 bg-app-background/35 p-0.5" role="img" aria-label={`${inProgress} tasks in progress and ${pending} pending`}>
          {inProgress > 0 && <span style={{ width: `${movingPercent}%` }} className="min-w-[0.35rem] rounded-full bg-app-accent shadow-[0_0_14px_var(--app-accent)] transition-[width] duration-500" />}
          {pending > 0 && <span style={{ width: `${pendingPercent}%` }} className="min-w-[0.35rem] rounded-full bg-app-accent/25 transition-[width] duration-500" />}
          {total === 0 && <span className="w-full rounded-full bg-app-border/70" />}
        </div>
        <div className="mt-2 flex min-w-0 items-start justify-between gap-3 text-[10px] text-app-muted">
          <span className="flex min-w-0 items-center gap-1.5"><span className="size-2 shrink-0 rounded-full bg-app-accent" /> <span className="truncate">Moving {inProgress}</span></span>
          <span className="flex min-w-0 items-center gap-1.5"><span className="size-2 shrink-0 rounded-full bg-app-accent/30" /> <span className="truncate">Pending {pending}</span></span>
        </div>
      </div>

      <div className="relative mt-3 flex gap-1 rounded-full border border-app-border/60 bg-app-background/25 p-1">
        {(['all', 'in_progress', 'pending'] as const).map((option) => (
          <button key={option} type="button" aria-pressed={filter === option} onClick={() => onFilterChange(option)} className={`min-w-0 flex-1 truncate rounded-full px-2 py-1 text-[10px] font-semibold capitalize transition ${filter === option ? 'bg-app-accent text-app-on-accent shadow-sm' : 'text-app-muted hover:text-app-foreground'}`}>
            {option === 'in_progress' ? 'Moving' : option}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Punch */

export function PunchStateWidget(): React.JSX.Element {
  const [status, setStatus] = useState<TodayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [punchBusy, setPunchBusy] = useState<PunchKind | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    setLoading(true);
    const controller = new AbortController();
    // A request cancelled because the widget went away is not a failure.
    loadTodayStatus(controller.signal)
      .then((s) => setStatus(s))
      .catch((err: unknown) => {
        // React may clean up and restart this effect (for example in
        // StrictMode). An intentional AbortController cancellation is not a
        // failed attendance request and must never be shown to the user.
        if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
        setError(err instanceof Error ? err.message : 'Attendance data is temporarily unavailable');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshVersion]);

  useEffect(() => {
    const refresh = () => setRefreshVersion((version) => version + 1);
    window.addEventListener(ATTENDANCE_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(ATTENDANCE_UPDATED_EVENT, refresh);
  }, []);

  const handlePunch = async (kind: PunchKind): Promise<void> => {
    setPunchBusy(kind);
    setError('');
    try {
      await punch(kind);
      notifyAttendanceUpdated();
      setRefreshVersion((version) => version + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update attendance.');
    } finally {
      setPunchBusy(null);
    }
  };

  if (loading) return <Panel><Loading /></Panel>;
  if (error) {
    return (
      <Panel>
        <div className="flex h-full flex-col justify-between gap-4 rounded-2xl border border-app-border bg-app-surface/50 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-app-muted">Today</p>
            <span className="rounded-lg bg-app-accent/10 p-2 text-app-accent"><Icon name="clock" /></span>
          </div>
          <div>
            <p className="text-lg font-semibold">Attendance unavailable</p>
            <p className="mt-1 text-xs text-app-muted">Your Today page remains available for attendance details.</p>
          </div>
        </div>
      </Panel>
    );
  }

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
  const allowedMoves = status?.allowedMoves ?? [];
  const canPunchIn = allowedMoves.includes('in');
  const canPunchOut = allowedMoves.includes('out');
  const breakKind: PunchKind = state === 'ON_BREAK' ? 'break-end' : 'break-start';
  const canBreak = allowedMoves.includes(breakKind);

  return (
    <Panel className="dashboard-punch-panel">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-app-muted">Today</p>
        <span className="rounded-lg bg-app-accent/10 p-2 text-app-accent">
          <Icon name="clock" />
        </span>
      </div>
      <p className="dashboard-punch-time mt-1 text-3xl font-semibold tabular-nums">{hours}h {minutes}m</p>
      <p className="dashboard-punch-state mt-2 text-xs text-app-muted">{stateLabel[state] ?? state}</p>
      <div className="dashboard-punch-actions mt-3" aria-label="Attendance actions">
        <button type="button" disabled={!canPunchIn || punchBusy !== null} onClick={() => void handlePunch('in')} className="dashboard-punch-action dashboard-punch-action-primary">
          {punchBusy === 'in' ? 'Punching in…' : 'Punch In'}
        </button>
        <button type="button" disabled={!canPunchOut || punchBusy !== null} onClick={() => void handlePunch('out')} className="dashboard-punch-action">
          {punchBusy === 'out' ? 'Punching out…' : 'Punch Out'}
        </button>
        <button type="button" disabled={!canBreak || punchBusy !== null} onClick={() => void handlePunch(breakKind)} className="dashboard-punch-action">
          {punchBusy === breakKind ? (breakKind === 'break-start' ? 'Starting…' : 'Ending…') : breakKind === 'break-start' ? 'Start Break' : 'End Break'}
        </button>
      </div>
      {error && <p className="text-xs text-app-danger" role="alert">{error}</p>}
    </Panel>
  );
}

/* ------------------------------------------------------------------ Break management */

type BreakPreset = {
  label: string;
  description: string;
  icon: string;
};

const BREAK_PRESETS: readonly BreakPreset[] = [
  { label: 'Lunch', description: 'Meal break', icon: 'coffee' },
  { label: 'Coffee', description: 'Quick reset', icon: 'coffee' },
  { label: 'Personal', description: 'Personal time', icon: 'user' },
];

export function BreakManagementWidget(): React.JSX.Element {
  const [status, setStatus] = useState<TodayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    setLoading(true);
    const controller = new AbortController();
    loadTodayStatus(controller.signal)
      .then(setStatus)
      .catch((cause: unknown) => {
        if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        setError(cause instanceof Error ? cause.message : 'Unable to load break status.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshVersion]);

  useEffect(() => {
    const refresh = () => setRefreshVersion((version) => version + 1);
    window.addEventListener(ATTENDANCE_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(ATTENDANCE_UPDATED_EVENT, refresh);
  }, []);

  const row = status?.row ?? null;
  const onBreak = row?.state === 'ON_BREAK';
  const canStartBreak = status?.allowedMoves.includes('break-start') ?? false;
  const canEndBreak = status?.allowedMoves.includes('break-end') ?? false;

  const handleBreak = async (kind: PunchKind): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await punch(kind);
      notifyAttendanceUpdated();
      setRefreshVersion((version) => version + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update break status.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Panel><Loading /></Panel>;

  return (
    <Panel className="dashboard-break-panel">
      <div className="dashboard-break-heading min-w-0">
        <span className="dashboard-break-icon rounded-xl bg-amber-500/10 p-3 text-amber-600 dark:text-amber-300">
          <Icon name="coffee" className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">Break management</p>
          <p className="truncate text-xs text-app-muted">{onBreak ? 'Break in progress' : 'Choose a break type when you need to reset.'}</p>
        </div>
      </div>

      {onBreak ? (
        <div className="dashboard-break-active min-w-0">
          <span className="dashboard-break-status"><span className="size-2 shrink-0 rounded-full bg-amber-500" /> Active break</span>
          <button type="button" disabled={!canEndBreak || busy} onClick={() => void handleBreak('break-end')} className="dashboard-break-resume">
            {busy ? 'Resuming…' : 'Resume work'}
          </button>
        </div>
      ) : (
        <div className="dashboard-break-presets" aria-label="Preset breaks">
          {BREAK_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={!canStartBreak || busy}
              onClick={() => void handleBreak('break-start')}
              className="dashboard-break-preset"
            >
              <Icon name={preset.icon} className="size-5 shrink-0" />
              <span className="min-w-0 text-left">
                <span className="block truncate text-sm font-semibold">{preset.label}</span>
                <span className="block truncate text-[11px] text-app-muted">{preset.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-app-danger" role="alert">{error}</p>}
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
      .catch(() => {
        if (!controller.signal.aborted) setShifts([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
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
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all');

  useEffect(() => {
    // The task API has a global task status and a per-assignee status. Load
    // the assigned set without filtering by the global status, then filter by
    // this user's assignment status below.
    listTasks({ assigneeId: ctx.userId, status: 'all', sortBy: 'dueDate', sortOrder: 'asc', pageSize: 20 })
      .then((r) => setTasks(r.items.filter((task) => {
        const status = taskStatusForUser(task, ctx.userId);
        return status === 'pending' || status === 'in_progress';
      }).slice(0, 5)))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, [ctx.userId]);

  async function changeTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    setUpdatingTaskId(taskId);
    setError(null);
    try {
      await transitionTask(taskId, { status, userId: ctx.userId });
      setTasks((current) => {
        if (!current) return [];
        if (status === 'completed' || status === 'cancelled') return current.filter((task) => task.id !== taskId);
        return current.map((task) => task.id === taskId
          ? { ...task, assignees: task.assignees.map((assignee) => assignee.id === ctx.userId ? { ...assignee, status } : assignee) }
          : task);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update task status.');
    } finally {
      setUpdatingTaskId(null);
    }
  }

  if (loading) return <Panel><Loading /></Panel>;
  if (!tasks?.length) {
    return (
      <Panel>
        <div className="flex items-center justify-between gap-3"><p className="text-sm text-app-muted">My open tasks</p><button type="button" className="text-xs font-semibold text-app-accent hover:underline" onClick={() => ctx.onNavigate('/company/tasks')}>View all →</button></div>
        <Empty icon="check" text="No open tasks" />
      </Panel>
    );
  }
  const visibleTasks = taskFilter === 'all'
    ? tasks
    : tasks.filter((task) => taskStatusForUser(task, ctx.userId) === taskFilter);

  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm text-app-muted">My open tasks</p><p className="mt-1 text-lg font-semibold tracking-tight">Move work forward</p></div>
        <button type="button" className="text-xs font-semibold text-app-accent hover:underline" onClick={() => ctx.onNavigate('/company/tasks')}>
          View all →
        </button>
      </div>
      {error && <p role="alert" className="rounded-xl border border-app-danger/25 bg-app-danger/10 px-3 py-2 text-xs text-app-danger">{error}</p>}
      <TaskProgressGraph tasks={tasks} userId={ctx.userId} filter={taskFilter} onFilterChange={setTaskFilter} />
      <ul className="mt-1 min-h-0 flex-1 space-y-2 overflow-auto pr-1">
        {visibleTasks.map((task) => (
          <li key={task.id} className="group min-w-0 rounded-2xl border border-app-border bg-app-background/35 p-3 transition hover:border-app-accent/40 hover:bg-app-accent/5">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-app-accent" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{task.title}</p><div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-app-muted"><span className="capitalize">{task.priority}</span>{task.dueDate && <span>Due {new Date(task.dueDate).toLocaleDateString()}</span>}</div></div>
              <select value={taskStatusForUser(task, ctx.userId)} disabled={updatingTaskId === task.id} onChange={(event) => void changeTaskStatus(task.id, event.target.value as TaskStatus)} aria-label={`Change status for ${task.title}`} className="max-w-28 shrink-0 rounded-lg border border-app-border bg-app-surface px-2 py-1.5 text-[11px] font-semibold outline-none focus:border-app-accent disabled:opacity-60"><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>
            </div>
          </li>
        ))}
      </ul>
      {!visibleTasks.length && <p className="rounded-xl border border-dashed border-app-border px-3 py-3 text-center text-xs text-app-muted">No {taskFilter === 'in_progress' ? 'moving' : taskFilter} tasks right now.</p>}
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
      <div className="relative overflow-hidden rounded-2xl border border-app-accent/20 bg-gradient-to-br from-app-accent/10 via-app-surface to-app-surface px-4 py-4 sm:px-5">
        <div className="pointer-events-none absolute -right-8 -top-10 size-28 rounded-full bg-app-accent/10 blur-2xl" />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-app-accent">
              <span className="grid size-8 place-items-center rounded-xl bg-app-accent/15"><Icon name="calendar" className="size-4" /></span>
              <span className="text-[11px] font-bold uppercase tracking-[0.16em]">Calendar moments</span>
            </div>
            <h3 className="mt-3 text-lg font-semibold tracking-tight">Upcoming holidays</h3>
            <p className="mt-1 text-xs text-app-muted">A quick look at your next days off</p>
          </div>
          <span className="shrink-0 rounded-full border border-app-accent/20 bg-app-surface/80 px-2.5 py-1 text-xs font-semibold text-app-accent">{holidays.length} planned</span>
        </div>
      </div>
      <ul className="mt-3 grid gap-2 overflow-auto pr-1 text-xs sm:grid-cols-2">
        {holidays.map((holiday) => (
          <li key={holiday.id} className="group flex min-w-0 items-center gap-3 rounded-2xl border border-app-border bg-app-background/35 p-2.5 transition hover:border-app-accent/40 hover:bg-app-accent/5">
            {holiday.holidayDate && (() => {
              const parts = holidayDateParts(holiday.holidayDate);
              return <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-app-accent text-center text-app-on-accent shadow-sm"><span className="text-[10px] font-semibold uppercase leading-none">{parts.month}</span><span className="mt-0.5 text-base font-bold leading-none">{parts.day}</span></span>;
            })()}
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-app-foreground">{holiday.name}</span><span className="mt-1 block text-[11px] text-app-muted">{holiday.holidayDate ? holidayDateParts(holiday.holidayDate).weekday : 'Date to be announced'}</span></span>
            <Icon name="chevron-right" className="size-4 shrink-0 text-app-muted/60 transition group-hover:translate-x-0.5 group-hover:text-app-accent" />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ---------------------------------------------------------------- Sessions */

function sessionDevice(session: IdentitySession): { name: string; icon: string } {
  const agent = session.userAgent ?? '';
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(agent)) return { name: 'Tablet', icon: 'tablet' };
  if (/iPhone|Android.*Mobile|Mobile/i.test(agent)) return { name: 'Mobile', icon: 'smartphone' };
  if (/Macintosh|Windows|Linux/i.test(agent)) return { name: 'Desktop browser', icon: 'monitor' };
  return { name: session.deviceLabel?.trim() || 'Web browser', icon: 'monitor' };
}

function sessionActivity(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'Active just now';
  if (minutes < 60) return `Active ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `Active ${hours}h ago` : `Active ${Math.round(hours / 24)}d ago`;
}

export function MySessionsWidget({ ctx }: { ctx: WidgetContext }): React.JSX.Element {
  const [sessions, setSessions] = useState<IdentitySession[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMySessions()
      .then((s) => setSessions(s))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  async function signOutSession(session: IdentitySession): Promise<void> {
    setBusySessionId(session.id);
    setError(null);
    try {
      const result = await revokeMySession(session.id);
      if (result.current) {
        signOutLocally();
        window.location.reload();
        return;
      }
      setSessions((current) => current?.filter((item) => item.id !== session.id) ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign out this device.');
    } finally {
      setBusySessionId(null);
    }
  }

  if (loading) return <Panel><Loading /></Panel>;
  const activeSessions = sessions ?? [];
  return (
    <Panel>
      <div className="dashboard-sessions-header flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-app-accent">Account presence</p>
          <p className="mt-1 text-lg font-semibold tracking-tight">Sessions & devices</p>
          <p className="mt-1 text-xs text-app-muted">{activeSessions.length} active {activeSessions.length === 1 ? 'login' : 'logins'}</p>
        </div>
        <button type="button" className="shrink-0 text-xs font-semibold text-app-accent hover:underline" onClick={() => ctx.onNavigate('/company/sessions')}>
          Manage →
        </button>
      </div>
      {error && <p role="alert" className="rounded-xl border border-app-danger/25 bg-app-danger/10 px-3 py-2 text-xs text-app-danger">{error}</p>}
      <div className="dashboard-session-list min-h-0 flex-1 space-y-2 overflow-auto pr-1">
        {activeSessions.slice(0, 4).map((session) => {
          const device = sessionDevice(session);
          return (
            <div key={session.id} className={`group flex min-w-0 items-center gap-3 rounded-2xl border bg-app-surface/45 p-3 backdrop-blur-sm transition ${session.current ? 'border-app-accent/35 bg-app-accent/5' : 'border-app-border/80 hover:border-app-accent/30'}`}>
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-app-accent"><Icon name={device.icon} className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2"><p className="truncate text-sm font-semibold">{session.deviceLabel || device.name}</p>{session.current && <span className="shrink-0 rounded-full bg-app-accent/15 px-2 py-0.5 text-[9px] font-bold text-app-accent">This device</span>}</div>
                <p className="mt-1 truncate text-[11px] text-app-muted">{sessionActivity(session.lastActiveAt)}{session.approxLocation ? ` · ${session.approxLocation}` : ''}</p>
              </div>
              <button type="button" disabled={busySessionId === session.id} onClick={() => void signOutSession(session)} aria-label={`Sign out ${device.name}`} className="shrink-0 rounded-lg border border-app-border/80 p-2 text-app-muted transition hover:border-app-danger/40 hover:text-app-danger disabled:opacity-50"><Icon name="logout" className="size-4" /></button>
            </div>
          );
        })}
        {!activeSessions.length && <Empty icon="monitor" text="No active sessions" />}
      </div>
    </Panel>
  );
}
