import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, ErrorMessage, Field, Loading, Modal, Notice, Page, SegmentedTabs, Select } from '../ui/index.js';
import {
  MEETING_DURATIONS,
  acceptMeeting,
  cancelMeeting,
  completeCalendarConnect,
  declineMeeting,
  disconnectCalendar,
  getAvailability,
  getCalendarConnection,
  joinMeeting,
  listAllMeetings,
  listMeetableClients,
  listMeetingPeople,
  listMyMeetings,
  proposeMeetingTimes,
  recordMeetingOutcome,
  scheduleMeeting,
  setMeetingLink,
  startCalendarConnect,
  type Availability,
  type CalendarConnection,
  type MeetableClient,
  type Meeting,
  type MeetingStatus,
} from './api.js';
import { MEETING_STATUS_LABEL, MEETING_STATUS_TONE, describeHistory, durationMinutes, formatMeetingTime, joinableNow } from './format.js';
import { SlotPicker } from './SlotPicker.js';
import './meetings.css';

type Tab = 'mine' | 'everyone' | 'calendar';
type Dialog =
  | { kind: 'accept' | 'propose' | 'decline' | 'cancel' | 'outcome' | 'link'; meeting: Meeting }
  | { kind: 'book' }
  | null;

const TONE_STYLE: Record<'waiting' | 'good' | 'bad' | 'neutral', string> = {
  waiting: 'border-[#d9a441]/40 bg-[#d9a441]/10 text-[#a87412]',
  good: 'border-app-accent/40 bg-app-accent/10 text-app-accent',
  bad: 'border-[#d86b6b]/40 bg-[#d86b6b]/10 text-app-danger',
  neutral: 'border-app-border text-app-muted',
};

