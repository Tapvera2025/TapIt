import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Field, Modal, Notice, Page, Select } from '../../ui/components.js';
import {
  getCompanyDepartments,
  getCompanyEmployees,
  type CompanyDepartment,
  type CompanyEmployee,
} from '../api/companyApi.js';
import {
  createAssignment,
  downloadTaReport,
  listAssignments,
  listMyTa,
  listTaReport,
  recalculateTa,
  sendTaStatements,
  setAssignmentStatus,
  type TaAssignment,
  type TaReportRow,
} from './taApi.js';

const monthStart = () =>
  `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
const money = (paise: string | number) =>
  `₹${(Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const amountInPaise = (value: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new Error('Daily TA amount must be greater than zero.');
  const paise = Math.round(parsed * 100);
  if (!Number.isSafeInteger(paise)) throw new Error('Daily TA amount is too large.');
  return paise;
};
const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Unable to complete the TA request.';

function ConfirmActionModal({
  assignment,
  onClose,
  onConfirm,
}: {
  assignment: TaAssignment;
  onClose: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const active = assignment.status === 'active';
  return (
    <Modal
      title={`${active ? 'Deactivate' : 'Reactivate'} TA assignment?`}
      onClose={onClose}
    >
      <p className="text-sm leading-6 text-app-muted">
        {active
          ? 'Future TA calculations will stop, but historical statements will remain unchanged.'
          : 'This assignment will be available for calculation again, subject to its effective dates.'}
      </p>
      <div className="mt-6 flex justify-end gap-2">
        <Button kind="secondary" onClick={onClose}>
          Go back
        </Button>
        <Button kind={active ? 'danger' : 'primary'} onClick={onConfirm}>
          {active ? 'Deactivate' : 'Reactivate'}
        </Button>
      </div>
    </Modal>
  );
}

function AssignmentModal({
  departments,
  employees,
  onClose,
  onDone,
}: {
  departments: CompanyDepartment[];
  employees: CompanyEmployee[];
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const [departmentId, setDepartmentId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [taMonth, setTaMonth] = useState(monthStart());
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const filteredEmployees = employees.filter(
    (employee) => employee.departmentId === departmentId,
  );
  function changeMonth(value: string): void {
    setTaMonth(`${value}-01`);
    setFrom(`${value}-01`);
    setTo('');
  }
  async function submit(): Promise<void> {
    setError('');
    try {
      if (!departmentId) throw new Error('Department is required.');
      if (!employeeId) throw new Error('Employee is required.');
      if (!amount) throw new Error('Daily TA amount is required.');
      if (!from) throw new Error('Effective From is required.');
      await createAssignment({
        departmentId,
        employeeId,
        taMonth,
        dailyAmountPaise: amountInPaise(amount),
        effectiveFrom: from,
        effectiveTo: to || null,
        remarks: remarks.trim() || undefined,
      });
      onDone();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  return (
    <Modal title="Add Daily TA Assignment" onClose={onClose}>
      <div className="space-y-4">
        <Select
          label="Department"
          value={departmentId}
          onChange={(value) => {
            setDepartmentId(value);
            setEmployeeId('');
          }}
          required
          options={departments
            .filter((department) => department.status === 'active')
            .map((department) => ({ value: department.id, label: department.name }))}
        />
        <Select
          label="Employee"
          value={employeeId}
          onChange={setEmployeeId}
          disabled={!departmentId}
          required
          options={filteredEmployees
            .filter((employee) => employee.id)
            .map((employee) => ({
              value: employee.id,
              label: `${employee.fullName?.trim() || employee.email || employee.id} (${employee.employeeId ?? employee.email ?? employee.id})`,
            }))}
        />
        {departmentId && filteredEmployees.length === 0 && (
          <p className="-mt-2 text-xs text-app-danger">
            No active employees are available in the selected department.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="TA month"
            type="month"
            value={taMonth.slice(0, 7)}
            onChange={changeMonth}
            required
          />
          <Field
            label="Daily TA amount (₹)"
            type="number"
            value={amount}
            onChange={setAmount}
            required
            placeholder="500.00"
          />
          <Field
            label="Effective From"
            type="date"
            value={from}
            onChange={setFrom}
            required
          />
          <Field label="Effective To" type="date" value={to} onChange={setTo} />
        </div>
        <Field label="Remarks" value={remarks} onChange={setRemarks} />
        <p className="text-xs text-app-muted">
          Effective dates must stay within the selected TA month.
        </p>
        {error && <Notice error>{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()}>Create assignment</Button>
        </div>
      </div>
    </Modal>
  );
}

export function TaManagementPage(): React.JSX.Element {
  const [month, setMonth] = useState(monthStart());
  const [departmentId, setDepartmentId] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'draft' | 'sent'>('all');
  const [rows, setRows] = useState<TaReportRow[]>([]);
  const [departments, setDepartments] = useState<CompanyDepartment[]>([]);
  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [assignmentRows, setAssignmentRows] = useState<TaAssignment[]>([]);
  const [statusTarget, setStatusTarget] = useState<TaAssignment | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(() => {
    void Promise.all([
      listTaReport({
        taMonth: month,
        departmentId,
        search,
        status,
        page: 1,
        pageSize: 100,
      }),
      getCompanyDepartments(),
      getCompanyEmployees(),
      listAssignments(),
    ])
      .then(([report, deps, people, assignments]) => {
        setRows(report.rows);
        setDepartments(deps);
        setEmployees(people);
        setAssignmentRows(assignments.assignments);
        setSelected([]);
      })
      .catch((cause) => setError(errorMessage(cause)));
  }, [month, departmentId, search, status]);
  useEffect(load, [load]);
  const selectedStatementIds = rows
    .filter((row) => selected.includes(row.assignmentId) && row.statementId)
    .map((row) => row.statementId!);
  const activeAssignments = useMemo(
    () => assignmentRows.filter((assignment) => assignment.status === 'active'),
    [assignmentRows],
  );
  async function recalculate(): Promise<void> {
    setError('');
    try {
      await recalculateTa(
        month,
        selected.length
          ? selected
          : activeAssignments
              .filter((assignment) => assignment.taMonth === month)
              .map((assignment) => assignment.id),
      );
      setNotice('TA statements recalculated from stored attendance records.');
      load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  async function send(): Promise<void> {
    setError('');
    try {
      if (!selectedStatementIds.length)
        throw new Error('Select calculated TA statements to send.');
      await sendTaStatements(selectedStatementIds);
      setNotice('Selected TA statements were sent to the employee dashboard.');
      load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  async function download(format: 'csv' | 'xlsx'): Promise<void> {
    const blob = await downloadTaReport(
      { taMonth: month, departmentId, search, status },
      format,
    );
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `ta-${month.slice(0, 7)}.${format}`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  return (
    <Page
      eyebrow="People"
      title="TA Management"
      description="Assign daily TA, calculate it from stored attendance, review the statement, and publish it to the employee dashboard."
      action={<Button onClick={() => setShowForm(true)}>Add Daily TA</Button>}
    >
      <div className="space-y-5">
        {error && <Notice error>{error}</Notice>}
        {notice && <Notice>{notice}</Notice>}
        <div className="grid gap-3 rounded-xl border border-app-border bg-app-surface p-4 md:grid-cols-4">
          <label className="text-xs font-semibold text-app-muted">
            Department
            <select
              className="mt-2 w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
            >
              <option value="">All departments</option>
              {departments
                .filter((department) => department.status === 'active')
                .map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-app-muted">
            TA month
            <input
              className="mt-2 w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"
              type="month"
              value={month.slice(0, 7)}
              onChange={(event) => setMonth(`${event.target.value}-01`)}
            />
          </label>
          <label className="text-xs font-semibold text-app-muted">
            Search employee
            <input
              className="mt-2 w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name or employee ID"
            />
          </label>
          <label className="text-xs font-semibold text-app-muted">
            Status
            <select
              className="mt-2 w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
            >
              <option value="all">All</option>
              <option value="draft">Draft / Calculated</option>
              <option value="sent">Sent</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void recalculate()}>Recalculate</Button>
          <Button onClick={() => void send()} disabled={!selectedStatementIds.length}>
            Send Selected to Employee Dashboard
          </Button>
          <Button kind="secondary" onClick={() => void download('csv')}>
            Export CSV
          </Button>
          <Button kind="secondary" onClick={() => void download('xlsx')}>
            Export XLSX
          </Button>
        </div>
        <Card className="overflow-hidden border border-app-border p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-app-border bg-app-surface-raised text-left text-xs uppercase tracking-wider text-app-muted">
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && selected.length === rows.length}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked ? rows.map((row) => row.assignmentId) : [],
                        )
                      }
                    />
                  </th>
                  {[
                    'Employee',
                    'Department',
                    'Daily TA',
                    'Effective period',
                    'Present',
                    'Half',
                    'Eligible days',
                    'Calculated TA',
                    'Status',
                    'Sent on',
                  ].map((label) => (
                    <th className="px-4 py-3" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    className="border-b border-app-border last:border-0 hover:bg-app-background/60"
                    key={row.assignmentId}
                  >
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selected.includes(row.assignmentId)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, row.assignmentId]
                              : current.filter((id) => id !== row.assignmentId),
                          )
                        }
                      />
                    </td>
                    <td className="px-4 py-4 font-semibold">
                      {row.employeeName}
                      <span className="block text-xs font-normal text-app-muted">
                        {row.employeeCode ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-4">{row.departmentName}</td>
                    <td className="px-4 py-4 font-semibold">
                      {money(row.dailyAmountPaise)}
                    </td>
                    <td className="px-4 py-4">
                      {row.effectiveFrom} → {row.effectiveTo ?? 'month end'}
                    </td>
                    <td className="px-4 py-4">{row.presentDays}</td>
                    <td className="px-4 py-4">{row.halfDays}</td>
                    <td className="px-4 py-4 font-semibold">{row.eligibleDays}</td>
                    <td className="px-4 py-4 font-semibold">
                      {money(row.calculatedAmountPaise)}
                    </td>
                    <td className="px-4 py-4">
                      <span className="rounded-full bg-slate-500/10 px-2 py-1 text-xs font-semibold">
                        {row.status === 'sent'
                          ? 'Sent'
                          : row.recalculatedAt
                            ? 'Calculated'
                            : 'Draft'}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      {row.sentAt
                        ? new Date(row.sentAt).toLocaleDateString('en-IN')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <p className="p-8 text-center text-sm text-app-muted">
                No TA assignments for this month.
              </p>
            )}
          </div>
        </Card>
        <div className="space-y-3">
          <h2 className="font-display text-lg font-bold">Assignments</h2>
          {assignmentRows.map((assignment) => (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border bg-app-surface p-4"
              key={assignment.id}
            >
              <div>
                <p className="font-semibold">
                  {assignment.employeeName} · {assignment.departmentName}
                </p>
                <p className="text-sm text-app-muted">
                  {money(assignment.dailyAmountPaise)} per eligible day ·{' '}
                  {assignment.taMonth}
                </p>
              </div>
              <Button
                kind={assignment.status === 'active' ? 'danger' : 'secondary'}
                onClick={() => setStatusTarget(assignment)}
              >
                {assignment.status === 'active' ? 'Deactivate' : 'Reactivate'}
              </Button>
            </div>
          ))}
        </div>
        {showForm && (
          <AssignmentModal
            departments={departments}
            employees={employees}
            onClose={() => setShowForm(false)}
            onDone={() => {
              setShowForm(false);
              load();
            }}
          />
        )}
        {statusTarget && (
          <ConfirmActionModal
            assignment={statusTarget}
            onClose={() => setStatusTarget(null)}
            onConfirm={() =>
              void setAssignmentStatus(
                statusTarget.id,
                statusTarget.status === 'active' ? 'inactive' : 'active',
              )
                .then(() => {
                  setStatusTarget(null);
                  load();
                })
                .catch((cause) => {
                  setStatusTarget(null);
                  setError(errorMessage(cause));
                })
            }
          />
        )}
      </div>
    </Page>
  );
}

export function MyTaPage(): React.JSX.Element {
  const [month, setMonth] = useState(monthStart());
  const [data, setData] = useState<{
    statements: Array<Record<string, string | null>>;
    days: Array<{
      workDate: string;
      status: string | null;
      presentUnits: number;
      eligibleUnits: string;
      dailyAmountPaise: string | null;
    }>;
  }>({ statements: [], days: [] });
  const [error, setError] = useState('');
  useEffect(() => {
    void listMyTa(month)
      .then(setData)
      .catch((cause) => setError(errorMessage(cause)));
  }, [month]);
  const dailyRates = [
    ...new Set(data.statements.map((item) => item['dailyAmountPaise'])),
  ];
  const eligibleDays = data.statements.reduce(
    (total, item) => total + Number(item['eligibleDays'] ?? 0),
    0,
  );
  const calculatedAmountPaise = data.statements.reduce(
    (total, item) => total + Number(item['calculatedAmountPaise'] ?? 0),
    0,
  );
  return (
    <Page
      eyebrow="Self service"
      title="My TA"
      description="View TA statements sent to your employee dashboard."
    >
      <div className="space-y-5">
        {error && <Notice error>{error}</Notice>}
        {data.statements.length > 0 ? (
          <>
            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold text-app-muted">
                TA month
                <input
                  className="mt-2 block rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"
                  type="month"
                  value={month.slice(0, 7)}
                  onChange={(event) => setMonth(`${event.target.value}-01`)}
                />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <p className="text-xs text-app-muted">Daily TA</p>
                <p className="mt-2 text-2xl font-bold">
                  {dailyRates.length === 1
                    ? money(dailyRates[0] ?? '0')
                    : 'Multiple rates'}
                </p>
              </Card>
              <Card>
                <p className="text-xs text-app-muted">Eligible days</p>
                <p className="mt-2 text-2xl font-bold">{eligibleDays}</p>
              </Card>
              <Card>
                <p className="text-xs text-app-muted">TA amount</p>
                <p className="mt-2 text-2xl font-bold">
                  {money(String(calculatedAmountPaise))}
                </p>
              </Card>
            </div>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-lg font-bold">Attendance details</h2>
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                  Sent
                </span>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="border-b border-app-border text-left text-xs uppercase tracking-wider text-app-muted">
                      <th className="px-3 py-3">Effective period</th>
                      <th className="px-3 py-3">Daily TA</th>
                      <th className="px-3 py-3">Eligible days</th>
                      <th className="px-3 py-3">TA amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.statements.map((item) => (
                      <tr
                        className="border-b border-app-border last:border-0"
                        key={item['id']}
                      >
                        <td className="px-3 py-3">
                          {item['effectiveFrom']} – {item['effectiveTo'] ?? 'month end'}
                        </td>
                        <td className="px-3 py-3">
                          {money(item['dailyAmountPaise'] ?? '0')}
                        </td>
                        <td className="px-3 py-3">{item['eligibleDays']}</td>
                        <td className="px-3 py-3">
                          {money(item['calculatedAmountPaise'] ?? '0')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[500px] text-sm">
                  <thead>
                    <tr className="border-b border-app-border text-left text-xs uppercase tracking-wider text-app-muted">
                      <th className="px-3 py-3">Date</th>
                      <th className="px-3 py-3">Attendance</th>
                      <th className="px-3 py-3">TA eligible</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((day) => (
                      <tr
                        className="border-b border-app-border last:border-0"
                        key={day.workDate}
                      >
                        <td className="px-3 py-3">{day.workDate}</td>
                        <td className="px-3 py-3">{day.status ?? 'Not evaluated'}</td>
                        <td className="px-3 py-3">
                          {money(
                            String(
                              Math.round(
                                Number(day.dailyAmountPaise ?? 0) *
                                  Number(day.eligibleUnits),
                              ),
                            ),
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold text-app-muted">
                TA month
                <input
                  className="mt-2 block rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"
                  type="month"
                  value={month.slice(0, 7)}
                  onChange={(event) => setMonth(`${event.target.value}-01`)}
                />
              </label>
            </div>
            <Card>
              <p className="text-sm text-app-muted">
                No TA statement has been sent for this month.
              </p>
            </Card>
          </>
        )}
      </div>
    </Page>
  );
}
