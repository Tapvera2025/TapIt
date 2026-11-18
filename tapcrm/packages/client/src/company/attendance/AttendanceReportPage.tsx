import { CalendarPicker } from '../../ui/CalendarPicker.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, HorizontalScrollArea, Loading, Notice, Page, Select } from '../../ui/index.js';
import { validDateOnly } from '../../ui/index.js';
import { Icon } from '../../ui/Icon.js';
import { listShifts, type ShiftTemplate } from '../api/shiftsApi.js';
import { attendanceErrorMessage, getDailyAttendanceReport, getMonthlyAttendanceReport, requestAttendanceRangeExport, requestDailyAttendanceExport, requestMonthlyAttendanceExport, type DailyAttendanceRow, type MonthlyAttendanceRow } from './attendanceApi.js';
import { AttendanceKpis, AttendanceLegend } from './AttendanceVisuals.js';
import { AttendanceDetailsDrawer, type AttendanceDrawerDay, type AttendanceDetailsDrawerProps } from './AttendanceDetailsDrawer.js';

type Mode = 'daily' | 'weekly' | 'monthly';
const today = (): string => new Date().toISOString().slice(0, 10);
const addDays = (date: string, offset: number): string => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};
const mondayOf = (date: string): string => {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
};
const dateLabel = (date: string): string => new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const time = (value: string | null): string => value ? new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
const timelineTime = (value: string | null): string => value ? new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : time(null);
const duration = (value: number): string => `${Math.floor(value / 60)}h ${value % 60}m`;
const dailyStatus = (row: DailyAttendanceRow, isWorking = false): string => row.dayType === 'week-off' ? 'No attendance record' : isWorking ? 'Working' : row.status ?? (row.arrivalAt ? 'In progress' : 'No punch');
function currentWorkedMinutes(row: DailyAttendanceRow, isWorking: boolean, nowMs: number): number {
  if (!isWorking || !row.arrivalAt) return row.workedMinutes;
  const punchInAt = new Date(row.arrivalAt).getTime();
  if (Number.isNaN(punchInAt)) return row.workedMinutes;
  const elapsedMinutes = Math.floor((nowMs - punchInAt) / 60_000) - row.breakMinutes;
  return Math.max(row.workedMinutes, Math.max(0, elapsedMinutes));
}
const code = (record: { status: string | null; dayType?: string | null; isWfh: boolean } | undefined): string => !record || record.dayType === 'week-off' ? '—' : record.isWfh && (record.status === 'present' || record.status === 'full-day') ? 'P·WFH' : record.status === 'present' || record.status === 'full-day' ? 'P' : record.status === 'half-day' ? 'HD' : record.status === 'absent' ? 'Ab' : record.status === 'leave' || record.status === 'half-day-leave' ? 'L' : record.status === 'holiday' || record.dayType === 'holiday' ? 'H' : record.status ?? '—';

type DrawerSelection = Omit<AttendanceDetailsDrawerProps, 'onClose' | 'onPeriodChange'>;

function dailyDrawerDay(row: DailyAttendanceRow, date: string): AttendanceDrawerDay {
  return { date, status: row.status, dayType: row.dayType, isWfh: row.isWfh, arrivalAt: row.arrivalAt, departureAt: row.departureAt, workedMinutes: row.workedMinutes, breakMinutes: row.breakMinutes, lateMinutes: row.lateMinutes, overtimeMinutes: row.overtimeMinutes, flags: row.flags, shiftSource: row.shift?.source ?? null };
}

function monthlyDrawerDay(record: MonthlyAttendanceRow['records'][number]): AttendanceDrawerDay {
  return { date: record.date, status: record.status, dayType: record.dayType, isWfh: record.isWfh, arrivalAt: record.arrivalAt, departureAt: record.departureAt, workedMinutes: record.workedMinutes, breakMinutes: record.breakMinutes, lateMinutes: record.lateMinutes, overtimeMinutes: record.overtimeMinutes, flags: record.flags, shiftSource: record.shiftSource };
}

type WeeklyAttendanceRow = DailyAttendanceRow & { reportDate: string };
type WeeklyAttendanceSummary = WeeklyAttendanceRow & {
  dayRows: WeeklyAttendanceRow[];
  punchDays: number;
  daysInPeriod: number;
  lateDays: number;
};

