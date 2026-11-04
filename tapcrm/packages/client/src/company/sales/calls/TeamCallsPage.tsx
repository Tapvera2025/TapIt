import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart, Button, Card, Icon, Notice, Page, Select, TimerRing } from '../../../ui/index.js';
import { getCallOverview, getCallPeople, type CallOverview, type CallPeople, type EmployeeCallStats, type TelephonyProvider } from './api.js';
import { formatDuration, formatTalkTime, percent, timeAgo } from './calls-format.js';
import {
  CALLS_PATHS,
  CallsTabs,
  DailyCallsChart,
  DirectionSelect,
  errorText,
  HourlyStrip,
  initialRange,
  NoIntegration,
  OutcomeBreakdown,
  ProviderSelect,
  RangeFilter,
  SectionTitle,
  StatGrid,
  StatGridSkeleton,
  SyncFootnote,
  type CallsAccess,
  type RangeValue,
} from './CallsShared.js';

type SortKey = 'totalCalls' | 'talkSeconds' | 'answerRate' | 'missedInbound' | 'avgTalkSeconds';

const SORT_LABELS: Readonly<Record<SortKey, string>> = {
  totalCalls: 'Most calls',
  talkSeconds: 'Most talk time',
  answerRate: 'Best answer rate',
  missedInbound: 'Most missed',
  avgTalkSeconds: 'Longest calls',
};

function answerRate(row: Pick<EmployeeCallStats, 'inbound' | 'missedInbound'>): number {
  return row.inbound ? (row.inbound - row.missedInbound) / row.inbound : 0;
}

