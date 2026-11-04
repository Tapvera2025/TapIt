import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Icon, Notice, Page, SearchableSelect, TimerRing } from '../../../ui/index.js';
import { getCallOverview, getCallPeople, getCalls, type CallListItem, type CallOverview, type CallPeople } from './api.js';
import { formatDuration, formatTalkTime, percent, timeAgo } from './calls-format.js';
import {
  CallDetailModal,
  CallsTable,
  CallsTabs,
  DailyCallsChart,
  DirectionSelect,
  errorText,
  initialRange,
  NoIntegration,
  OutcomeBreakdown,
  RangeFilter,
  SectionTitle,
  StatGrid,
  StatGridSkeleton,
  SyncFootnote,
  TableSkeleton,
  type CallsAccess,
  type RangeValue,
} from './CallsShared.js';

const PAGE_SIZE = 25;

/**
 * One employee's calls. Without `employeeId` it is the signed-in person's own
 * view ("My calls"); with one it is a manager's drill-down from Team calls.
 */
export function EmployeeCallsPage({
  employeeId,
  currentUserId,
  currentUserName,
  access,
  organizationTimeZone,
  onNavigate,
}: {
  employeeId: string | null;
  currentUserId: string;
  currentUserName: string;
  access: CallsAccess;
  organizationTimeZone: string;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const subjectId = employeeId ?? currentUserId;
  const isSelf = subjectId === currentUserId;
  const [range, setRange] = useState<RangeValue>(() => initialRange(organizationTimeZone));
  const [direction, setDirection] = useState('');
  const [overview, setOverview] = useState<CallOverview | null>(null);
  const [calls, setCalls] = useState<CallListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [people, setPeople] = useState<CallPeople | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openCallId, setOpenCallId] = useState<string | null>(null);

  const filters = useCallback(
    () => ({
      from: range.from,
      to: range.to,
      employeeId: subjectId,
      direction: (direction || undefined) as 'inbound' | 'outbound' | undefined,
    }),
    [range.from, range.to, subjectId, direction],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextOverview, firstPage] = await Promise.all([
        getCallOverview(filters()),
        getCalls({ ...filters(), page: 1, pageSize: PAGE_SIZE }),
      ]);
      setOverview(nextOverview);
      setCalls(firstPage.items);
      setTotal(firstPage.total);
      setPage(1);
      setError(null);
    } catch (cause) {
      setError(errorText(cause, 'Unable to load these calls.'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!access.canSeeTeam) return;
    getCallPeople()
      .then(setPeople)
      .catch(() => setPeople(null));
  }, [access.canSeeTeam]);

  async function loadMore(): Promise<void> {
    setLoadingMore(true);
    try {
      const next = await getCalls({ ...filters(), page: page + 1, pageSize: PAGE_SIZE });
      setCalls((current) => [...current, ...next.items]);
      setPage(next.page);
      setTotal(next.total);
    } catch (cause) {
      setError(errorText(cause, 'Unable to load more calls.'));
    } finally {
      setLoadingMore(false);
    }
  }

  const totals = overview?.totals;
  const timeZone = overview?.timeZone ?? organizationTimeZone;
  const subjectName =
    (isSelf ? currentUserName : null) ??
    people?.employees.find((person) => person.id === subjectId)?.fullName ??
    overview?.employees.find((row) => row.employeeId === subjectId)?.employeeName ??
    'Employee';
  const teamName = people?.employees.find((person) => person.id === subjectId)?.teamName ?? overview?.employees[0]?.teamName ?? null;
  const answeredInbound = totals ? totals.inbound - totals.missedInbound : 0;
  const noConnections = overview !== null && overview.connections.length === 0 && totals?.totalCalls === 0;

  return (
    <Page
      eyebrow="Sales · Calls"
      title={isSelf ? 'My calls' : subjectName}
      description={
        isSelf
          ? 'Your JustCall and Aircall calls, talk time and results.'
          : `${teamName ? `${teamName} · ` : ''}Calls, talk time and results for ${subjectName}.`
      }
      action={
        <div className="flex flex-wrap items-end gap-2">
          {access.canSeeTeam && people && people.employees.length > 0 && (
            <div className="w-64">
              <SearchableSelect
                label="Employee"
                value={subjectId}
                placeholder="Find an employee…"
                onChange={(value) => onNavigate(value && value !== currentUserId ? `/company/sales/calls/employees/${value}` : '/company/sales/calls/me')}
                options={people.employees.map((person) => ({ value: person.id, label: person.teamName ? `${person.fullName} · ${person.teamName}` : person.fullName }))}
              />
            </div>
          )}
          <Button kind="secondary" onClick={() => void load()} disabled={loading}>
            <Icon name="refresh" className="size-4" /> Refresh
          </Button>
        </div>
      }
    >
      <CallsTabs active={isSelf ? 'mine' : 'team'} access={access} onNavigate={onNavigate} />

      <Card className="grid gap-4 p-4 lg:grid-cols-[1fr_14rem] lg:items-end">
        <RangeFilter value={range} timeZone={timeZone} onChange={setRange} />
        <DirectionSelect value={direction} onChange={setDirection} />
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
                { label: 'Calls', value: totals.totalCalls.toLocaleString(), hint: `${totals.inbound} in · ${totals.outbound} out`, icon: 'phone' },
                { label: 'Answered', value: percent(totals.answered, totals.totalCalls), hint: `${totals.answered} connected`, icon: 'check', tone: 'success' },
                { label: 'Missed incoming', value: String(totals.missedInbound), hint: `${totals.voicemail} voicemails`, icon: 'phone-missed', tone: totals.missedInbound ? 'danger' : 'default' },
                { label: 'Talk time', value: formatTalkTime(totals.talkSeconds), hint: 'On connected calls', icon: 'clock' },
                { label: 'Avg. call', value: formatDuration(totals.avgTalkSeconds), hint: 'Per answered call', icon: 'history' },
                { label: 'Contacts', value: totals.uniqueContacts.toLocaleString(), hint: totals.lastCallAt ? `Last call ${timeAgo(totals.lastCallAt)}` : 'No calls yet', icon: 'users' },
              ]}
            />
          ) : null}

          {overview && (
            <div className="grid gap-5 xl:grid-cols-3">
              <Card className="flex flex-col xl:col-span-2">
                <SectionTitle title="Calls per day" description={`${overview.from} to ${overview.to}`} />
                <DailyCallsChart points={overview.daily} />
              </Card>
              <Card>
                <SectionTitle title="Results" />
                <div className="grid place-items-center pb-4">
                  <TimerRing
                    value={answeredInbound}
                    max={totals?.inbound ?? 0}
                    label="Incoming answer rate"
                    valueLabel={percent(answeredInbound, totals?.inbound ?? 0)}
                    caption="incoming answered"
                    className="size-36"
                  />
                </div>
                <OutcomeBreakdown outcomes={overview.outcomes} total={totals?.totalCalls ?? 0} />
              </Card>
            </div>
          )}

          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-end justify-between gap-2 p-5 pb-3">
              <div>
                <h2 className="font-display text-lg font-bold">Calls</h2>
                <p className="mt-0.5 text-xs text-app-muted">
                  {total ? `${total.toLocaleString()} in this period · newest first` : 'Newest first'}
                  {access.canListen ? ' · open a call to play its recording' : ''}
                </p>
              </div>
            </div>
            {loading && calls.length === 0 ? (
              <TableSkeleton />
            ) : (
              <CallsTable calls={calls} timeZone={timeZone} onOpen={setOpenCallId} showEmployee={false} emptyText="No calls in this period." />
            )}
            {calls.length < total && (
              <div className="border-t border-app-border p-4 text-center">
                <Button kind="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : `Show more (${(total - calls.length).toLocaleString()} left)`}
                </Button>
              </div>
            )}
          </Card>
          {overview && <SyncFootnote connections={overview.connections} />}
        </>
      )}

      {openCallId && (
        <CallDetailModal callId={openCallId} timeZone={timeZone} canListen={access.canListen} onClose={() => setOpenCallId(null)} />
      )}
    </Page>
  );
}
