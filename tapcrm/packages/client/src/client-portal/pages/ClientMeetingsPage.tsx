import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, ErrorMessage, Loading, Modal, Notice, Page, Select } from '../../ui/index.js';
import {
  MEETING_DURATIONS,
  cancelPortalMeeting,
  choosePortalMeetingTime,
  getPortalMeetingHosts,
  getPortalMeetingSlots,
  listPortalMeetings,
  requestPortalMeeting,
  type MeetingSlot,
  type PortalMeeting,
} from '../../meetings/api.js';
import { durationMinutes, formatMeetingTime, joinableNow } from '../../meetings/format.js';
import { SlotPicker } from '../../meetings/SlotPicker.js';
import { getPortalProfile, listPortalProjects, type PortalProject } from '../api/portalApi.js';

const STATUS_TEXT: Record<PortalMeeting['status'], string> = {
  requested: 'Waiting for confirmation',
  proposed: 'Pick a new time',
  confirmed: 'Confirmed',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Lapsed',
  completed: 'Held',
  no_show: 'Missed',
};

export function ClientMeetingsPage({ initialProjectId, onError }: { initialProjectId: string | null; onError: (cause: unknown) => void }): React.JSX.Element {
  const [meetings, setMeetings] = useState<PortalMeeting[] | null>(null);
  const [projects, setProjects] = useState<PortalProject[]>([]);
  const [timeZone, setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [requesting, setRequesting] = useState(initialProjectId !== null);
  const [cancelling, setCancelling] = useState<PortalMeeting | null>(null);

  const reload = useCallback(async () => {
    try {
      setMeetings(await listPortalMeetings());
    } catch (cause) {
      setError(cause);
      onError(cause);
    }
  }, [onError]);

  useEffect(() => {
    void reload();
    listPortalProjects().then(setProjects, () => setProjects([]));
    getPortalProfile().then((profile) => { if (profile.timezone) setTimeZone(profile.timezone); }, () => undefined);
  }, [reload]);

  const choose = async (meeting: PortalMeeting, proposalId: string) => {
    try {
      const updated = await choosePortalMeetingTime(meeting.id, proposalId);
      setNotice(`Booked for ${formatMeetingTime(updated.startsAt, timeZone)} with ${updated.host.name}. You'll get the link by email too.`);
      await reload();
    } catch (cause) {
      setError(cause);
    }
  };

  const now = Date.now();
  const toPick = meetings?.filter((meeting) => meeting.status === 'proposed') ?? [];
  const upcoming = meetings?.filter((meeting) => (meeting.status === 'requested' || meeting.status === 'confirmed') && new Date(meeting.endsAt).getTime() >= now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt)) ?? [];
  const earlier = meetings?.filter((meeting) => !toPick.includes(meeting) && !upcoming.includes(meeting))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt)) ?? [];

  return (
    <Page
      eyebrow="Client portal"
      title="Meetings"
      description="Ask the people working on your projects for a meeting. They confirm it, or offer you another time."
      action={<Button onClick={() => setRequesting(true)} disabled={projects.length === 0}>Request a meeting</Button>}
    >
      {notice && <Notice>{notice}</Notice>}
      {error !== null && <ErrorMessage cause={error} />}
      {meetings === null ? <Loading /> : (
        <>
          {toPick.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-lg font-bold">Pick a new time</h2>
              {toPick.map((meeting) => (
                <Card key={meeting.id}>
                  <MeetingSummary meeting={meeting} timeZone={timeZone} />
                  <p className="mt-3 text-sm">{meeting.host.name} can't make {formatMeetingTime(meeting.startsAt, timeZone)}. Pick one of these times:</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {meeting.proposals.map((proposal) => (
                      <Button key={proposal.id} kind="secondary" onClick={() => void choose(meeting, proposal.id)}>{formatMeetingTime(proposal.startsAt, timeZone)}</Button>
                    ))}
                    {meeting.proposals.length === 0 && <p className="text-sm text-app-muted">The times offered have passed. Ask for a new meeting instead.</p>}
                  </div>
                  <div className="mt-3"><Button kind="danger" onClick={() => setCancelling(meeting)}>None of these work</Button></div>
                </Card>
              ))}
            </section>
          )}
          <section className="space-y-3">
            <h2 className="font-display text-lg font-bold">Coming up</h2>
            {upcoming.length === 0 ? <Empty>No meetings booked. Use “Request a meeting” to ask someone on your project.</Empty> : upcoming.map((meeting) => (
              <Card key={meeting.id}>
                <MeetingSummary meeting={meeting} timeZone={timeZone} />
                <div className="mt-3 flex flex-wrap gap-2">
                  {meeting.status === 'confirmed' && meeting.meetUrl && (
                    <a href={meeting.meetUrl} target="_blank" rel="noopener noreferrer"
                      className={`ui-button rounded-xl px-4 py-2.5 text-sm font-bold ${joinableNow(meeting.startsAt, meeting.endsAt) ? 'ui-primary' : 'border border-app-border'}`}>
                      Join meeting
                    </a>
                  )}
                  {meeting.status === 'confirmed' && !meeting.meetUrl && <p className="text-sm text-app-muted">The meeting link will be sent to you before it starts.</p>}
                  <Button kind="danger" onClick={() => setCancelling(meeting)}>{meeting.status === 'requested' ? 'Withdraw request' : 'Cancel'}</Button>
                </div>
              </Card>
            ))}
          </section>
          {earlier.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-lg font-bold">Earlier</h2>
              {earlier.map((meeting) => <Card key={meeting.id}><MeetingSummary meeting={meeting} timeZone={timeZone} /></Card>)}
            </section>
          )}
        </>
      )}
      {requesting && (
        <RequestMeetingDialog projects={projects} initialProjectId={initialProjectId} timeZone={timeZone} onClose={() => setRequesting(false)}
          onRequested={(meeting) => {
            setRequesting(false);
            setNotice(`Request sent to ${meeting.host.name} for ${formatMeetingTime(meeting.startsAt, timeZone)}. You'll hear back here and by email.`);
            void reload();
          }} />
      )}
      {cancelling && (
        <CancelDialog meeting={cancelling} timeZone={timeZone} onClose={() => setCancelling(null)}
          onCancelled={() => { setCancelling(null); setNotice('Done. The team has been told.'); void reload(); }} />
      )}
    </Page>
  );
}

