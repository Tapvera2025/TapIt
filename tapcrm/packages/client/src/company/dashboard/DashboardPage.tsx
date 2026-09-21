import { useEffect, useState } from 'react';
import { getGeofenceNotice, type GeofenceNotice } from '../../identity/api/authApi.js';
import { getMySessions, type IdentitySession } from '../../identity/api/sessionsApi.js';
import {
  getCompanyEmployees,
  type CompanyEmployee,
  type CompanyIdentity,
} from '../api/companyApi.js';

export function DashboardPage({
  identity,
}: {
  identity: CompanyIdentity;
}): React.JSX.Element {
  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
  const [sessions, setSessions] = useState<IdentitySession[]>([]);
  const [notice, setNotice] = useState<GeofenceNotice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void Promise.allSettled([getCompanyEmployees(), getMySessions(), getGeofenceNotice()])
      .then(([employeesResult, sessionsResult, noticeResult]) => {
        if (employeesResult.status === 'fulfilled') setEmployees(employeesResult.value);
        if (sessionsResult.status === 'fulfilled') setSessions(sessionsResult.value);
        if (noticeResult.status === 'fulfilled') setNotice(noticeResult.value);

        // Employee Directory and geofencing are optional modules. Their
        // authorization failure must not prevent the core workspace from
        // loading. Sessions are core and remain the required dashboard data.
        if (sessionsResult.status === 'rejected')
          setError('Unable to load workspace data.');
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-5 md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <p className="text-sm text-app-muted">
            Good to see you, {identity.user.fullName}
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-[-0.05em]">
            Workspace overview
          </h1>
        </div>
        {error && (
          <div className="mb-5 rounded-xl border border-[#d86b6b]/30 bg-[#d86b6b]/10 p-4 text-sm text-[#d86b6b]">
            {error}
          </div>
        )}
        {loading ? (
          <div className="grid gap-4 md:grid-cols-3">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-32 animate-pulse rounded-2xl border border-app-border bg-app-surface"
              />
            ))}
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <StatCard
                label="Active employees"
                value={employees.length}
                detail="From your organization chart"
              />
              <StatCard
                label="Your active sessions"
                value={sessions.length}
                detail="Across signed-in devices"
              />
              <StatCard
                label="Assigned locations"
                value={notice?.locations.length ?? 0}
                detail="Your geofence notice"
              />
            </div>
            <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <section className="rounded-2xl border border-app-border bg-app-surface p-6">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-app-accent">
                  Company workspace
                </p>
                <h2 className="mt-2 font-display text-2xl font-bold">
                  {identity.organization?.name ?? 'Company workspace'}
                </h2>
                <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                  <Info
                    label="Company code"
                    value={identity.organization?.code ?? 'Not available'}
                  />
                  <Info
                    label="Status"
                    value={identity.organization?.status ?? 'Not available'}
                  />
                  <Info
                    label="Signed-in user"
                    value={identity.user.email}
                    capitalize={false}
                  />
                  <Info label="Account type" value={identity.user.accountType} />
                </dl>
              </section>
              <section className="rounded-2xl border border-app-border bg-app-surface p-6">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-app-accent">
                  Access snapshot
                </p>
                <h2 className="mt-2 font-display text-2xl font-bold">
                  Identity &amp; access
                </h2>
                <p className="mt-3 text-sm leading-6 text-app-muted">
                  Review your sessions and assigned sign-in locations from the navigation.
                </p>
                <div className="mt-5 space-y-2 text-sm">
                  {sessions.slice(0, 3).map((session) => (
                    <div
                      key={session.id}
                      className="flex justify-between gap-3 rounded-lg border border-app-border px-3 py-2"
                    >
                      <span className="truncate">
                        {session.deviceLabel ?? 'Web browser'}
                      </span>
                      <span className="shrink-0 text-xs text-app-muted">
                        {session.current ? 'Current' : 'Active'}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}): React.JSX.Element {
  return (
    <article className="rounded-2xl border border-app-border bg-app-surface p-5">
      <p className="text-sm text-app-muted">{label}</p>
      <p className="mt-3 font-display text-3xl font-bold">{value}</p>
      <p className="mt-2 text-xs text-app-muted">{detail}</p>
    </article>
  );
}
function Info({
  label,
  value,
  capitalize = true,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}): React.JSX.Element {
  return (
    <div>
      <dt className="text-xs text-app-muted">{label}</dt>
      <dd
        className={`mt-1 break-words text-sm font-semibold${capitalize ? ' capitalize' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}
