import { useEffect, useState } from 'react';
import { Icon } from '../../../ui/Icon.js';
import { RingChart, BarChart, Progress } from '../../../ui/charts.js';
import { getCompanyEmployees, type CompanyEmployee } from '../../api/companyApi.js';

function Panel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex h-full flex-col overflow-hidden">{children}</div>;
}
function Loading(): React.JSX.Element {
  return <div className="flex-1 animate-pulse rounded-lg bg-app-surface/60" />;
}

function useEmployees(): CompanyEmployee[] | null {
  const [employees, setEmployees] = useState<CompanyEmployee[] | null>(null);
  useEffect(() => {
    getCompanyEmployees().then(setEmployees).catch(() => setEmployees([]));
  }, []);
  return employees;
}

/* --------------------------------------------------------- Visible employees */

export function OrgVisibleEmployeesWidget(): React.JSX.Element {
  const employees = useEmployees();
  return (
    <Panel>
      <div className="flex items-center justify-between">
        <p className="text-sm text-app-muted">Employees</p>
        <span className="rounded-lg bg-app-accent/10 p-2 text-app-accent"><Icon name="users" /></span>
      </div>
      {employees === null ? (
        <Loading />
      ) : (
        <>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{employees.length}</p>
          <p className="mt-2 text-xs text-app-muted">In the directory</p>
        </>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------- Dept coverage */

export function OrgDeptCoverageWidget(): React.JSX.Element {
  const employees = useEmployees();
  if (employees === null) return <Panel><Loading /></Panel>;
  const assigned = employees.filter((person) => person.departmentId).length;
  return (
    <Panel>
      <p className="text-sm font-semibold">Department coverage</p>
      <div className="flex flex-1 items-center justify-center py-2">
        <RingChart value={assigned} max={employees.length} label="Employees assigned to a department" />
      </div>
      <p className="mt-1 text-center text-xs text-app-muted">
        {assigned} of {employees.length} assigned
      </p>
    </Panel>
  );
}

/* --------------------------------------------------------- Team distribution */

export function OrgTeamDistributionWidget(): React.JSX.Element {
  const employees = useEmployees();
  if (employees === null) return <Panel><Loading /></Panel>;
  const departments = Object.entries(
    employees.reduce<Record<string, number>>((groups, person) => {
      const name = person.departmentName || 'Unassigned';
      groups[name] = (groups[name] ?? 0) + 1;
      return groups;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const chartData = departments.length > 6
    ? [...departments.slice(0, 5), ['Other', departments.slice(5).reduce((sum, item) => sum + item[1], 0)] as [string, number]]
    : departments;
  return (
    <Panel>
      <p className="text-sm font-semibold">Team distribution</p>
      <p className="mt-1 text-xs text-app-muted">By department</p>
      <div className="mt-2 flex-1">
        <BarChart label="Employees by department" data={chartData.map(([label, value]) => ({ label, value }))} />
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------- Readiness */

export function OrgReadinessWidget(): React.JSX.Element {
  const employees = useEmployees();
  if (employees === null) return <Panel><Loading /></Panel>;
  const assigned = employees.filter((p) => p.departmentId).length;
  const positions = employees.filter((p) => p.positionId).length;
  const teams = employees.filter((p) => p.teamId).length;
  const managers = employees.filter((p) => p.reportsTo && !p.missingManager).length;
  return (
    <Panel>
      <p className="text-sm font-semibold">Organization readiness</p>
      <p className="mt-1 text-xs text-app-muted">Assignment coverage</p>
      <div className="mt-4 flex-1 space-y-5 overflow-auto pr-1">
        <Progress label="Departments" value={assigned} max={employees.length} />
        <Progress label="Positions" value={positions} max={employees.length} />
        <Progress label="Teams" value={teams} max={employees.length} />
        <Progress label="Reporting manager" value={managers} max={employees.length} />
      </div>
    </Panel>
  );
}
