import { useEffect, useMemo, useState } from 'react';
import { organizationApi } from '../api/organizationApi.js';
import {
  Card,
  Empty,
  ErrorMessage,
  Loading,
  Page,
} from '../components/OrganizationUi.js';
import type { OrganizationChart, OrganizationEmployee } from '../types/index.js';

export function OrgChartPage(): React.JSX.Element {
  const [chart, setChart] = useState<OrganizationChart | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void organizationApi
      .chart()
      .then(setChart)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);
  const byId = useMemo(
    () => new Map((chart?.people ?? []).map((person) => [person.id, person])),
    [chart],
  );
  function branch(parentId: string | null): OrganizationEmployee[] {
    return (chart?.people ?? []).filter((person) => person.reportsTo === parentId);
  }
  function Node({
    person,
    depth = 0,
  }: {
    person: OrganizationEmployee;
    depth?: number;
  }): React.JSX.Element {
    return (
      <div className="border-l border-app-border pl-4" style={{ marginLeft: depth * 8 }}>
        <div className="rounded-lg border border-app-border p-3">
          <p className="font-semibold">{person.fullName}</p>
          <div className="mt-2 space-y-1 text-xs text-app-muted">
            <p><span className="font-semibold text-app-foreground">Department:</span> {person.departmentName ?? '—'}</p>
            <p><span className="font-semibold text-app-foreground">Position:</span> {person.positionName ?? 'No position'}{person.positionCode ? ` (${person.positionCode})` : ''}</p>
            <p><span className="font-semibold text-app-foreground">Team:</span> {person.teamName ?? 'No team'}</p>
            <p><span className="font-semibold text-app-foreground">Reports to:</span> {person.reportsToName ?? (person.reportsTo ? 'Unavailable' : '—')}</p>
            {person.designationName && <p><span className="font-semibold text-app-foreground">Designation:</span> {person.designationName}</p>}
            {person.specialization && <p><span className="font-semibold text-app-foreground">Specialization:</span> {person.specialization}</p>}
            {person.missingManager && <p className="text-app-danger">Missing or invalid manager</p>}
          </div>
        </div>
        <div className="mt-2 space-y-2">
          {branch(person.id).map((child) => (
            <Node key={child.id} person={child} depth={depth + 1} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <Page
      eyebrow="Organization"
      title="Org chart"
      description="This chart renders actual employee reporting relationships, separate from the position hierarchy."
    >
      {Boolean(error) && (
        <div className="mt-6">
          <ErrorMessage cause={error} />
        </div>
      )}
      {loading ? (
        <Loading />
      ) : !chart || chart.people.length === 0 ? (
        <Empty>No employee chart data is visible.</Empty>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <Card>
            <h2 className="font-display text-xl font-bold">Reporting graph</h2>
            <div className="mt-5 space-y-3">
              {branch(null).map((person) => (
                <Node key={person.id} person={person} />
              ))}
              {chart.people
                .filter((person) => person.reportsTo && !byId.has(person.reportsTo))
                .map((person) => (
                  <Node key={person.id} person={person} />
                ))}
            </div>
          </Card>
          <Card>
            <h2 className="font-display text-xl font-bold">Department visibility</h2>
            <div className="mt-4 space-y-2">
              {chart.departments.map((department) => (
                <div
                  key={department.id}
                  className="rounded-lg border border-app-border p-3"
                >
                  <p className="font-semibold">{department.name}</p>
                  <p className="mt-1 text-xs text-app-muted">
                    {department.peopleVisible
                      ? 'People visible'
                      : department.structureOnly
                        ? 'Structure only'
                        : 'Restricted'}
                  </p>
                  <p className="mt-1 text-xs text-app-muted">
                    Heads: {department.headPositionNames.join(', ') || 'None'}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}