function summarizeWeeklyRows(rows: WeeklyAttendanceRow[], weekStart: string): WeeklyAttendanceSummary[] {
  const grouped = new Map<string, WeeklyAttendanceRow[]>();
  for (const row of rows) {
    const days = grouped.get(row.id) ?? [];
    days.push(row);
    grouped.set(row.id, days);
  }

  return Array.from(grouped.values(), (employeeDays) => {
    const dayRows = [...employeeDays].sort((left, right) => left.reportDate.localeCompare(right.reportDate));
    const first = dayRows[0]!;
    const punchDays = dayRows.filter((day) => day.arrivalAt || day.departureAt).length;
    const shiftNames = Array.from(new Set(dayRows.map((day) => day.shift?.kind).filter((kind): kind is string => Boolean(kind))));
    const selectedShift = dayRows.find((day) => day.shift)?.shift ?? first.shift;

    return {
      ...first,
      reportDate: weekStart,
      arrivalAt: null,
      departureAt: null,
      workedMinutes: dayRows.reduce((sum, day) => sum + day.workedMinutes, 0),
      breakMinutes: dayRows.reduce((sum, day) => sum + day.breakMinutes, 0),
      lateMinutes: dayRows.reduce((sum, day) => sum + day.lateMinutes, 0),
      overtimeMinutes: dayRows.reduce((sum, day) => sum + day.overtimeMinutes, 0),
      shift: shiftNames.length > 1 && selectedShift ? { ...selectedShift, kind: 'Multiple' } : selectedShift,
      dayRows,
      punchDays,
      daysInPeriod: 7,
      lateDays: dayRows.filter((day) => day.lateMinutes > 0).length,
    };
  }).sort((left, right) => left.fullName.localeCompare(right.fullName));
}