export function TeamCallsPage({
  access,
  organizationTimeZone,
  onNavigate,
}: {
  access: CallsAccess;
  organizationTimeZone: string;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const [range, setRange] = useState<RangeValue>(() => initialRange(organizationTimeZone));
  const [teamId, setTeamId] = useState('');
  const [provider, setProvider] = useState('');
  const [direction, setDirection] = useState('');
  const [sort, setSort] = useState<SortKey>('totalCalls');
  const [overview, setOverview] = useState<CallOverview | null>(null);
  const [people, setPeople] = useState<CallPeople | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getCallOverview({
        from: range.from,
        to: range.to,
        teamId: teamId || undefined,
        provider: (provider || undefined) as TelephonyProvider | undefined,
        direction: (direction || undefined) as 'inbound' | 'outbound' | undefined,
      });
      setOverview(next);
      setError(null);
    } catch (cause) {
      setError(errorText(cause, 'Unable to load call analytics.'));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, teamId, provider, direction]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    getCallPeople()
      .then(setPeople)
      .catch(() => setPeople({ employees: [], teams: [] }));
  }, []);

  const employees = useMemo(() => {
    const rows = [...(overview?.employees ?? [])];
    const value = (row: EmployeeCallStats): number => (sort === 'answerRate' ? answerRate(row) : row[sort]);
    return rows.sort((a, b) => value(b) - value(a) || (a.employeeName ?? '~').localeCompare(b.employeeName ?? '~'));
  }, [overview, sort]);

  const unmatched = overview?.employees.find((row) => row.employeeId === null);
  const totals = overview?.totals;
  const timeZone = overview?.timeZone ?? organizationTimeZone;
  const noConnections = overview !== null && overview.connections.length === 0 && totals?.totalCalls === 0;
  const answeredInbound = totals ? totals.inbound - totals.missedInbound : 0;
  const leaders = employees
    .filter((row) => row.employeeId !== null && row.talkSeconds > 0)
    .sort((a, b) => b.talkSeconds - a.talkSeconds)
    .slice(0, 6);
  const topTalkers = leaders.map((row) => ({ label: chartLabel(row.employeeName ?? '', leaders.map((other) => other.employeeName ?? '')), value: Math.round(row.talkSeconds / 60) }));

  return (
    <Page
      eyebrow="Sales · Calls"
      title="Team calls"
      description="Every JustCall and Aircall call, matched to your people by email. Numbers cover the employees you can see."
      action={
        <Button kind="secondary" onClick={() => void load()} disabled={loading}>
          <Icon name="refresh" className="size-4" /> Refresh
        </Button>
      }
    >
      <CallsTabs active="team" access={access} onNavigate={onNavigate} />

      <Card className="space-y-4 p-4">
        <RangeFilter value={range} timeZone={timeZone} onChange={setRange} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Team"
            value={teamId}
            onChange={setTeamId}
            placeholder="All teams"
            options={(people?.teams ?? []).map((team) => ({ value: team.id, label: team.name }))}
          />
          <ProviderSelect value={provider} onChange={setProvider} />
          <DirectionSelect value={direction} onChange={setDirection} />
        </div>
      </Card>

      {error && <Notice error>{error}</Notice>}

      {noConnections ? (
        <NoIntegration canManage={access.canManage} onNavigate={onNavigate} />
      ) : (
        <>
          {loading && !overview ? (
            <StatGridSkeleton />
          ) : totals ? (
            <StatGrid
              items={[
                { label: 'Total calls', value: totals.totalCalls.toLocaleString(), hint: `${totals.inbound} in · ${totals.outbound} out`, icon: 'phone' },
                { label: 'Answered', value: percent(totals.answered, totals.totalCalls), hint: `${totals.answered.toLocaleString()} calls connected`, icon: 'check', tone: 'success' },
                { label: 'Missed incoming', value: totals.missedInbound.toLocaleString(), hint: `${totals.voicemail} left a voicemail`, icon: 'phone-missed', tone: totals.missedInbound ? 'danger' : 'default' },
                { label: 'Talk time', value: formatTalkTime(totals.talkSeconds), hint: 'On connected calls', icon: 'clock' },
                { label: 'Avg. call', value: formatDuration(totals.avgTalkSeconds), hint: 'Per answered call', icon: 'history' },
                { label: 'Contacts reached', value: totals.uniqueContacts.toLocaleString(), hint: totals.lastCallAt ? `Last call ${timeAgo(totals.lastCallAt)}` : 'No calls yet', icon: 'users' },
              ]}
            />
          ) : null}

          {overview && (
            <>
              <div className="grid gap-5 xl:grid-cols-3">
                <Card className="flex flex-col xl:col-span-2">
                  <SectionTitle title="Calls per day" description={`${overview.from} to ${overview.to}, ${timeZone} days`} />
                  <DailyCallsChart points={overview.daily} />
                </Card>
                <Card>
                  <SectionTitle title="Incoming answer rate" description="Share of incoming calls someone picked up" />
                  <div className="grid place-items-center py-2">
                    <TimerRing
                      value={answeredInbound}
                      max={totals?.inbound ?? 0}
                      label="Incoming answer rate"
                      valueLabel={percent(answeredInbound, totals?.inbound ?? 0)}
                      caption={`${answeredInbound} of ${totals?.inbound ?? 0} answered`}
                      className="size-40"
                    />
                  </div>
                  <div className="mt-4">
                    <OutcomeBreakdown outcomes={overview.outcomes} total={totals?.totalCalls ?? 0} />
                  </div>
                </Card>
              </div>

              <Card className="overflow-hidden p-0">
                  <div className="flex flex-wrap items-end justify-between gap-3 p-5 pb-3">
                    <div>
                      <h2 className="font-display text-lg font-bold">By employee</h2>
                      <p className="mt-0.5 text-xs text-app-muted">Open an employee for their calls, trend and recordings.</p>
                    </div>
                    <div className="w-48">
                      <Select
                        label="Sort by"
                        value={sort}
                        onChange={(value) => setSort((value || 'totalCalls') as SortKey)}
                        options={(Object.keys(SORT_LABELS) as SortKey[]).map((key) => ({ value: key, label: SORT_LABELS[key] }))}
                      />
                    </div>
                  </div>
                  <EmployeeLeaderboard rows={employees} onOpen={(id) => onNavigate(`/company/sales/calls/employees/${id}`)} />
              </Card>

              <div className="grid gap-5 lg:grid-cols-2">
                <Card>
                  <SectionTitle title="When calls happen" description={`Hour of day, ${timeZone}`} />
                  <HourlyStrip hourly={overview.hourly} />
                </Card>
                <Card className="flex h-[300px] flex-col">
                  <SectionTitle title="Talk time leaders" description="Minutes on connected calls" />
                  <BarChart data={topTalkers} label="Talk minutes by employee" />
                </Card>
              </div>

              {unmatched && access.canManage && (
                <Notice>
                  <span className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                      {unmatched.totalCalls} {unmatched.totalCalls === 1 ? 'call belongs' : 'calls belong'} to platform users who are not matched to an employee, so they
                      only show here for admins.
                    </span>
                    <Button kind="secondary" onClick={() => onNavigate(CALLS_PATHS.integrations)}>
                      Match users
                    </Button>
                  </span>
                </Notice>
              )}
              <SyncFootnote connections={overview.connections} />
            </>
          )}
        </>
      )}
    </Page>
  );
}

