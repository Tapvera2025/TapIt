import { useEffect, useState } from 'react';
import { organizationApi } from '../api/organizationApi.js';
import { Card, ErrorMessage, Loading, Page } from '../components/OrganizationUi.js';
import type {
  OrganizationChart,
  OrganizationDepartment,
  OrganizationDesignation,
  OrganizationTeam,
} from '../types/index.js';

export function OrganizationOverview({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const [data, setData] = useState<{
    departments: OrganizationDepartment[];
    teams: OrganizationTeam[];
    designations: OrganizationDesignation[];
    chart: OrganizationChart;
  } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    void Promise.all([
      organizationApi.departments(),
      organizationApi.teams(),
      organizationApi.designations(),
      organizationApi.chart(),
    ])
      .then(([departments, teams, designations, chart]) =>
        setData({ departments, teams, designations, chart }),
      )
      .catch(setError);
  }, []);
  return (
    <Page
      eyebrow="Organization"
      title="Organization overview"
      description="Review the structure, people, and reporting information available to your account."
    >
      {Boolean(error) && (
        <div className="mt-6">
          <ErrorMessage cause={error} />
        </div>
      )}
      {!error && !data && <Loading />}
      {data && (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Departments"
              value={data.departments.length}
              onClick={() => onNavigate('/company/organization/departments')}
            />
            <Metric
              label="Teams"
              value={data.teams.length}
              onClick={() => onNavigate('/company/organization/teams')}
            />
            <Metric
              label="Designations"
              value={data.designations.length}
              onClick={() => onNavigate('/company/organization/designations')}
            />
            <Metric
              label="Visible employees"
              value={data.chart.people.length}
              onClick={() => onNavigate('/company/organization/org-chart')}
            />
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="font-display text-xl font-bold">Structure</h2>
              <div className="mt-4 space-y-3">
                {data.departments.slice(0, 6).map((department) => (
                  <button
                    type="button"
                    key={department.id}
                    onClick={() => onNavigate('/company/organization/departments')}
                    className="flex w-full items-center justify-between rounded-lg border border-app-border p-3 text-left hover:border-app-accent"
                  >
                    <span>
                      <span className="block font-semibold">{department.name}</span>
                      <span className="text-xs text-app-muted">
                        {department.code} · {department.kind}
                      </span>
                    </span>
                    <span className="text-xs text-app-muted">{department.status}</span>
                  </button>
                ))}
                {data.departments.length === 0 && (
                  <p className="text-sm text-app-muted">No visible departments.</p>
                )}
              </div>
            </Card>
            <Card>
              <h2 className="font-display text-xl font-bold">People signals</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Info
                  label="Employees without manager"
                  value={
                    data.chart.people.filter((person) => person.missingManager).length
                  }
                />
                <Info
                  label="Structure-only departments"
                  value={
                    data.chart.departments.filter(
                      (department) => department.structureOnly,
                    ).length
                  }
                />
                <Info
                  label="People-visible departments"
                  value={
                    data.chart.departments.filter(
                      (department) => department.peopleVisible,
                    ).length
                  }
                />
                <Info
                  label="Active designations"
                  value={
                    data.designations.filter(
                      (designation) => designation.status === 'active',
                    ).length
                  }
                />
              </div>
            </Card>
          </div>
        </>
      )}
    </Page>
  );
}
function Metric({
  label,
  value,
  onClick,
}: {
  label: string;
  value: number;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-app-border bg-app-surface p-5 text-left hover:border-app-accent"
    >
      <p className="text-sm text-app-muted">{label}</p>
      <p className="mt-3 font-display text-3xl font-bold">{value}</p>
      <p className="mt-2 text-xs text-app-accent">Open details →</p>
    </button>
  );
}
function Info({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-app-border p-3">
      <p className="text-xs text-app-muted">{label}</p>
      <p className="mt-2 text-xl font-bold">{value}</p>
    </div>
  );
}
