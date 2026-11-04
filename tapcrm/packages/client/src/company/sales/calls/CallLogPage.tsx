import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Field, Icon, Notice, Page, SearchableSelect, Select } from '../../../ui/index.js';
import { getCallPeople, getCalls, type CallOutcome, type CallPage, type CallPeople, type TelephonyProvider } from './api.js';
import { OUTCOME_LABELS } from './calls-format.js';
import {
  CallDetailModal,
  CallsTable,
  CallsTabs,
  DirectionSelect,
  errorText,
  initialRange,
  ProviderSelect,
  RangeFilter,
  TableSkeleton,
  type CallsAccess,
  type RangeValue,
} from './CallsShared.js';

const PAGE_SIZE = 50;

export function CallLogPage({
  access,
  organizationTimeZone,
  onNavigate,
}: {
  access: CallsAccess;
  organizationTimeZone: string;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const [range, setRange] = useState<RangeValue>(() => initialRange(organizationTimeZone, '7d'));
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState('');
  const [outcome, setOutcome] = useState('');
  const [provider, setProvider] = useState('');
  const [teamId, setTeamId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [unmatched, setUnmatched] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<CallPage | null>(null);
  const [people, setPeople] = useState<CallPeople | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openCallId, setOpenCallId] = useState<string | null>(null);

  // Typing settles for a moment before the search runs.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  /** Any filter change starts again from the first page, in the same render. */
  function filter<T>(setter: (value: T) => void): (value: T) => void {
    return (value: T) => {
      setPage(1);
      setter(value);
    };
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getCalls({
        from: range.from,
        to: range.to,
        search: query || undefined,
        direction: (direction || undefined) as 'inbound' | 'outbound' | undefined,
        outcome: (outcome || undefined) as CallOutcome | undefined,
        provider: (provider || undefined) as TelephonyProvider | undefined,
        teamId: teamId || undefined,
        employeeId: employeeId || undefined,
        unmatched: unmatched || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setResult(next);
      setError(null);
    } catch (cause) {
      setError(errorText(cause, 'Unable to load the call log.'));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, query, direction, outcome, provider, teamId, employeeId, unmatched, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!access.canSeeTeam) return;
    getCallPeople()
      .then(setPeople)
      .catch(() => setPeople(null));
  }, [access.canSeeTeam]);

  const timeZone = organizationTimeZone;
  const first = result && result.total ? (result.page - 1) * result.pageSize + 1 : 0;
  const last = result ? Math.min(result.page * result.pageSize, result.total) : 0;
  const employees = (people?.employees ?? []).filter((person) => !teamId || person.teamId === teamId);

  return (
    <Page
      eyebrow="Sales · Calls"
      title="Call log"
      description="Search every call you can see by contact, number, employee, notes or disposition."
      action={
        <Button kind="secondary" onClick={() => void load()} disabled={loading}>
          <Icon name="refresh" className="size-4" /> Refresh
        </Button>
      }
    >
      <CallsTabs active="log" access={access} onNavigate={onNavigate} />

      <Card className="space-y-4 p-4">
        <RangeFilter value={range} timeZone={timeZone} onChange={filter(setRange)} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search" value={search} onChange={setSearch} placeholder="Name, number, notes…" type="search" />
          <DirectionSelect value={direction} onChange={filter(setDirection)} />
          <Select
            label="Result"
            placeholder="Any result"
            value={outcome}
            onChange={filter(setOutcome)}
            options={(Object.keys(OUTCOME_LABELS) as CallOutcome[]).map((value) => ({ value, label: OUTCOME_LABELS[value] }))}
          />
          <ProviderSelect value={provider} onChange={filter(setProvider)} />
          {access.canSeeTeam && people && (
            <>
              <Select label="Team" placeholder="All teams" value={teamId} onChange={filter(setTeamId)} options={people.teams.map((team) => ({ value: team.id, label: team.name }))} />
              <SearchableSelect
                label="Employee"
                value={employeeId}
                onChange={filter(setEmployeeId)}
                placeholder="Any employee"
                options={employees.map((person) => ({ value: person.id, label: person.fullName }))}
              />
            </>
          )}
          {access.canManage && (
            <label className="flex items-center gap-2 self-end pb-3 text-sm font-semibold">
              <input type="checkbox" checked={unmatched} onChange={(event) => filter(setUnmatched)(event.target.checked)} className="size-4 accent-[var(--theme-primary)]" />
              Only calls not matched to an employee
            </label>
          )}
        </div>
      </Card>

      {error && <Notice error>{error}</Notice>}

      <Card className="overflow-hidden p-0">
        {loading && !result ? (
          <TableSkeleton rows={8} />
        ) : (
          <CallsTable calls={result?.items ?? []} timeZone={timeZone} onOpen={setOpenCallId} showEmployee={access.canSeeTeam || access.canManage} />
        )}
        {result && result.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-app-border px-4 py-3 text-sm">
            <span className="text-app-muted">
              {first.toLocaleString()}–{last.toLocaleString()} of {result.total.toLocaleString()} calls
            </span>
            <div className="flex gap-2">
              <Button kind="secondary" disabled={loading || result.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                <Icon name="chevron-left" className="size-4" /> Newer
              </Button>
              <Button kind="secondary" disabled={loading || result.page >= result.totalPages} onClick={() => setPage((current) => current + 1)}>
                Older <Icon name="chevron-right" className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {openCallId && (
        <CallDetailModal
          callId={openCallId}
          timeZone={timeZone}
          canListen={access.canListen}
          onClose={() => setOpenCallId(null)}
          onOpenEmployee={access.canSeeTeam ? (id) => onNavigate(`/company/sales/calls/employees/${id}`) : undefined}
        />
      )}
    </Page>
  );
}