export function AttendanceReportPage({ canExport = false }: { canExport?: boolean }): React.JSX.Element {
  const now = today(); const [mode, setMode] = useState<Mode>('daily'); const [date, setDate] = useState(now); const [month, setMonth] = useState(now.slice(5, 7)); const [year, setYear] = useState(now.slice(0, 4)); const [shiftId, setShiftId] = useState(''); const [format, setFormat] = useState<'csv' | 'xlsx' | ''>(''); const [shifts, setShifts] = useState<ShiftTemplate[]>([]); const [clockNow, setClockNow] = useState(() => Date.now());
  const [dailyRows, setDailyRows] = useState<DailyAttendanceRow[]>([]); const [weeklyRows, setWeeklyRows] = useState<WeeklyAttendanceRow[]>([]); const [weeklyDataKey, setWeeklyDataKey] = useState(''); const [monthlyRows, setMonthlyRows] = useState<MonthlyAttendanceRow[]>([]); const [selectedDrawer, setSelectedDrawer] = useState<DrawerSelection | null>(null); const [page, setPage] = useState(1); const [total, setTotal] = useState(0); const [totalPages, setTotalPages] = useState(1); const [loading, setLoading] = useState(true); const [exporting, setExporting] = useState(false); const [error, setError] = useState<string | null>(null);
  const closeAttendanceDrawer = useCallback(() => setSelectedDrawer(null), []);
  const months = useMemo(() => Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1).padStart(2, '0'), label: new Date(Date.UTC(2026, index, 1)).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' }) })), []);
  const weekStart = mondayOf(date); const weekEnd = addDays(weekStart, 6); const weekKey = `${weekStart}:${shiftId}`; const weekDates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const weeklySummaries = useMemo(() => summarizeWeeklyRows(weeklyRows, weekStart), [weeklyRows, weekStart]);
  const weeklyEmployeeCount = weeklySummaries.length;
  const visibleWeeklyRows = useMemo(() => weeklySummaries.slice((page - 1) * 50, page * 50), [weeklySummaries, page]);
  const weeklyTotalPages = Math.max(1, Math.ceil(weeklySummaries.length / 50));
  const periodLabel = mode === 'weekly'
    ? `${dateLabel(weekStart)} – ${dateLabel(weekEnd)}`
    : mode === 'daily' ? dateLabel(date) : `${months.find((item) => item.value === month)?.label ?? month} ${year}`;
  useEffect(() => { setSelectedDrawer(null); }, [mode, date, month, year, shiftId]);
  useEffect(() => {
    if (mode !== 'daily' || date !== today()) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      setClockNow(Date.now());
      const query: Record<string, string> = { date, page: String(page), pageSize: '50' };
      if (shiftId) query['shiftId'] = shiftId;
      void getDailyAttendanceReport(query, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setDailyRows(result.rows);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      }).catch(() => undefined);
    }, 15_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [mode, date, page, shiftId]);
  useEffect(() => { void listShifts().then(setShifts).catch((cause) => setError(attendanceErrorMessage(cause, 'Unable to load shifts.'))); }, []);
  useEffect(() => {
    if (mode === 'weekly' && weeklyDataKey === weekKey) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const query: Record<string, string> = { page: String(page), pageSize: '50' };
    if (shiftId) query['shiftId'] = shiftId;
    void (async () => {
      try {
        if (mode === 'daily') {
          const result = await getDailyAttendanceReport({ ...query, date }, controller.signal);
          setDailyRows(result.rows);
          setTotal(result.total);
          setTotalPages(result.totalPages);
        } else if (mode === 'weekly') {
          const rowsByDay = await Promise.all(weekDates.map(async (workDate) => {
            const firstPage = await getDailyAttendanceReport({ ...query, date: workDate, page: '1', pageSize: '100' }, controller.signal);
            const remainingPages = await Promise.all(
              Array.from({ length: firstPage.totalPages - 1 }, (_, index) =>
                getDailyAttendanceReport({ ...query, date: workDate, page: String(index + 2), pageSize: '100' }, controller.signal),
              ),
            );
            return [firstPage, ...remainingPages].flatMap((result) =>
              result.rows.map((row) => ({ ...row, reportDate: workDate })),
            );
          }));
          const rows = rowsByDay.flat();
          setWeeklyRows(rows);
          const employeeCount = new Set(rows.map((row) => row.id)).size;
          setTotal(employeeCount);
          setTotalPages(Math.max(1, Math.ceil(employeeCount / 50)));
          setWeeklyDataKey(weekKey);
        } else {
          const result = await getMonthlyAttendanceReport({ ...query, month, year }, controller.signal);
          setMonthlyRows(result.rows);
          setTotal(result.total);
          setTotalPages(result.totalPages);
        }
      } catch (cause) {
        if (!(cause instanceof Error && cause.name === 'AbortError')) setError(attendanceErrorMessage(cause, 'Unable to load the attendance report.'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [mode, date, month, year, shiftId, page, weekDates, weekKey, weeklyDataKey]);

  async function exportReport(): Promise<void> {
    if (!format) return;
    setExporting(true);
    setError(null);
    try {
      let blob: Blob;
      let filename: string;
      if (mode === 'weekly') {
        const userIds = Array.from(new Set(weeklyRows.map((row) => row.id)));
        blob = await requestAttendanceRangeExport(weekStart, weekEnd, format, userIds);
        filename = `attendance-weekly-${weekStart}-${weekEnd}.${format}`;
      } else {
        const query: Record<string, string> = mode === 'daily' ? { date } : { month, year };
        query['format'] = format;
        if (shiftId) query['shiftId'] = shiftId;
        blob = mode === 'daily' ? await requestDailyAttendanceExport(query) : await requestMonthlyAttendanceExport(query);
        filename = mode === 'daily' ? `attendance-daily-${date}.${format}` : `attendance-monthly-${year}-${month}.${format}`;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(attendanceErrorMessage(cause, 'Unable to export the attendance report.'));
    } finally {
      setExporting(false);
    }
  }

  function openDailyDrawer(row: DailyAttendanceRow): void {
    setSelectedDrawer({ employee: row, period: 'daily', periodLabel: dateLabel(date), periodDates: [date], days: [dailyDrawerDay(row, date)] });
  }

  function openWeeklyDrawer(row: WeeklyAttendanceSummary): void {
    const employeeDays = row.dayRows.map((item) => dailyDrawerDay(item, item.reportDate));
    setSelectedDrawer({ employee: row, period: 'weekly', periodLabel: `${dateLabel(weekStart)} – ${dateLabel(weekEnd)}`, periodDates: weekDates, days: employeeDays });
  }

  function openMonthlyDrawer(row: MonthlyAttendanceRow): void {
    setSelectedDrawer({
      employee: row,
      period: 'monthly',
      periodLabel: `${months.find((item) => item.value === month)?.label ?? month} ${year}`,
      month: `${year}-${month}`,
      days: row.records,
      summary: {
        presentUnits: row.presentUnits,
        leaveUnits: row.paidLeaveUnits + row.unpaidLeaveUnits,
        absentUnits: row.absentUnits,
        holidayUnits: row.holidayUnits,
        wfhDays: row.wfhDays,
        lateDays: row.lateDays,
        lateMinutes: row.lateMinutes,
        workedMinutes: row.workedMinutes,
        breakMinutes: row.breakMinutes,
        overtimeMinutes: row.overtimeMinutes,
      },
    });
  }

  async function switchDrawerPeriod(nextPeriod: AttendanceDetailsDrawerProps['period'], anchorDate: string): Promise<void> {
    const current = selectedDrawer;
    if (!current || !anchorDate) return;
    const employeeId = current.employee.id;
    try {
      if (nextPeriod === 'monthly') {
        const [targetYear, targetMonth] = anchorDate.slice(0, 7).split('-');
        const result = await getMonthlyAttendanceReport({
          month: targetMonth!, year: targetYear!, page: '1', pageSize: '100', employeeId,
          ...(shiftId ? { shiftId } : {}),
        });
        const row = result.rows.find((item) => item.id === employeeId);
        const monthValue = `${targetYear}-${targetMonth}`;
        const nextSelection: DrawerSelection = row ? {
          employee: { ...current.employee, ...row },
          period: 'monthly',
          periodLabel: new Date(`${monthValue}-01T00:00:00.000Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
          month: monthValue,
          days: row.records.map(monthlyDrawerDay),
          summary: {
            presentUnits: row.presentUnits,
            leaveUnits: row.paidLeaveUnits + row.unpaidLeaveUnits,
            absentUnits: row.absentUnits,
            holidayUnits: row.holidayUnits,
            wfhDays: row.wfhDays,
            lateDays: row.lateDays,
            lateMinutes: row.lateMinutes,
            workedMinutes: row.workedMinutes,
            breakMinutes: row.breakMinutes,
            overtimeMinutes: row.overtimeMinutes,
          },
        } : {
          employee: current.employee,
          period: 'monthly',
          periodLabel: new Date(`${monthValue}-01T00:00:00.000Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
          month: monthValue,
          days: [],
        };
        setSelectedDrawer((open) => open?.employee.id === employeeId ? nextSelection : open);
        return;
      }

      const getEmployeeDay = async (workDate: string): Promise<DailyAttendanceRow | undefined> => {
        const query: Record<string, string> = { date: workDate, page: '1', pageSize: '100' };
        if (shiftId) query['shiftId'] = shiftId;
        const firstPage = await getDailyAttendanceReport(query);
        const found = firstPage.rows.find((row) => row.id === employeeId);
        if (found || firstPage.totalPages <= 1) return found;
        const remaining = await Promise.all(Array.from({ length: firstPage.totalPages - 1 }, (_, index) =>
          getDailyAttendanceReport({ ...query, page: String(index + 2) }),
        ));
        return remaining.flatMap((result) => result.rows).find((row) => row.id === employeeId);
      };

      if (nextPeriod === 'daily') {
        const row = await getEmployeeDay(anchorDate);
        const day: AttendanceDrawerDay = row
          ? dailyDrawerDay(row, anchorDate)
          : { date: anchorDate, status: null, dayType: null, isWfh: false, arrivalAt: null, departureAt: null, workedMinutes: 0, breakMinutes: 0, lateMinutes: 0, overtimeMinutes: 0 };
        const nextSelection: DrawerSelection = {
          employee: row ? { ...current.employee, shift: row.shift } : current.employee,
          period: 'daily', periodLabel: dateLabel(anchorDate), periodDates: [anchorDate], days: [day],
        };
        setSelectedDrawer((open) => open?.employee.id === employeeId ? nextSelection : open);
        return;
      }

      const targetWeekStart = mondayOf(anchorDate);
      const targetWeekDates = Array.from({ length: 7 }, (_, index) => addDays(targetWeekStart, index));
      const weekRows = await Promise.all(targetWeekDates.map((workDate) => getEmployeeDay(workDate)));
      const employeeRow = weekRows.find((row): row is DailyAttendanceRow => row !== undefined);
      const weekEndDate = targetWeekDates[targetWeekDates.length - 1]!;
      const nextSelection: DrawerSelection = {
        employee: employeeRow ? { ...current.employee, shift: employeeRow.shift } : current.employee,
        period: 'weekly',
        periodLabel: `${dateLabel(targetWeekStart)} – ${dateLabel(weekEndDate)}`,
        periodDates: targetWeekDates,
        days: weekRows.flatMap((row, index) => row ? [dailyDrawerDay(row, targetWeekDates[index]!)] : []),
      };
      setSelectedDrawer((open) => open?.employee.id === employeeId ? nextSelection : open);
    } catch (cause) {
      throw new Error(attendanceErrorMessage(cause, 'Unable to load this attendance period.'));
    }
  }

  return <Page eyebrow="HR · Attendance" title="Attendance Report" description="Daily, weekly, and monthly attendance from stored calculated records.">
    <Card className="p-2.5 sm:p-3.5">
      <div className="grid grid-cols-2 items-end gap-2.5 sm:grid-cols-3 min-[1100px]:flex min-[1100px]:flex-nowrap min-[1100px]:items-center min-[1100px]:justify-between min-[1100px]:gap-1.5">
        <div className="col-span-2 flex min-w-0 rounded-2xl border border-app-border bg-app-surface-raised/65 p-1 sm:col-span-1 min-[1100px]:w-[210px] min-[1100px]:shrink-0" role="group" aria-label="Attendance period">
          {([
            { id: 'daily' as const, label: 'Daily', icon: 'calendar' },
            { id: 'weekly' as const, label: 'Weekly', icon: 'calendar' },
            { id: 'monthly' as const, label: 'Monthly', icon: 'calendar' },
          ]).map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={mode === item.id}
              onClick={() => { setMode(item.id); setPage(1); }}
              className={`inline-flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl px-2 text-[11px] font-semibold transition sm:gap-1.5 sm:px-2.5 min-[1100px]:gap-0.5 min-[1100px]:px-1 min-[1100px]:text-[10px] ${mode === item.id ? 'bg-app-accent text-app-on-accent shadow-sm' : 'text-app-muted hover:bg-app-background hover:text-app-foreground'}`}
            >
              <Icon name={item.icon} className="size-3.5 shrink-0 min-[1100px]:size-3" />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <label className="attendance-toolbar-date min-w-0 text-xs font-semibold text-app-muted min-[1100px]:flex min-[1100px]:min-w-[162px] min-[1100px]:max-w-[280px] min-[1100px]:flex-[1_1_220px] min-[1100px]:items-center min-[1100px]:gap-1.5">
          <span className="attendance-toolbar-label mb-1.5 flex items-center gap-1.5 min-[1100px]:mb-0 min-[1100px]:shrink-0"><Icon name="calendar" className="size-3.5" />Date</span>
          <div className="min-w-0 flex-1">
            <CalendarPicker
              type={mode === 'monthly' ? 'month' : 'date'}
              value={mode === 'monthly' ? `${year}-${month}` : date}
              min={mode === 'monthly' ? '2000-01' : undefined}
              max={mode === 'monthly' ? '2200-12' : undefined}
              onChange={(event) => {
                const value = event.target.value;
                if (mode === 'monthly') {
                  const [nextYear, nextMonth] = value.split('-');
                  if (nextYear && nextMonth) { setYear(nextYear); setMonth(nextMonth); setPage(1); }
                } else if (validDateOnly(value)) {
                  setDate(value);
                  setPage(1);
                }
              }}
              className="ui-form-control w-full px-3 py-2.5 text-sm text-app-foreground min-[1100px]:px-2 min-[1100px]:py-1.5 min-[1100px]:pr-7 min-[1100px]:text-[12px]"
            />
          </div>
        </label>
        <div className="attendance-toolbar-shift min-w-0 min-[1100px]:min-w-[137px] min-[1100px]:max-w-[210px] min-[1100px]:flex-[1_1_160px]"><Select compact label="Shift" value={shiftId} onChange={(value) => { setShiftId(value); setPage(1); }} options={shifts.map((item) => ({ value: item.id, label: item.name }))} /></div>
        {canExport && (
          <>
            <div className="attendance-toolbar-format min-w-0 min-[1100px]:min-w-[108px] min-[1100px]:max-w-[200px] min-[1100px]:flex-[1_1_140px]"><Select compact visuallyHiddenLabel label="Export format" value={format} onChange={(value) => setFormat(value as 'csv' | 'xlsx' | '')} options={[{ value: 'csv', label: 'CSV' }, { value: 'xlsx', label: 'XLSX' }]} placeholder="Select format" placeholderDisabled /></div>
            <Button className="inline-flex w-full items-center justify-center gap-2 min-[1100px]:w-auto min-[1100px]:shrink-0 min-[1100px]:px-2.5 min-[1100px]:py-2 min-[1100px]:text-xs" disabled={!format || exporting || loading || (mode === 'weekly' && weeklyRows.length === 0)} onClick={() => void exportReport()}>
              <Icon name="download" className="size-4" />{exporting ? 'Exporting…' : 'Export'}
            </Button>
          </>
        )}
      </div>
    </Card>
    {!loading && !error && mode === 'daily' && (
      <Card className="p-3.5 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">At-a-glance status</h2>
            <p className="text-sm text-app-muted">{periodLabel} · {total} {total === 1 ? 'employee' : 'employees'}</p>
          </div>
          <AttendanceLegend />
        </div>
        <div className="mt-4">
          <AttendanceKpis
            variant="report"
            columns={4}
            items={[
              { label: 'Present', value: dailyRows.filter((row) => row.status === 'present' || row.status === 'full-day' || row.arrivalAt).length },
              { label: 'WFH', value: dailyRows.filter((row) => row.isWfh).length },
              { label: 'Late', value: dailyRows.filter((row) => row.lateMinutes > 0).length },
              { label: 'No punch', value: dailyRows.filter((row) => row.dayType !== 'week-off' && !row.arrivalAt).length },
            ]}
          />
        </div>
      </Card>
    )}
    {error && <Notice error>{error}</Notice>}{loading && <Loading />}{!loading && !error && ((mode === 'daily' && dailyRows.length === 0) || (mode === 'weekly' && weeklyRows.length === 0) || (mode === 'monthly' && monthlyRows.length === 0)) && <Empty>{mode === 'monthly' ? 'No attendance data are available for this month and shift selection.' : mode === 'weekly' ? 'No attendance data are available for this week and shift selection.' : 'No employees or attendance data are available for this date and visibility scope.'}</Empty>}
    {!loading && !error && mode === 'daily' && dailyRows.length > 0 && (
      <Card className="overflow-hidden p-0">
        <HorizontalScrollArea ariaLabel="Daily attendance table" showArrows={false}>
          <table className="w-full min-w-[1060px] table-fixed text-sm">
            <colgroup>
              <col className="w-[18%]" />
              <col className="w-[13%]" />
              <col className="w-[14%]" />
              <col className="w-[37%]" />
              <col className="w-[8%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-app-border bg-app-surface-raised text-left text-xs text-app-muted">
                <th className="min-w-[190px] px-4 py-3">Employee</th>
                <th className="min-w-[135px] px-3 py-3">Department</th>
                <th className="min-w-[155px] px-3 py-3">Position</th>
                <th className="min-w-[390px] px-3 py-3 text-center">Punch In / Punch Out</th>
                <th className="min-w-[110px] px-3 py-3">Break</th>
                <th className="min-w-[140px] px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {dailyRows.map((row) => {
                const isWorking = date === now && Boolean(row.arrivalAt) && !row.departureAt;
                const workedMinutes = currentWorkedMinutes(row, isWorking, clockNow);
                return (
                <tr
                  key={row.id}
                  tabIndex={0}
                  aria-label={`Open daily attendance details for ${row.fullName}`}
                  onClick={() => openDailyDrawer(row)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openDailyDrawer(row);
                    }
                  }}
                  className="cursor-pointer border-b border-app-border transition-colors last:border-0 hover:bg-app-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-accent"
                >
                  <td className="px-4 py-3">
                    <span className="block max-w-full truncate whitespace-nowrap font-semibold text-app-foreground" title={row.fullName}>{row.fullName}</span>
                    <span className="mt-0.5 block truncate text-xs text-app-muted">{row.employeeId ?? '—'}</span>
                  </td>
                  <td className="px-3 py-3 text-app-foreground">{row.departmentName ?? '—'}</td>
                  <td className="px-3 py-3 text-app-foreground">{row.positionName ?? '—'}</td>
                  <td className="px-3 py-3">
                    <div className="mx-auto grid min-w-[370px] grid-cols-[minmax(72px,0.8fr)_minmax(148px,1fr)_minmax(72px,0.8fr)] items-center gap-2.5">
                      <div className="min-w-0">
                        <span className="block truncate text-sm font-semibold tabular-nums text-app-accent">{timelineTime(row.arrivalAt)}</span>
                      </div>
                      <div className="min-w-0">
                        <span className={`mb-0.5 block text-center text-[9px] font-bold uppercase tracking-wide ${isWorking ? 'text-emerald-700 dark:text-emerald-300' : 'text-app-muted'}`}>{isWorking ? 'Working' : 'Worked'}</span>
                        <div className="flex items-center gap-1.5" aria-label={`${isWorking ? 'Working' : 'Worked'} ${duration(workedMinutes)}`}>
                          <span className="size-2 shrink-0 rounded-full bg-app-accent" />
                          <span className="h-px min-w-2 flex-1 bg-app-border" />
                          <span className="whitespace-nowrap text-[11px] font-semibold tabular-nums text-app-foreground">{duration(workedMinutes)}</span>
                          <span className="h-px min-w-2 flex-1 bg-app-border" />
                          <span className="size-2 shrink-0 rounded-full bg-app-accent" />
                        </div>
                      </div>
                      <div className="min-w-0 text-right">
                        <span className="block truncate text-sm font-semibold tabular-nums text-app-accent">{timelineTime(row.departureAt)}</span>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{duration(row.breakMinutes)}</td>
                  <td className="px-3 py-3 font-semibold">
                    {isWorking ? <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/35 dark:text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-500" />Working</span> : dailyStatus(row)}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </HorizontalScrollArea>
        <Pagination page={page} totalPages={totalPages} total={total} onPage={setPage} />
      </Card>
    )}
    {!loading && !error && mode === 'weekly' && weeklyRows.length > 0 && (
      <Card className="overflow-hidden p-0">
        <HorizontalScrollArea ariaLabel="Weekly attendance summary table" showArrows={false}>
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-app-border bg-app-surface-raised text-left text-xs text-app-muted">
                {['Employee', 'Department', 'Position', 'Punch days', 'Worked', 'Break', 'Late'].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {visibleWeeklyRows.map((row) => {
                const lateDays = row.dayRows.filter((day) => day.lateMinutes > 0);
                const lateTooltip = lateDays.map((day) => `${dateLabel(day.reportDate)}: ${duration(day.lateMinutes)} late`).join('\n');
                return (
                <tr key={row.id} onClick={() => openWeeklyDrawer(row)} className="cursor-pointer border-b border-app-border last:border-0 transition-colors hover:bg-app-accent/5">
                  <td className="min-w-[190px] px-3 py-3">
                    <button type="button" onClick={(event) => { event.stopPropagation(); openWeeklyDrawer(row); }} aria-label={`View weekly attendance for ${row.fullName}`} title={row.fullName} className="block max-w-[180px] truncate whitespace-nowrap rounded text-left font-semibold text-app-foreground hover:text-app-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent">{row.fullName}</button>
                    <span className="mt-0.5 block truncate text-xs text-app-muted">{row.employeeId ?? '—'}</span>
                  </td>
                  <td className="px-3 py-3">{row.departmentName ?? '?'}</td>
                  <td className="px-3 py-3">{row.positionName ?? '?'}</td>
                  <td className="whitespace-nowrap px-3 py-3">{row.punchDays} / {row.daysInPeriod} days</td>
                  <td className="whitespace-nowrap px-3 py-3 font-semibold">{duration(row.workedMinutes)}</td>
                  <td className="whitespace-nowrap px-3 py-3">{duration(row.breakMinutes)}</td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {lateDays.length > 0 ? <span tabIndex={0} title={lateTooltip} aria-label={`Late ${lateDays.length} ${lateDays.length === 1 ? 'day' : 'days'}: ${lateTooltip.replaceAll('\n', '. ')}`} className="cursor-help rounded-sm font-medium underline decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent">{row.lateDays} {row.lateDays === 1 ? 'day' : 'days'}</span> : `${row.lateDays} days`}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </HorizontalScrollArea>
        <Pagination page={page} totalPages={weeklyTotalPages} total={weeklyEmployeeCount} itemLabel="employees" onPage={setPage} />
      </Card>
    )}
    {!loading && !error && mode === 'monthly' && monthlyRows.length > 0 && (
      <Card className="overflow-hidden p-0">
        <HorizontalScrollArea ariaLabel="Monthly attendance totals" showArrows={false}>
          <table className="w-full min-w-[1000px] text-sm">
            <thead>
              <tr className="text-left text-xs text-app-muted">
                <th className="px-4 py-3">Employee totals</th>
                <th className="px-3 py-3">Present</th>
                <th className="px-3 py-3">Leave</th>
                <th className="px-3 py-3">Absent</th>
                <th className="px-3 py-3">Holiday</th>
                <th className="px-3 py-3">WFH</th>
                <th className="px-3 py-3">Late</th>
                <th className="px-3 py-3">Worked</th>
                <th className="px-3 py-3">Break</th>
                <th className="px-3 py-3">Overtime</th>
              </tr>
            </thead>
            <tbody>
              {monthlyRows.map((row) => (
                <tr
                  key={row.id}
                  tabIndex={0}
                  aria-label={`Open monthly attendance details for ${row.fullName}`}
                  onClick={() => openMonthlyDrawer(row)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openMonthlyDrawer(row);
                    }
                  }}
                  className="cursor-pointer border-t border-app-border transition-colors hover:bg-app-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-accent"
                >
                  <td className="px-4 py-2">
                    <span className="block font-semibold text-app-foreground">{row.fullName}</span>
                    <span className="mt-0.5 block text-xs text-app-muted">{row.employeeId ?? '—'}</span>
                  </td>
                  <td className="px-3 py-2">{row.presentUnits}</td>
                  <td className="px-3 py-2">{row.paidLeaveUnits + row.unpaidLeaveUnits}</td>
                  <td className="px-3 py-2">{row.absentUnits}</td>
                  <td className="px-3 py-2">{row.holidayUnits}</td>
                  <td className="px-3 py-2">{row.wfhDays}</td>
                  <td className="px-3 py-2">{row.lateDays} {row.lateDays === 1 ? 'day' : 'days'}</td>
                  <td className="px-3 py-2">{duration(row.workedMinutes)}</td>
                  <td className="px-3 py-2">{duration(row.breakMinutes)}</td>
                  <td className="px-3 py-2">{row.overtimeMinutes}m</td>
                </tr>
              ))}
            </tbody>
          </table>
        </HorizontalScrollArea>
        <Pagination page={page} totalPages={totalPages} total={total} onPage={setPage} />
      </Card>
    )}
    {selectedDrawer && <AttendanceDetailsDrawer key={selectedDrawer.employee.id} {...selectedDrawer} onPeriodChange={switchDrawerPeriod} onClose={closeAttendanceDrawer} />}
  </Page>;
}

function Pagination({ page, totalPages, total, itemLabel = 'employees', onPage }: { page: number; totalPages: number; total: number; itemLabel?: string; onPage: (value: number) => void }): React.JSX.Element { return <div className="flex items-center justify-between gap-3 border-t border-app-border px-4 py-3 text-sm text-app-muted"><span>{total} {itemLabel} · Page {page} of {totalPages}</span><span className="flex gap-2"><Button kind="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button><Button kind="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</Button></span></div>; }