/** A short, unique chart label: first name, then first name and last initial, then the full name. */
function chartLabel(name: string, all: readonly string[]): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? name;
  const firstOf = (value: string) => value.trim().split(/\s+/)[0] ?? value;
  if (all.filter((other) => firstOf(other) === first).length <= 1) return first;
  const short = parts.length > 1 ? `${first} ${parts[parts.length - 1]![0]}.` : first;
  const shortOf = (value: string) => {
    const words = value.trim().split(/\s+/);
    return words.length > 1 ? `${words[0]} ${words[words.length - 1]![0]}.` : (words[0] ?? value);
  };
  return all.filter((other) => shortOf(other) === short).length <= 1 ? short : name;
}

function EmployeeLeaderboard({ rows, onOpen }: { rows: readonly EmployeeCallStats[]; onOpen: (employeeId: string) => void }): React.JSX.Element {
  if (!rows.length) return <p className="px-5 pb-6 text-sm text-app-muted">No calls in this period.</p>;
  const max = Math.max(1, ...rows.map((row) => row.totalCalls));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-y border-app-border text-left text-[11px] font-bold uppercase tracking-wider text-app-muted [&>th]:whitespace-nowrap">
            <th className="px-5 py-3">Employee</th>
            <th className="px-3 py-3">Calls</th>
            <th className="px-3 py-3 text-right">In / Out</th>
            <th className="px-3 py-3 text-right">Answer rate</th>
            <th className="px-3 py-3 text-right">Missed</th>
            <th className="px-3 py-3 text-right">Talk time</th>
            <th className="px-5 py-3 text-right">Avg. call</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border">
          {rows.map((row) => {
            const clickable = row.employeeId !== null;
            return (
              <tr
                key={row.employeeId ?? 'unmatched'}
                className={clickable ? 'cursor-pointer transition hover:bg-app-background/70' : 'bg-app-danger/5'}
                onClick={() => row.employeeId && onOpen(row.employeeId)}
              >
                <td className="px-5 py-3">
                  <span className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-app-accent/10 text-xs font-bold text-app-accent">
                      {(row.employeeName ?? '?')
                        .split(' ')
                        .map((part) => part[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold">{row.employeeName ?? 'Not matched to an employee'}</span>
                      <span className="block text-xs text-app-muted">{row.teamName ?? (row.employeeId ? 'No team' : 'Map these users in Integrations')}</span>
                    </span>
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span className="flex items-center gap-2">
                    <span className="w-10 font-bold tabular-nums">{row.totalCalls}</span>
                    <span className="chart-progress-track hidden h-1.5 w-24 overflow-hidden rounded-full sm:block">
                      <span className="chart-progress block h-full rounded-full" style={{ width: `${(row.totalCalls / max) * 100}%` }} />
                    </span>
                  </span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-app-muted">
                  {row.inbound} / {row.outbound}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums">{row.inbound ? percent(row.inbound - row.missedInbound, row.inbound) : '—'}</td>
                <td className={`px-3 py-3 text-right tabular-nums ${row.missedInbound ? 'font-semibold text-app-danger' : 'text-app-muted'}`}>{row.missedInbound}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatDuration(row.talkSeconds)}</td>
                <td className="px-5 py-3 text-right tabular-nums text-app-muted">{formatDuration(row.avgTalkSeconds)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