function StatusPill({ status }: { status: MeetingStatus }): React.JSX.Element {
  return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE_STYLE[MEETING_STATUS_TONE[status]]}`}>{MEETING_STATUS_LABEL[status]}</span>;
}

function TextArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }): React.JSX.Element {
  return (
    <label className="block text-xs font-semibold text-app-muted">
      <span className="mb-2 block">{label}</span>
      <textarea value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="ui-form-control min-h-[84px] w-full px-3 py-2.5 text-sm outline-none" />
    </label>
  );
}

/** "Kumar Textiles · Storefront", without repeating a business name the project already carries. */
function clientAndProject(meeting: Meeting): string {
  const business = meeting.client?.businessName ?? 'Client';
  if (!meeting.project) return business;
  return meeting.project.name.toLowerCase().includes(business.toLowerCase()) ? meeting.project.name : `${business} · ${meeting.project.name}`;
}

/**
 * Reads the Google sign-in result from the fragment once and finishes the
 * connection. Kept outside the component so a remount (React's development
 * double render) sees the same result instead of a fragment already cleared.
 */
let pendingCalendarReturn: { at: number; result: Promise<{ connection: CalendarConnection | null; message: string }> } | null = null;

function calendarReturn(): Promise<{ connection: CalendarConnection | null; message: string }> | null {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const code = fragment.get('calendar_code');
  const state = fragment.get('calendar_state');
  const failed = fragment.get('calendar_error');
  if (code || failed) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const result = failed
      ? Promise.resolve({
          connection: null,
          message: failed === 'denied' ? 'Google Calendar was not connected: access was declined.' : 'That Google sign-in could not be used. Try connecting again.',
        })
      : completeCalendarConnect(code!, state ?? '').then((connection) => ({
          connection,
          message: `Google Calendar connected${connection.accountEmail ? ` (${connection.accountEmail})` : ''}. New meetings get a Meet link automatically.`,
        }));
    pendingCalendarReturn = { at: Date.now(), result };
    return result;
  }
  if (pendingCalendarReturn && Date.now() - pendingCalendarReturn.at < 30_000) return pendingCalendarReturn.result;
  return null;
}

function openMeeting(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function MeetingsPage({
  pathname,
  currentUserId,
  organizationTimezone,
  canHost,
  canView,
  canJoin,
  canActForOthers,
}: {
  pathname: string;
  currentUserId: string;
  organizationTimezone: string;
  canHost: boolean;
  canView: boolean;
  canJoin: boolean;
  /** A manager whose meetings:host reach covers other people can answer, move or cancel their meetings. */
  canActForOthers: boolean;
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>(pathname.endsWith('/calendar') ? 'calendar' : canHost ? 'mine' : 'everyone');
  const [mine, setMine] = useState<Meeting[] | null>(null);
  const [everyone, setEveryone] = useState<Meeting[] | null>(null);
  const [calendar, setCalendar] = useState<CalendarConnection | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const focusId = useMemo(() => new URLSearchParams(window.location.search).get('meeting'), []);

  const reload = useCallback(async () => {
    try {
      const [myMeetings, all, connection] = await Promise.all([
        canHost ? listMyMeetings() : Promise.resolve(null),
        canView ? listAllMeetings() : Promise.resolve(null),
        canHost ? getCalendarConnection() : Promise.resolve(null),
      ]);
      setMine(myMeetings);
      setEveryone(all);
      setCalendar(connection);
      setError(null);
    } catch (cause) {
      setError(cause);
    }
  }, [canHost, canView]);

  // Google sends people back here with the sign-in code in the fragment.
  useEffect(() => {
    const returned = calendarReturn();
    if (!returned) return;
    let live = true;
    setTab('calendar');
    returned.then(
      (outcome) => {
        if (!live) return;
        if (outcome.connection) setCalendar(outcome.connection);
        setNotice(outcome.message);
      },
      (cause: unknown) => { if (live) setError(cause); },
    );
    return () => { live = false; };
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      setDialog(null);
      setNotice(done);
      await reload();
    } catch (cause) {
      setError(cause);
    }
  };

  const join = async (meeting: Meeting) => {
    const invited = meeting.host.id === currentUserId || meeting.attendees.some((attendee) => attendee.userId === currentUserId);
    if (invited && meeting.meetUrl) { openMeeting(meeting.meetUrl); return; }
    try {
      const result = await joinMeeting(meeting.id);
      openMeeting(result.meetUrl);
      await reload();
    } catch (cause) {
      setError(cause);
    }
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    ...(canHost ? [{ id: 'mine' as const, label: 'My meetings' }] : []),
    ...(canView ? [{ id: 'everyone' as const, label: 'Everyone' }] : []),
    ...(canHost ? [{ id: 'calendar' as const, label: 'Google Calendar' }] : []),
  ];

  return (
    <Page
      eyebrow="Clients"
      title="Client meetings"
      description="Meeting requests from clients, the meetings you host, and who is meeting whom."
      action={canHost ? <Button onClick={() => setDialog({ kind: 'book' })}>Book a meeting</Button> : undefined}
    >
      <SegmentedTabs
        ariaLabel="Meeting views"
        className="meeting-view-tabs"
        items={tabs.map((item) => ({ ...item, id: `tab-meeting-${item.id}`, controls: 'meetings-panel' }))}
        value={`tab-meeting-${tab}`}
        onChange={(value) => setTab(value.replace('tab-meeting-', '') as Tab)}
        scrollable
      />
      {notice && <Notice>{notice}</Notice>}
      {error !== null && <ErrorMessage cause={error} />}
      <div role="tabpanel" id="meetings-panel" aria-labelledby={`tab-meeting-${tab}`} tabIndex={0} className="min-w-0">
      {tab === 'mine' && canHost && (
        mine === null ? <Loading /> : (
          <MyMeetings
            meetings={mine}
            calendar={calendar}
            currentUserId={currentUserId}
            timeZone={organizationTimezone}
            focusId={focusId}
            onDialog={setDialog}
            onJoin={(meeting) => void join(meeting)}
            onConnect={() => setTab('calendar')}
          />
        )
      )}
      {tab === 'everyone' && canView && (
        everyone === null ? <Loading /> : (
          <EveryoneBoard
            meetings={everyone}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
            currentUserId={currentUserId}
            timeZone={organizationTimezone}
            focusId={focusId}
            canJoin={canJoin}
            canActForOthers={canActForOthers}
            onDialog={setDialog}
            onJoin={(meeting) => void join(meeting)}
          />
        )
      )}
      {tab === 'calendar' && canHost && (
        <CalendarPanel
          connection={calendar}
          onConnect={() => {
            startCalendarConnect().then(({ authorizationUrl }) => window.location.assign(authorizationUrl), setError);
          }}
          onDisconnect={() => void run(async () => setCalendar(await disconnectCalendar()), 'Google Calendar disconnected.')}
        />
      )}
      </div>
      {dialog?.kind === 'book' && (
        <BookMeetingDialog currentUserId={currentUserId} timeZone={organizationTimezone} calendar={calendar} onClose={() => setDialog(null)}
          onBooked={(meeting) => { setDialog(null); setNotice(`Booked "${meeting.title}" for ${formatMeetingTime(meeting.startsAt, organizationTimezone)}.`); void reload(); }} />
      )}
      {dialog && dialog.kind !== 'book' && (
        <MeetingActionDialog dialog={dialog} calendar={calendar} timeZone={organizationTimezone} onClose={() => setDialog(null)} onRun={run} />
      )}
    </Page>
  );
}

function MyMeetings({ meetings, calendar, currentUserId, timeZone, focusId, onDialog, onJoin, onConnect }: {
  meetings: Meeting[];
  calendar: CalendarConnection | null;
  currentUserId: string;
  timeZone: string;
  focusId: string | null;
  onDialog: (dialog: Dialog) => void;
  onJoin: (meeting: Meeting) => void;
  onConnect: () => void;
}): React.JSX.Element {
  const now = Date.now();
  const hosting = (meeting: Meeting) => meeting.host.id === currentUserId;
  const waiting = meetings.filter((meeting) => meeting.status === 'requested' && hosting(meeting)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const offered = meetings.filter((meeting) => meeting.status === 'proposed').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const upcoming = meetings.filter((meeting) => meeting.status === 'confirmed' && new Date(meeting.endsAt).getTime() >= now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const toRecord = meetings.filter((meeting) => meeting.status === 'confirmed' && new Date(meeting.endsAt).getTime() < now && hosting(meeting));
  const past = meetings.filter((meeting) => !['requested', 'proposed', 'confirmed'].includes(meeting.status) || (meeting.status === 'requested' && !hosting(meeting)))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt)).slice(0, 25);
  const card = (meeting: Meeting) => (
    <MeetingCard key={meeting.id} meeting={meeting} currentUserId={currentUserId} timeZone={timeZone} focused={meeting.id === focusId} canAct={hosting(meeting)} canJoin={false} onDialog={onDialog} onJoin={onJoin} />
  );
  return (
    <div className="space-y-5">
      {calendar && calendar.mode === 'oauth' && !calendar.connected && (
        <Notice>
          {calendar.needsReconnect ? 'Your Google Calendar connection stopped working. ' : 'Connect your Google Calendar so clients only see times you are free and meetings get a Meet link automatically. '}
          <button type="button" className="font-semibold underline" onClick={onConnect}>{calendar.needsReconnect ? 'Reconnect' : 'Connect Google Calendar'}</button>
        </Notice>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title="Waiting for your answer"
          empty="No requests are waiting for you."
          emptyHint="New client requests that need your response will show up here."
          emptyKind="requests"
        >{waiting.map(card)}</Section>
        <Section
          title="Coming up"
          empty="Nothing booked yet."
          emptyHint="Meetings you accept or schedule will appear here."
          emptyKind="upcoming"
        >{upcoming.map(card)}</Section>
      </div>
      {offered.length > 0 && <Section title="Waiting for the client to pick a time">{offered.map(card)}</Section>}
      {toRecord.length > 0 && <Section title="How did these go?">{toRecord.map(card)}</Section>}
      {past.length > 0 && <Section title="Earlier">{past.map(card)}</Section>}
    </div>
  );
}

function MeetingEmptyGlyph({ kind }: { kind: 'requests' | 'upcoming' }): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {kind === 'requests' ? (
        <>
          <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 7.6 7.6 0 0 1-3.2-.7L4 20l1.1-4.5A7.5 7.5 0 1 1 20 11.5Z" />
          <circle cx="12.5" cy="11.5" r="2.8" />
          <path d="M12.5 10v1.7l1.1.7" />
        </>
      ) : (
        <>
          <rect x="4" y="5.5" width="16" height="15" rx="2.2" />
          <path d="M8 3.5v4M16 3.5v4M4 9.5h16M8 13h3M8 16.5h6" />
        </>
      )}
    </svg>
  );
}

function Section({ title, empty, emptyHint, emptyKind, children }: {
  title: string;
  empty?: string;
  emptyHint?: string;
  emptyKind?: 'requests' | 'upcoming';
  children: React.ReactNode;
}): React.JSX.Element {
  const items = Array.isArray(children) ? children : [children];
  return (
    <section className="meeting-section ui-card">
      <header className="meeting-section-heading flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-bold sm:text-lg">{title}</h2>
        <span className="meeting-section-count">{items.length}</span>
      </header>
      {items.length === 0 && empty ? (
        <div className="meeting-empty-state">
          <span className="meeting-empty-icon"><MeetingEmptyGlyph kind={emptyKind ?? 'upcoming'} /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-app-foreground">{empty}</p>
            {emptyHint && <p className="mt-1 text-xs leading-5 text-app-muted">{emptyHint}</p>}
          </div>
        </div>
      ) : <div className="meeting-section-list">{items}</div>}
    </section>
  );
}

const SUMMARY: Array<{ status: MeetingStatus; label: string }> = [
  { status: 'requested', label: 'Waiting for an answer' },
  { status: 'proposed', label: 'Other times offered' },
  { status: 'confirmed', label: 'Confirmed' },
  { status: 'declined', label: 'Declined' },
  { status: 'cancelled', label: 'Cancelled' },
  { status: 'expired', label: 'Lapsed' },
];

function EveryoneBoard({ meetings, statusFilter, onStatusFilter, currentUserId, timeZone, focusId, canJoin, canActForOthers, onDialog, onJoin }: {
  meetings: Meeting[];
  statusFilter: string;
  onStatusFilter: (value: string) => void;
  currentUserId: string;
  timeZone: string;
  focusId: string | null;
  canJoin: boolean;
  canActForOthers: boolean;
  onDialog: (dialog: Dialog) => void;
  onJoin: (meeting: Meeting) => void;
}): React.JSX.Element {
  const counts = new Map<MeetingStatus, number>();
  for (const meeting of meetings) counts.set(meeting.status, (counts.get(meeting.status) ?? 0) + 1);
  const moved = meetings.filter((meeting) => meeting.history.some((entry) => entry.event === 'proposed')).length;
  const shown = meetings.filter((meeting) => !statusFilter || meeting.status === statusFilter);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {SUMMARY.map((item) => (
          <button key={item.status} type="button" aria-pressed={statusFilter === item.status} onClick={() => onStatusFilter(statusFilter === item.status ? '' : item.status)}
            className={`ui-card meeting-filter-card ${statusFilter === item.status ? 'is-selected' : ''}`}>
            <p className="font-display text-2xl font-bold">{counts.get(item.status) ?? 0}</p>
            <p className="text-xs text-app-muted">{item.label}</p>
          </button>
        ))}
        <Card className="meeting-count-card">
          <p className="font-display text-2xl font-bold">{moved}</p>
          <p className="text-xs text-app-muted">Moved by the host</p>
        </Card>
      </div>
      <div className="max-w-xs">
        <Select label="Show" value={statusFilter} onChange={onStatusFilter} placeholder="All meetings"
          options={(Object.keys(MEETING_STATUS_LABEL) as MeetingStatus[]).map((status) => ({ value: status, label: MEETING_STATUS_LABEL[status] }))} />
      </div>
      {shown.length === 0 ? <Empty>No meetings to show.</Empty> : shown.map((meeting) => (
        <MeetingCard key={meeting.id} meeting={meeting} currentUserId={currentUserId} timeZone={timeZone} focused={meeting.id === focusId}
          canAct={meeting.host.id === currentUserId || canActForOthers} canJoin={canJoin} showHost onDialog={onDialog} onJoin={onJoin} />
      ))}
    </div>
  );
}

function MeetingCard({ meeting, currentUserId, timeZone, focused, canAct, canJoin, showHost = false, onDialog, onJoin }: {
  meeting: Meeting;
  currentUserId: string;
  timeZone: string;
  focused: boolean;
  canAct: boolean;
  canJoin: boolean;
  showHost?: boolean;
  onDialog: (dialog: Dialog) => void;
  onJoin: (meeting: Meeting) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(focused);
  const minutes = durationMinutes(meeting.startsAt, meeting.endsAt);
  const invited = meeting.host.id === currentUserId || meeting.attendees.some((attendee) => attendee.userId === currentUserId);
  const live = meeting.status === 'confirmed' && new Date(meeting.endsAt).getTime() >= Date.now();
  const past = new Date(meeting.endsAt).getTime() < Date.now();
  const people = meeting.attendees.filter((attendee) => attendee.role !== 'host').map((attendee) => `${attendee.name ?? attendee.email}${attendee.role === 'observer' ? ' (joined)' : ''}`);
  const openProposals = meeting.proposals.filter((proposal) => !proposal.chosenAt && !proposal.withdrawnAt);
  return (
    <Card className={focused ? 'ring-2 ring-app-accent' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-app-muted">
            {clientAndProject(meeting)}
          </p>
          <h3 className="mt-1 font-display text-base font-bold">{formatMeetingTime(meeting.startsAt, timeZone)} · {minutes} min</h3>
          <p className="mt-1 text-sm">{meeting.title}{showHost || meeting.host.id !== currentUserId ? ` — with ${meeting.host.name}` : ''}</p>
          {meeting.agenda && <p className="mt-1 whitespace-pre-line text-sm text-app-muted">{meeting.agenda}</p>}
          {people.length > 0 && <p className="mt-1 text-xs text-app-muted">Also in it: {people.join(', ')}</p>}
          {meeting.status === 'proposed' && openProposals.length > 0 && (
            <p className="mt-1 text-xs text-app-muted">Offered: {openProposals.map((proposal) => formatMeetingTime(proposal.startsAt, timeZone)).join(' · ')}</p>
          )}
          {meeting.declineReason && meeting.status === 'declined' && <p className="mt-1 text-xs text-app-danger">Declined: {meeting.declineReason}</p>}
          {meeting.cancelReason && meeting.status === 'cancelled' && <p className="mt-1 text-xs text-app-danger">Cancelled by {meeting.cancelledBy?.name ?? 'someone'}: {meeting.cancelReason}</p>}
          {meeting.outcomeNote && <p className="mt-1 text-xs text-app-muted">Note: {meeting.outcomeNote}</p>}
          {meeting.calendarError && live && <p className="mt-1 text-xs text-app-danger">{meeting.calendarError}</p>}
        </div>
        <StatusPill status={meeting.status} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {live && meeting.meetUrl && (invited || canJoin) && (
          <Button kind={joinableNow(meeting.startsAt, meeting.endsAt) ? 'primary' : 'secondary'} onClick={() => onJoin(meeting)}>
            {invited ? 'Join meeting' : 'Join as observer'}
          </Button>
        )}
        {canAct && meeting.status === 'requested' && !past && (
          <>
            <Button onClick={() => onDialog({ kind: 'accept', meeting })}>Accept</Button>
            <Button kind="secondary" onClick={() => onDialog({ kind: 'propose', meeting })}>Offer other times</Button>
            <Button kind="danger" onClick={() => onDialog({ kind: 'decline', meeting })}>Decline</Button>
          </>
        )}
        {canAct && meeting.status === 'proposed' && (
          <>
            <Button kind="secondary" onClick={() => onDialog({ kind: 'propose', meeting })}>Change the times</Button>
            <Button kind="danger" onClick={() => onDialog({ kind: 'decline', meeting })}>Decline</Button>
          </>
        )}
        {canAct && live && (
          <>
            {!meeting.meetUrl && <Button kind="secondary" onClick={() => onDialog({ kind: 'link', meeting })}>Add a meeting link</Button>}
            <Button kind="secondary" onClick={() => onDialog({ kind: 'propose', meeting })}>Move it</Button>
            <Button kind="danger" onClick={() => onDialog({ kind: 'cancel', meeting })}>Cancel</Button>
          </>
        )}
        {canAct && meeting.status === 'confirmed' && past && (
          <Button onClick={() => onDialog({ kind: 'outcome', meeting })}>Record how it went</Button>
        )}
        <Button kind="secondary" onClick={() => setOpen((value) => !value)}>{open ? 'Hide history' : 'History'}</Button>
      </div>
      {open && (
        <ol className="mt-3 space-y-1 border-t border-app-border pt-3 text-xs">
          {meeting.history.map((entry, index) => (
            <li key={index} className="flex gap-2">
              <span className="shrink-0 text-app-muted">{formatMeetingTime(entry.at, timeZone)}</span>
              <span>{describeHistory(entry, timeZone)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function MeetingActionDialog({ dialog, calendar, timeZone, onClose, onRun }: {
  dialog: Exclude<Dialog, { kind: 'book' } | null>;
  calendar: CalendarConnection | null;
  timeZone: string;
  onClose: () => void;
  onRun: (action: () => Promise<unknown>, done: string) => Promise<void>;
}): React.JSX.Element {
  const { meeting } = dialog;
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [times, setTimes] = useState<string[]>([]);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [busy, setBusy] = useState(false);
  const minutes = durationMinutes(meeting.startsAt, meeting.endsAt);
  const googleMakesLinks = calendar?.mode === 'service-account' || (calendar?.mode === 'oauth' && calendar.connected);

  useEffect(() => {
    if (dialog.kind !== 'propose') return;
    getAvailability([meeting.host.id], minutes, 21).then(setAvailability, () => setAvailability({ slots: [], calendarUnchecked: [], timezone: timeZone }));
  }, [dialog.kind, meeting.host.id, minutes, timeZone]);

  const submit = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    await onRun(action, done);
    setBusy(false);
  };

  const who = meeting.client?.name ?? 'the client';
  const config: Record<typeof dialog.kind, { title: string; body: React.ReactNode; confirm: string; ready: boolean; action: () => Promise<unknown>; done: string }> = {
    accept: {
      title: 'Accept the meeting',
      body: googleMakesLinks
        ? <p className="text-sm">TapCRM puts it on {meeting.host.name}'s Google Calendar with a Meet link and tells {who}.</p>
        : <Field label="Meeting link (optional)" value={link} onChange={setLink} placeholder="https://meet.google.com/…" hint="Without Google Calendar connected, paste a Meet or Zoom link. You can add it later too." />,
      confirm: 'Accept',
      ready: true,
      action: () => acceptMeeting(meeting.id, link.trim() || null),
      done: `Accepted. ${who} has been told.`,
    },
    propose: {
      title: meeting.status === 'confirmed' ? 'Move the meeting' : 'Offer other times',
      body: (
        <div className="min-w-0 space-y-4">
          <p className="text-sm text-app-muted">Pick up to three times you are free. {who} picks one in the portal.</p>
          <SlotPicker slots={availability?.slots ?? []} timeZone={availability?.timezone ?? timeZone} selected={times} onChange={setTimes} max={3} loading={availability === null} />
          {availability?.calendarUnchecked.length ? <p className="text-xs text-app-muted">Google Calendar not checked: {availability.calendarUnchecked.map((item) => `${item.name} (${item.reason})`).join(', ')}.</p> : null}
          <TextArea label="Note for the client (optional)" value={text} onChange={setText} />
        </div>
      ),
      confirm: 'Send the times',
      ready: times.length > 0,
      action: () => proposeMeetingTimes(meeting.id, times, text.trim() || null),
      done: `Sent ${times.length} time${times.length === 1 ? '' : 's'} to ${who}.`,
    },
    decline: {
      title: 'Decline the request',
      body: <TextArea label="Why? (the client sees this)" value={text} onChange={setText} placeholder="For example: I'm on leave that week — please ask Priya instead." />,
      confirm: 'Decline',
      ready: text.trim().length >= 3,
      action: () => declineMeeting(meeting.id, text.trim()),
      done: `Declined. ${who} has been told.`,
    },
    cancel: {
      title: 'Cancel the meeting',
      body: <TextArea label="Why? (the client sees this)" value={text} onChange={setText} />,
      confirm: 'Cancel the meeting',
      ready: text.trim().length >= 3,
      action: () => cancelMeeting(meeting.id, text.trim()),
      done: `Cancelled. ${who} has been told.`,
    },
    outcome: {
      title: 'How did it go?',
      body: <TextArea label="Note for the team (optional)" value={text} onChange={setText} placeholder="What was agreed, next steps…" />,
      confirm: 'It happened',
      ready: true,
      action: () => recordMeetingOutcome(meeting.id, 'completed', text.trim() || null),
      done: 'Recorded.',
    },
    link: {
      title: 'Add a meeting link',
      body: <Field label="Meeting link" value={link} onChange={setLink} placeholder="https://meet.google.com/…" />,
      confirm: 'Save the link',
      ready: link.trim().startsWith('https://'),
      action: () => setMeetingLink(meeting.id, link.trim()),
      done: `Saved. ${who} has the link.`,
    },
  };
  const current = config[dialog.kind];
  return (
    <Modal title={current.title} onClose={onClose} size={dialog.kind === 'propose' ? 'lg' : 'md'}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          {dialog.kind === 'outcome' && (
            <Button kind="secondary" disabled={busy} onClick={() => void submit(() => recordMeetingOutcome(meeting.id, 'no_show', text.trim() || null), 'Recorded as a no-show.')}>The client didn't join</Button>
          )}
          <Button kind="secondary" onClick={onClose}>Close</Button>
          <Button kind={dialog.kind === 'decline' || dialog.kind === 'cancel' ? 'danger' : 'primary'} disabled={busy || !current.ready} onClick={() => void submit(current.action, current.done)}>{current.confirm}</Button>
        </div>
      )}>
      <p className="mb-3 text-sm text-app-muted">{meeting.client?.businessName ?? 'Client'} · {formatMeetingTime(meeting.startsAt, timeZone)} · {minutes} min</p>
      {current.body}
    </Modal>
  );
}

function BookMeetingDialog({ currentUserId, timeZone, calendar, onClose, onBooked }: {
  currentUserId: string;
  timeZone: string;
  calendar: CalendarConnection | null;
  onClose: () => void;
  onBooked: (meeting: Meeting) => void;
}): React.JSX.Element {
  const [clients, setClients] = useState<MeetableClient[] | null>(null);
  const [people, setPeople] = useState<Array<{ id: string; name: string; role: string | null }>>([]);
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [duration, setDuration] = useState('30');
  const [others, setOthers] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slot, setSlot] = useState<string[]>([]);
  const [link, setLink] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const googleMakesLinks = calendar?.mode === 'service-account' || (calendar?.mode === 'oauth' && calendar.connected);

  useEffect(() => {
    Promise.all([listMeetableClients(), listMeetingPeople()])
      .then(([clientList, peopleList]) => { setClients(clientList); setPeople(peopleList.filter((person) => person.id !== currentUserId)); })
      .catch(setError);
  }, [currentUserId]);

  const client = clients?.find((item) => item.id === clientId);
  useEffect(() => { setProjectId(''); if (client) setTitle(`Meeting with ${client.businessName}`); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Free times change with the people and the length; pick again after a change.
  useEffect(() => {
    setAvailability(null);
    setSlot([]);
    setLoadingSlots(true);
    getAvailability([currentUserId, ...others], Number(duration), 21)
      .then(setAvailability, setError)
      .finally(() => setLoadingSlots(false));
  }, [currentUserId, others, duration]);

  const matches = people.filter((person) => !search.trim() || person.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 30);
  const ready = Boolean(clientId && title.trim() && slot[0]);

  const book = async () => {
    setBusy(true);
    setError(null);
    try {
      onBooked(await scheduleMeeting({
        clientId,
        projectId: projectId || null,
        title: title.trim(),
        agenda: agenda.trim() || null,
        startsAt: slot[0]!,
        durationMinutes: Number(duration),
        staffIds: others,
        meetUrl: link.trim() || null,
      }));
    } catch (cause) {
      setError(cause);
      setBusy(false);
    }
  };

  return (
    <Modal title="Book a meeting with a client" size="lg" onClose={onClose}
      footer={(
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!ready || busy} onClick={() => void book()}>{busy ? 'Booking…' : 'Book meeting'}</Button>
        </div>
      )}>
      {error !== null && <div className="mb-3"><ErrorMessage cause={error} /></div>}
      {clients === null ? <Loading /> : (
        <div className="grid min-w-0 gap-4 [&>*]:min-w-0">
          {clients.length === 0 && <Notice>You are not on any client's project yet, so there is nobody to book with.</Notice>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Client" value={clientId} onChange={setClientId} options={clients.map((item) => ({ value: item.id, label: `${item.businessName} (${item.name})` }))} />
            <Select label="Project (optional)" value={projectId} onChange={setProjectId} placeholder="No particular project"
              options={(client?.projects ?? []).map((project) => ({ value: project.id, label: project.name }))} />
          </div>
          <Field label="Title" value={title} onChange={setTitle} required />
          <TextArea label="What it is about (optional)" value={agenda} onChange={setAgenda} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Length" value={duration} onChange={setDuration} placeholder="Pick a length" options={MEETING_DURATIONS.map((minutes) => ({ value: String(minutes), label: `${minutes} minutes` }))} />
            <div className="text-xs font-semibold text-app-muted">
              <span className="mb-2 block">Colleagues joining (optional)</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people" className="ui-form-control mb-2 w-full px-3 py-2 text-sm outline-none" />
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {matches.map((person) => (
                  <label key={person.id} className="flex items-center gap-2 font-normal text-app-foreground">
                    <input type="checkbox" checked={others.includes(person.id)}
                      onChange={(event) => setOthers((current) => event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id))} />
                    {person.name}{person.role ? <span className="text-app-muted"> · {person.role}</span> : null}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-app-muted">When {others.length ? 'everyone is' : 'you are'} free</p>
            <SlotPicker slots={availability?.slots ?? []} timeZone={availability?.timezone ?? timeZone} selected={slot} onChange={setSlot} loading={loadingSlots} />
            {availability?.calendarUnchecked.length ? (
              <p className="mt-2 text-xs text-app-muted">Google Calendar not checked for {availability.calendarUnchecked.map((item) => item.name).join(', ')}; their TapCRM shifts, leave and meetings still count.</p>
            ) : null}
          </div>
          {!googleMakesLinks && (
            <Field label="Meeting link (optional)" value={link} onChange={setLink} placeholder="https://meet.google.com/…" hint="Connect Google Calendar to get a Meet link automatically." />
          )}
        </div>
      )}
    </Modal>
  );
}

function CalendarPanel({ connection, onConnect, onDisconnect }: {
  connection: CalendarConnection | null;
  onConnect: () => void;
  onDisconnect: () => void;
}): React.JSX.Element {
  if (connection === null) return <Loading />;
  if (connection.mode === 'off') {
    return (
      <Card>
        <h2 className="font-display text-lg font-bold">Google Calendar is not switched on</h2>
        <p className="mt-2 text-sm text-app-muted">Meetings still work: when you accept one, paste a Google Meet or Zoom link and TapCRM sends it to the client. Your administrator can switch on Google Calendar so free times and Meet links come from Google automatically.</p>
      </Card>
    );
  }
  if (connection.mode === 'service-account') {
    return (
      <Card>
        <h2 className="font-display text-lg font-bold">Connected through your company's Google Workspace</h2>
        <p className="mt-2 text-sm text-app-muted">TapCRM reads your free and busy times and puts meetings with a Meet link on your Google Calendar. There is nothing for you to set up.</p>
      </Card>
    );
  }
  return (
    <Card>
      <h2 className="font-display text-lg font-bold">{connection.connected ? 'Google Calendar connected' : 'Connect your Google Calendar'}</h2>
      {connection.connected ? (
        <p className="mt-2 text-sm text-app-muted">Connected{connection.accountEmail ? ` as ${connection.accountEmail}` : ''}. Clients only see times you are free, and meetings you accept go on your calendar with a Meet link.</p>
      ) : (
        <p className="mt-2 text-sm text-app-muted">
          {connection.needsReconnect ? `The connection stopped working${connection.lastError ? ` (${connection.lastError})` : ''}. Connect again to keep Meet links and free times working.` : 'TapCRM will read when you are busy and add the meetings you accept, with a Meet link, to your calendar. It does not read what your other events are about.'}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        {connection.connected
          ? <Button kind="danger" onClick={onDisconnect}>Disconnect</Button>
          : <Button onClick={onConnect}>{connection.needsReconnect ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}</Button>}
      </div>
    </Card>
  );
}
