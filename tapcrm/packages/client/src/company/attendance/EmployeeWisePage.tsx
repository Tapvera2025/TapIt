import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Field, Loading, Notice, Page, Select } from '../../ui/components.js';
import { calendarDateLabel } from '../../ui/calendar-model.js';
import {
  getEmployeeWiseReport,
  searchAttendanceReportEmployees,
  attendanceErrorMessage,
  type AttendanceReportEmployee,
  type EmployeeWiseDay,
  type EmployeeWiseReport,
} from './attendanceApi.js';
import { AttendanceCalendar, AttendanceKpis, AttendanceLegend } from './AttendanceVisuals.js';

function currentMonth(): string { return new Date().toISOString().slice(0, 7); }
function fmt(minutes: number): string { return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
function time(value: string | null): string { return value ? new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'; }
function statusCode(day: EmployeeWiseDay | undefined): string {
  if (!day) return '—';
  if (day.isWfh && (day.status === 'present' || day.status === 'full-day')) return 'P · WFH';
  if (day.status === 'present' || day.status === 'full-day') return 'P';
  if (day.status === 'half-day') return 'HD';
  if (day.status === 'absent') return 'Ab';
  if (day.status === 'leave' || day.status === 'half-day-leave') return 'L';
  if (day.status === 'holiday' || day.dayType === 'holiday') return 'H';
  return day.status ?? '—';
}

const months = Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1).padStart(2, '0'), label: new Date(Date.UTC(2026, index, 1)).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' }) }));
const years = Array.from({ length: 7 }, (_, index) => String(new Date().getUTCFullYear() - 3 + index));

export function EmployeeWisePage(): React.JSX.Element {
  const initial = currentMonth();
  const [month, setMonth] = useState(initial.slice(5));
  const [year, setYear] = useState(initial.slice(0, 4));
  const [search, setSearch] = useState('');
  const [employees, setEmployees] = useState<AttendanceReportEmployee[]>([]);
  const [selected, setSelected] = useState<AttendanceReportEmployee | null>(null);
  const [report, setReport] = useState<EmployeeWiseReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      setError(null);
      void searchAttendanceReportEmployees(search, controller.signal)
        .then((nextEmployees) => { setEmployees(nextEmployees); })
        .catch((cause) => { if (!(cause instanceof Error && cause.name === 'AbortError')) setError(attendanceErrorMessage(cause, 'Unable to search employees.')); })
        .finally(() => setSearching(false));
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search]);

  useEffect(() => {
    if (!selected) { setReport(null); return; }
    const controller = new AbortController();
    setLoading(true); setError(null); setSelectedDate(null);
    void getEmployeeWiseReport(selected.id, month, Number(year), controller.signal)
      .then(setReport)
      .catch((cause) => { if (!(cause instanceof Error && cause.name === 'AbortError')) setError(attendanceErrorMessage(cause, 'Unable to load employee attendance.')); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [selected, month, year]);

  const byDate = useMemo(() => new Map(report?.records.map((day) => [day.date, { status: day.status, dayType: day.dayType, isWfh: day.isWfh, lateMinutes: day.minutes.late }]) ?? []), [report]);
  const selectedDay = selectedDate ? byDate.get(selectedDate) : undefined;
  const selectedRecord = selectedDate ? report?.records.find((day) => day.date === selectedDate) : undefined;
  const summary = report?.summary;

  return (
    <Page eyebrow="HR · Attendance" title="Employee Wise Attendance" description="View stored attendance results for one employee and one month.">
      <Card>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px_160px]">
          <div className="relative">
            <Field label="Search employee" value={search} onChange={setSearch} placeholder="Name, employee ID or email" />
            {(search.length > 0 || employees.length > 0) && !selected && (
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-app-border bg-app-surface shadow-xl">
                {searching && <p className="px-3 py-3 text-sm text-app-muted">Searching…</p>}
                {!searching && employees.map((employee) => (
                  <button key={employee.id} type="button" className="block w-full px-3 py-2 text-left hover:bg-app-background" onClick={() => { setSelected(employee); setSearch(employee.fullName); }}>
                    <span className="block text-sm font-semibold">{employee.fullName}</span>
                    <span className="block text-xs text-app-muted">{employee.employeeId ?? 'No employee ID'} · {employee.departmentName ?? 'No department'}</span>
                  </button>
                ))}
                {!searching && employees.length === 0 && <p className="px-3 py-3 text-sm text-app-muted">No employees found.</p>}
              </div>
            )}
          </div>
          <Select label="Month" value={month} onChange={setMonth} options={months} />
          <Select label="Year" value={year} onChange={setYear} options={years.map((value) => ({ value, label: value }))} />
        </div>
        {selected && <Button kind="secondary" className="mt-4" onClick={() => { setSelected(null); setSearch(''); }}>Change employee</Button>}
      </Card>

      {!selected && <Empty>Select an employee to view their attendance.</Empty>}
      {loading && <Loading />}
      {error && <Notice error>{error}</Notice>}
      {selected && !loading && !error && report && (
        <div className="space-y-6">
          <Card>
            <h2 className="text-lg font-bold">Employee Information</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Name', report.employee.fullName], ['Employee ID', report.employee.employeeId ?? '—'],
                ['Email', report.employee.email ?? '—'], ['Department', report.employee.departmentName ?? '—'],
                ['Team', report.employee.teamName ?? '—'], ['Position', report.employee.positionName ?? '—'],
                ['Designation', report.employee.designationName ?? '—'], ['Specialization', report.employee.specialization ?? '—'],
              ].map(([label, value]) => <div key={label}><p className="text-xs font-semibold uppercase tracking-wider text-app-muted">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>)}
            </div>
          </Card>

          {!summary && report.records.length === 0 && <Empty>No attendance data is available for this month.</Empty>}
          {summary && <Card><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Monthly Summary</h2><p className="mt-1 text-sm text-app-muted">Attendance health for the selected month.</p></div><AttendanceLegend /></div><div className="mt-4"><AttendanceKpis items={[{ label: 'Present', value: summary.presentUnits, tone: 'border-emerald-200 dark:border-emerald-800' }, { label: 'Half days', value: summary.halfDays, tone: 'border-amber-200 dark:border-amber-800' }, { label: 'Absent', value: summary.absentUnits, tone: 'border-rose-200 dark:border-rose-800' }, { label: 'Leave', value: summary.paidLeaveUnits + summary.unpaidLeaveUnits, tone: 'border-violet-200 dark:border-violet-800' }, { label: 'WFH days', value: summary.wfhDays, tone: 'border-sky-200 dark:border-sky-800' }, { label: 'Late days', value: summary.lateDays }, { label: 'Overtime', value: fmt(summary.overtimeMinutes) }, { label: 'Worked', value: fmt(summary.workedMinutes) }]} /></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="rounded-xl bg-app-surface-raised p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">Late minutes</p><p className="mt-1 text-lg font-bold">{summary.lateMinutes}</p></div><div className="rounded-xl bg-app-surface-raised p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">Break</p><p className="mt-1 text-lg font-bold">{fmt(summary.breakMinutes)}</p></div><div className="rounded-xl bg-app-surface-raised p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">Stale days</p><p className="mt-1 text-lg font-bold">{summary.staleDays}</p></div></div></Card>}

          <Card>
            <h2 className="text-lg font-bold">Attendance Calendar</h2>
            <div className="mt-4"><AttendanceCalendar month={`${year}-${month}`} records={byDate} onSelect={setSelectedDate} /></div><div className="mt-4"><AttendanceLegend /></div>
          </Card>

          {selectedDate && <Card><h2 className="text-lg font-bold">Selected Day</h2><p className="mt-1 text-sm text-app-muted">{calendarDateLabel(selectedDate)}</p>{selectedDay ? <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Status', selectedRecord ? statusCode(selectedRecord) : '—'], ['Shift', selectedRecord?.shift.kind ?? '—'], ['Shift source', selectedRecord?.shift.source ?? '—'], ['Shift hours', selectedRecord?.shift.start && selectedRecord.shift.end ? `${selectedRecord.shift.start}–${selectedRecord.shift.end}` : '—'],
              ['Punch in', time(selectedRecord?.arrivalAt ?? null)], ['Punch out', time(selectedRecord?.departureAt ?? null)], ['Worked', fmt(selectedRecord?.minutes.worked ?? 0)], ['Break', fmt(selectedRecord?.minutes.break ?? 0)],
              ['Late', `${selectedRecord?.minutes.late ?? 0}m`], ['Overtime', `${selectedRecord?.minutes.overtime ?? 0}m`], ['WFH', selectedRecord?.isWfh ? 'Yes' : 'No'], ['Calculation', selectedRecord?.recalculating ? 'Recalculating' : 'Current'],
            ].map(([label, value]) => <div key={label}><p className="text-xs font-semibold uppercase tracking-wider text-app-muted">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>)}
            {(selectedRecord?.flags.length ?? 0) > 0 && <div className="sm:col-span-2 lg:col-span-4"><p className="text-xs font-semibold uppercase tracking-wider text-app-muted">Attendance flags</p><p className="mt-1 text-sm">{selectedRecord?.flags.join(', ')}</p></div>}
          </div> : <p className="mt-4 text-sm text-app-muted">No attendance record is available for this date.</p>}</Card>}
        </div>
      )}
    </Page>
  );
}