function MeetingSummary({ meeting, timeZone }: { meeting: PortalMeeting; timeZone: string }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-app-muted">{meeting.project?.name ?? 'Meeting'}</p>
        <h3 className="mt-1 font-display text-base font-bold">{formatMeetingTime(meeting.startsAt, timeZone)} · {durationMinutes(meeting.startsAt, meeting.endsAt)} min</h3>
        <p className="mt-1 text-sm">With {meeting.host.name}{meeting.host.role ? ` (${meeting.host.role})` : ''}</p>
        {meeting.agenda && <p className="mt-1 whitespace-pre-line text-sm text-app-muted">{meeting.agenda}</p>}
        {meeting.declineReason && <p className="mt-1 text-sm text-app-danger">{meeting.host.name}: {meeting.declineReason}</p>}
        {meeting.cancelReason && meeting.cancelledByYou === false && <p className="mt-1 text-sm text-app-danger">Cancelled: {meeting.cancelReason}</p>}
      </div>
      <span className="rounded-full border border-app-border px-2.5 py-0.5 text-xs font-semibold">{STATUS_TEXT[meeting.status]}</span>
    </div>
  );
}

function RequestMeetingDialog({ projects, initialProjectId, timeZone, onClose, onRequested }: {
  projects: PortalProject[];
  initialProjectId: string | null;
  timeZone: string;
  onClose: () => void;
  onRequested: (meeting: PortalMeeting) => void;
}): React.JSX.Element {
  const [projectId, setProjectId] = useState(initialProjectId ?? (projects.length === 1 ? projects[0]!.id : ''));
  const [hosts, setHosts] = useState<Array<{ id: string; name: string; role: string | null }> | null>(null);
  const [hostId, setHostId] = useState('anyone');
  const [duration, setDuration] = useState('30');
  const [slots, setSlots] = useState<MeetingSlot[]>([]);
  const [slotZone, setSlotZone] = useState(timeZone);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [agenda, setAgenda] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!projectId && projects.length === 1) setProjectId(projects[0]!.id); }, [projects, projectId]);
  useEffect(() => {
    setHosts(null);
    setHostId('anyone');
    if (!projectId) return;
    getPortalMeetingHosts(projectId).then((result) => setHosts(result.hosts), setError);
  }, [projectId]);
  useEffect(() => {
    setPicked([]);
    setSlots([]);
    if (!projectId || hosts === null || hosts.length === 0) return;
    setLoadingSlots(true);
    getPortalMeetingSlots(projectId, hostId === 'anyone' ? null : hostId, Number(duration))
      .then((result) => { setSlots(result.slots); setSlotZone(result.timezone || timeZone); }, setError)
      .finally(() => setLoadingSlots(false));
  }, [projectId, hostId, duration, hosts, timeZone]);

  const hostOptions = useMemo(() => [
    { value: 'anyone', label: 'Anyone from the team (first free)' },
    ...(hosts ?? []).map((host) => ({ value: host.id, label: `${host.name}${host.role ? ` — ${host.role}` : ''}` })),
  ], [hosts]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      onRequested(await requestPortalMeeting({
        projectId,
        hostId: hostId === 'anyone' ? null : hostId,
        startsAt: picked[0]!,
        durationMinutes: Number(duration),
        agenda: agenda.trim(),
      }));
    } catch (cause) {
      setError(cause);
      setBusy(false);
    }
  };

  return (
    <Modal title="Request a meeting" size="lg" onClose={onClose}
      footer={(
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !picked[0] || agenda.trim().length < 3} onClick={() => void send()}>{busy ? 'Sending…' : 'Send request'}</Button>
        </div>
      )}>
      {error !== null && <div className="mb-3"><ErrorMessage cause={error} /></div>}
      <div className="grid min-w-0 gap-4 [&>*]:min-w-0">
        {projects.length > 1 && (
          <Select label="Project" value={projectId} onChange={setProjectId} options={projects.map((project) => ({ value: project.id, label: project.name }))} />
        )}
        {projectId && hosts !== null && hosts.length === 0 && (
          <Notice>Nobody on this project takes meetings through the portal yet. Send a message to your project team instead.</Notice>
        )}
        {projectId && (hosts === null || hosts.length > 0) && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Who would you like to meet?" value={hostId} onChange={setHostId} placeholder="Pick someone" options={hostOptions} />
            <Select label="How long?" value={duration} onChange={setDuration} placeholder="Pick a length" options={MEETING_DURATIONS.map((minutes) => ({ value: String(minutes), label: `${minutes} minutes` }))} />
          </div>
        )}
        {projectId && hosts !== null && hosts.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold text-app-muted">Pick a time ({slotZone})</p>
            <SlotPicker slots={slots} timeZone={slotZone} selected={picked} onChange={setPicked} loading={loadingSlots}
              emptyText="No free times in the next three weeks. Try someone else, or a shorter meeting." />
          </div>
        )}
        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-2 block">What would you like to talk about?</span>
          <textarea value={agenda} onChange={(event) => setAgenda(event.target.value)} className="ui-form-control min-h-[84px] w-full px-3 py-2.5 text-sm outline-none"
            placeholder="For example: review the new homepage design" />
        </label>
      </div>
    </Modal>
  );
}

function CancelDialog({ meeting, timeZone, onClose, onCancelled }: { meeting: PortalMeeting; timeZone: string; onClose: () => void; onCancelled: () => void }): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={meeting.status === 'requested' ? 'Withdraw the request?' : 'Cancel the meeting?'} onClose={onClose}
      footer={(
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>Keep it</Button>
          <Button kind="danger" disabled={busy} onClick={() => {
            setBusy(true);
            cancelPortalMeeting(meeting.id, reason.trim() || null).then(onCancelled, (cause) => { setError(cause); setBusy(false); });
          }}>{meeting.status === 'requested' ? 'Withdraw' : 'Cancel the meeting'}</Button>
        </div>
      )}>
      {error !== null && <div className="mb-3"><ErrorMessage cause={error} /></div>}
      <p className="text-sm">With {meeting.host.name}, {formatMeetingTime(meeting.startsAt, timeZone)}.</p>
      <label className="mt-3 block text-xs font-semibold text-app-muted">
        <span className="mb-2 block">Reason (optional)</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} className="ui-form-control min-h-[64px] w-full px-3 py-2.5 text-sm outline-none" />
      </label>
    </Modal>
  );
}
