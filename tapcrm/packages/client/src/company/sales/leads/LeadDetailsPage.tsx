import { useEffect, useState, type ReactNode } from 'react';
import { Button, Card, Field, Page } from '../../../ui/index.js';
import { acceptHandover, callbackOutcome, createCallback, createHandover, declineHandover, getCallbacks, getHandoverTargets, getHandovers, getLead, recordHandoverDisposition, updateCallback, updateLeadStatus, type Handover, type HandoverTarget, type Lead, type LeadCallback } from './api.js';
import { anHourLater, callbackStatusLabel, formatCallbackDate, organizationLocalToIso, organizationNowLocal, sentenceLabel, sortCallbacks } from './callback-ui.js';
import { ReassignModal } from './ReassignModal.js';
import { LeadStatusPanel } from './LeadStatusPanel.js';
import { isClosedLeadStatus, isHandedOverAway, leadStatusLabel, lossReasonLabel } from './lead-status.js';
import { convertedDealId, leadActivityLabel } from './lead-activity.js';
import { createDeal } from '../deals/api.js';
import { getCalls, type CallListItem } from '../calls/api.js';
import { directionLabel, formatCallTime, OUTCOME_LABELS, PROVIDER_NAMES } from '../calls/calls-format.js';
import { isStillStalled, LEAD_ANCHORS, leadGuidance, leadSteps } from '../guide/lead-guidance.js';
import { cannotOpen, mailHref, telHref, type GuideCommand } from '../guide/guidance.js';
import { SalesCoach, StepTracker, focusGuideTarget, useSalesGuide } from '../guide/SalesGuide.js';
import { IdentityApiError } from '../../../identity/api/authApi.js';
import { subscribeRealtimeEvent } from '../../live/realtimeClient.js';

/**
 * What to show under "This lead can't be opened". A refusal (403) or a missing
 * lead (404) is already explained in plain words on the page, so the server's
 * technical reason is left out; anything unexpected keeps its message so it
 * can be reported.
 */
function leadLoadFailureDetail(cause: unknown): string | null {
  if (cause instanceof IdentityApiError && (cause.status === 403 || cause.status === 404)) return null;
  return cause instanceof Error ? cause.message : 'Unable to load lead.';
}

export function LeadDetailsPage({ id, currentUserId, organizationTimezone, canReassign = false, canTransferSourcingCredit = false, canCreateDeal = false, canEditLead = false, canViewCalls = false, canManageCallbacks = false, onBack, onNavigate }: { id: string; currentUserId: string; organizationTimezone: string; canReassign?: boolean; canTransferSourcingCredit?: boolean; canCreateDeal?: boolean; canEditLead?: boolean; canViewCalls?: boolean; canManageCallbacks?: boolean; onBack: () => void; onNavigate?: (path: string) => void }): React.JSX.Element {
  const [lead, setLead] = useState<Lead | null>(null);
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [callbacks, setCallbacks] = useState<LeadCallback[]>([]);
  const [targets, setTargets] = useState<HandoverTarget[]>([]);
  const [calls, setCalls] = useState<CallListItem[]>([]);
  const [callsLoading, setCallsLoading] = useState(false);
  const [callsError, setCallsError] = useState('');
  const [loadFailure, setLoadFailure] = useState<{ detail: string | null } | null>(null);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const guideMode = useSalesGuide()?.mode;
  const navigate = onNavigate ?? (() => undefined);

  const fetchLead = () => Promise.all([getLead(id), getHandovers(id), getCallbacks(id)])
    .then(([nextLead, nextHandovers, nextCallbacks]) => {
      setLead(nextLead);
      setHandovers(nextHandovers);
      setCallbacks(nextCallbacks);
      setLoadFailure(null);
    });
  const reload = () => fetchLead().catch((cause) => setLoadFailure({ detail: leadLoadFailureDetail(cause) }));
  // A background check keeps what is on screen unless the lead is now refused
  // or gone; a passing network hiccup does not replace the page with an error.
  const refreshInBackground = () => fetchLead().catch((cause) => {
    const detail = leadLoadFailureDetail(cause);
    if (detail === null) setLoadFailure({ detail });
  });

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // When the lead changes hands, the server tells its old and new holder
  // (sales.lead.reassigned), so an open page reloads instead of offering
  // actions its viewer no longer has. Coming back to the tab checks again, in
  // case the live connection was down at the time.
  useEffect(() => {
    const stopListening = subscribeRealtimeEvent<{ leadId?: string }>('sales.lead.reassigned', (payload) => {
      if (payload?.leadId === id) void refreshInBackground();
    });
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refreshInBackground();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopListening();
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Only the person on the call (the lead's current holder) can hand it over,
  // so only they need the list of people who can take it.
  const viewerHoldsLead = lead !== null && lead.currentHolderId === currentUserId;
  useEffect(() => {
    if (!viewerHoldsLead) {
      setTargets([]);
      return;
    }
    void getHandoverTargets(id).then(setTargets).catch(() => setTargets([]));
  }, [id, viewerHoldsLead]);

  useEffect(() => {
    if (!canViewCalls || !lead?.phone || !normalizePhone(lead.phone)) {
      setCalls([]);
      setCallsError('');
      setCallsLoading(false);
      return;
    }
    let current = true;
    setCallsLoading(true);
    getCalls({ search: lead.phone, page: 1, pageSize: 50 })
      .then((result) => {
        if (!current) return;
        const phone = normalizePhone(lead.phone);
        setCalls(result.items.filter((call) => normalizePhone(call.contactNumber) === phone).slice(0, 15));
        setCallsError('');
      })
      .catch((cause: unknown) => {
        if (current) setCallsError(cause instanceof Error ? cause.message : 'Unable to load matching calls.');
      })
      .finally(() => { if (current) setCallsLoading(false); });
    return () => { current = false; };
  }, [canViewCalls, lead?.phone]);

  if (loadFailure) {
    return (
      <Page eyebrow="Sales" title="Lead">
        <SalesCoach guidance={cannotOpen('Lead', 'lead', '/company/sales/leads')} onNavigate={navigate} />
        <p className="font-semibold">This lead can’t be opened.</p>
        <p className="mt-1 text-sm text-app-muted">It may have been moved to someone else, it may be outside the leads your role can see, or it no longer exists.</p>
        {loadFailure.detail && <p className="mt-1 text-xs text-app-muted">{loadFailure.detail}</p>}
        <Button className="mt-4" kind="secondary" onClick={onBack}>Back to leads</Button>
      </Page>
    );
  }
  if (!lead) return <Page eyebrow="Sales" title="Lead"><p className="text-sm text-app-muted">Loading lead…</p></Page>;

  const closed = isClosedLeadStatus(lead.status);
  const isHolder = lead.currentHolderId === currentUserId;
  // After an accepted handover the agent who handed it over can still see the
  // lead, but the person who took it works it until a manager reassigns it.
  const handedAway = isHandedOverAway(lead, currentUserId);
  const canEditThisLead = canEditLead && !handedAway;
  const canConvert = canCreateDeal && isHolder && !closed;
  const dealId = lead.activities.map(convertedDealId).find((value): value is string => Boolean(value)) ?? null;
  const guidance = leadGuidance({
    lead,
    callbacks,
    handovers,
    dealId,
    viewer: { id: currentUserId, canEditLead: canEditThisLead, canCreateDeal, canReassign },
    now: new Date(),
    formatWhen: (iso) => formatCallbackDate(iso, organizationTimezone),
  });

  async function handleCommand(command: GuideCommand): Promise<void> {
    if (!lead) return;
    switch (command.type) {
      case 'lead-status':
        await updateLeadStatus(lead.id, command.status);
        await reload();
        return;
      case 'convert-lead':
        setConvertOpen(true);
        return;
      case 'reassign-lead':
        setReassignOpen(true);
        return;
      case 'accept-handover':
        await acceptHandover(command.handoverId);
        await reload();
        return;
      case 'decline-handover':
        await declineHandover(command.handoverId, 'Unable to take this call');
        await reload();
        return;
      default:
        return;
    }
  }

  const action = (
    <div className="flex flex-wrap gap-2">
      {canConvert && <Button kind="secondary" onClick={() => setConvertOpen(true)}>Qualify into a deal</Button>}
      {canReassign && !closed && <Button kind="secondary" onClick={() => setReassignOpen(true)}>{lead.ownerId ? 'Reassign' : 'Assign an owner'}</Button>}
      {dealId && onNavigate && <Button kind="secondary" onClick={() => onNavigate(`/company/sales/deals/${dealId}`)}>Open the deal</Button>}
      <Button kind="secondary" onClick={onBack}>Back to leads</Button>
    </div>
  );
  const timeline = [
    ...lead.activities.map((activity) => ({ kind: 'activity' as const, at: activity.createdAt, activity })),
    ...calls.map((call) => ({ kind: 'call' as const, at: call.startedAt, call })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const pendingCallback = callbacks.find((callback) => callback.status === 'pending');
  const holderLabel = lead.currentHolderId === currentUserId ? 'You' : lead.currentHolderName;
  const ownerLabel = lead.ownerId === currentUserId ? 'You' : lead.ownerName;
  const showHandover = handovers.length > 0 || (!closed && isHolder);
  const showCallbacks = callbacks.length > 0 || ((isHolder || (lead.ownerId === currentUserId && !handedAway)) && !closed);

  return (
    <Page eyebrow="Sales" title={lead.contactName} description={`Lead #${lead.leadNumber}${lead.companyName ? ` · ${lead.companyName}` : ''}`} action={action}>
      <SalesCoach guidance={guidance} onCommand={handleCommand} onNavigate={navigate} />
      {reassignOpen && <ReassignModal lead={lead} canTransferSourcingCredit={canTransferSourcingCredit} onClose={() => setReassignOpen(false)} onReassigned={(updated) => { setLead(updated); void reload(); }} />}
      {convertOpen && <ConvertToDealModal lead={lead} onClose={() => setConvertOpen(false)} onCreated={(newDealId) => { setConvertOpen(false); if (onNavigate) onNavigate(`/company/sales/deals/${newDealId}`); }} />}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StepTracker steps={leadSteps(lead)} label="Lead progress" />
          <span className="rounded-full bg-app-background px-3 py-1 text-xs font-bold">{leadStatusLabel(lead.status)}</span>
        </div>
        {guideMode === 'closed' && (
          <p className="mt-3 border-t border-app-border pt-3 text-sm">
            <span className="font-semibold">Next step:</span> {guidance.title}
          </p>
        )}
      </Card>

      <div className="@container">
        <div className="grid gap-5 @3xl:grid-cols-[minmax(0,1fr)_19rem]">
          <Card className="min-w-0">
            <DetailGroup title="Contact" items={[
              { label: 'Phone', value: lead.phone ? <ContactLink href={telHref(lead.phone)}>{lead.phone}</ContactLink> : null },
              { label: 'Email', value: lead.email ? <ContactLink href={mailHref(lead.email)}>{lead.email}</ContactLink> : null },
              { label: 'Company', value: lead.companyName },
              { label: 'Location', value: lead.location },
              { label: 'Language', value: lead.languagePreference },
            ]} />
            <DetailGroup title="Enquiry" items={[
              { label: 'What they need', value: lead.requirement, wide: true },
              { label: 'Source', value: `${lead.sourceName}${lead.sourceDirection ? ` (${lead.sourceDirection === 'inbound' ? 'they contacted us' : 'we found them'})` : ''}` },
              { label: 'Campaign', value: lead.campaignName },
              { label: 'Notes', value: lead.intakeNotes ? <span className="whitespace-pre-wrap font-normal">{lead.intakeNotes}</span> : null, wide: true },
            ]} />
            <DetailGroup title="Who has it" items={[
              { label: 'Owner', value: ownerLabel ?? (lead.bidState === 'pool_open' ? 'Nobody yet (in the Bid Pool)' : 'Nobody yet') },
              { label: 'Working it now', value: lead.currentHolderId && lead.currentHolderId !== lead.ownerId ? holderLabel : null },
              { label: 'Sales team', value: lead.salesTeamName },
              { label: 'Territory', value: lead.territoryName },
            ]} />
            <DetailGroup title="Good to know" items={[
              { label: 'Lost because', value: lead.lossReason ? `${lossReasonLabel(lead.lossReason)}${lead.lostAt ? ` · ${new Date(lead.lostAt).toLocaleDateString()}` : ''}` : null },
              { label: 'Stalled', value: isStillStalled(lead) ? (lead.stalledReason === 'missed_callback' ? 'A callback was missed' : 'No activity for a while') : null },
              { label: 'Earlier lead', value: lead.previousLeadId && onNavigate ? <button type="button" className="font-semibold text-app-accent underline" onClick={() => onNavigate(`/company/sales/leads/${lead.previousLeadId}`)}>Open the earlier lead</button> : null },
            ]} />
          </Card>

          <div className="space-y-5">
            <div id={LEAD_ANCHORS.status} className="rounded-2xl"><LeadStatusPanel lead={lead} canEdit={canEditThisLead} lockedNote={handedAway ? `${lead.currentHolderName ?? 'A colleague'} took this lead from you in a handover and works it now. You can see it, but you can’t change its status until a manager gives it back to you.` : undefined} onChanged={reload} /></div>
            {showCallbacks && <CallbackPanel lead={lead} currentUserId={currentUserId} organizationTimezone={organizationTimezone} callbacks={callbacks} canManage={canManageCallbacks && !handedAway} handedAway={handedAway} onReload={reload} />}
            {showHandover && <HandoverPanel lead={lead} currentUserId={currentUserId} organizationTimezone={organizationTimezone} handovers={handovers} targets={targets} onReload={reload} />}
          </div>

          <Card className="min-w-0 @3xl:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold">Timeline</h2>
                <p className="mt-1 text-xs text-app-muted">Everything that happened to this lead, newest first{canViewCalls ? ', with synced calls to and from its phone number' : ''}.</p>
              </div>
              {canViewCalls && onNavigate && <Button kind="secondary" onClick={() => onNavigate('/company/sales/calls/log')}>Open call log</Button>}
            </div>
            {callsError && <p className="mt-3 text-sm text-app-danger" role="alert">{callsError}</p>}
            {callsLoading && <p className="mt-4 text-sm text-app-muted">Checking synced calls for this phone number…</p>}
            {timeline.length > 0 ? (
              <ol className="mt-5 space-y-4">
                {timeline.map((entry) => entry.kind === 'activity' ? (
                  <li key={`activity-${entry.activity.id}`} className="border-l-2 border-app-accent pl-4">
                    <p className="text-sm font-semibold">{leadActivityLabel(entry.activity)}</p>
                    <p className="mt-1 text-xs text-app-muted">{new Date(entry.activity.createdAt).toLocaleString()}</p>
                    {convertedDealId(entry.activity) && onNavigate && <button type="button" className="mt-1 text-xs font-semibold text-app-accent underline" onClick={() => onNavigate(`/company/sales/deals/${convertedDealId(entry.activity)}`)}>Open deal</button>}
                  </li>
                ) : (
                  <li key={`call-${entry.call.id}`} className="border-l-2 border-app-border pl-4">
                    <p className="text-sm font-semibold">{directionLabel(entry.call.direction)} call · {OUTCOME_LABELS[entry.call.outcome]}</p>
                    <p className="mt-1 text-xs text-app-muted">{PROVIDER_NAMES[entry.call.provider]} · {formatCallTime(entry.call.startedAt, organizationTimezone)} · {entry.call.employeeName ?? entry.call.agentName ?? 'Unmatched caller'}</p>
                    {entry.call.disposition && <p className="mt-1 text-xs">Disposition: {entry.call.disposition}</p>}
                    {(entry.call.outcome === 'missed' || entry.call.outcome === 'voicemail' || entry.call.outcome === 'abandoned') && !pendingCallback && isHolder && !closed && <button type="button" className="mt-2 text-xs font-semibold text-app-accent underline" onClick={() => focusGuideTarget(LEAD_ANCHORS.callbacks)}>Book a callback</button>}
                  </li>
                ))}
              </ol>
            ) : !callsLoading && <p className="mt-4 text-sm text-app-muted">Nothing has happened on this lead yet.</p>}
          </Card>
        </div>
      </div>
    </Page>
  );
}

function normalizePhone(value: string | null | undefined): string {
  return value?.replaceAll(/\D/g, '') ?? '';
}

interface DetailItem {
  readonly label: string;
  readonly value: ReactNode;
  readonly wide?: boolean;
}

/** A titled block of details. Empty details are left out (never shown as "—"), and so is an empty block. */
function DetailGroup({ title, items }: { title: string; items: readonly DetailItem[] }): React.JSX.Element | null {
  const filled = items.filter((item) => item.value !== null && item.value !== undefined && item.value !== '');
  if (filled.length === 0) return null;
  return (
    <section className="border-b border-app-border pb-4 pt-4 first:pt-0 last:border-0 last:pb-0">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-app-muted">{title}</h2>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {filled.map((item) => (
          <div key={item.label} className={item.wide ? 'sm:col-span-2' : undefined}>
            <dt className="text-xs font-semibold text-app-muted">{item.label}</dt>
            <dd className="mt-0.5 break-words text-sm font-semibold">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ContactLink({ href, children }: { href: string | null; children: ReactNode }): React.JSX.Element {
  return href ? <a href={href} className="text-app-accent underline-offset-2 hover:underline">{children}</a> : <>{children}</>;
}

function CallbackPanel({ lead, currentUserId, organizationTimezone, callbacks, canManage, handedAway, onReload }: { lead: Lead; currentUserId: string; organizationTimezone: string; callbacks: LeadCallback[]; canManage: boolean; handedAway: boolean; onReload: () => Promise<void> }): React.JSX.Element {
  const [scheduledAt, setScheduledAt] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const isHolder = lead.currentHolderId === currentUserId;
  const closed = isClosedLeadStatus(lead.status);
  const hasOpenCallback = callbacks.some((callback) => callback.status === 'pending');
  // Whoever works the lead books its callbacks: its holder, or its owner while
  // nobody else holds it. The agent who handed it over no longer does.
  const canSchedule = (isHolder || (lead.ownerId === currentUserId && !handedAway)) && !closed && !hasOpenCallback;
  const run = async (action: () => Promise<unknown>, onDone?: () => void) => {
    try {
      await action();
      setError('');
      onDone?.();
      await onReload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Callback action failed.');
    }
  };
  return (
    <Card id={LEAD_ANCHORS.callbacks}>
      <h2 className="font-display text-lg font-bold">Callbacks</h2>
      {error && <p className="mt-2 text-xs text-app-danger">{error}</p>}
      {canSchedule && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-app-muted">Book a time to call {lead.contactName} back. You get a reminder an hour before and 15 minutes before.</p>
          <input type="datetime-local" aria-label="Callback date and time" min={organizationNowLocal(organizationTimezone)} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm" />
          <p className="text-xs text-app-muted">Times are in {organizationTimezone}.</p>
          <input aria-label="Callback reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="What to talk about (optional)" className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm" />
          <Button disabled={!scheduledAt} onClick={() => void run(() => createCallback({ leadId: lead.id, scheduledAt: organizationLocalToIso(scheduledAt, organizationTimezone), reason: reason.trim() || undefined }), () => { setScheduledAt(''); setReason(''); })}>Book callback</Button>
        </div>
      )}
      {isHolder && closed && callbacks.length === 0 && <p className="mt-3 text-xs text-app-muted">This lead is closed, so no callback can be booked.</p>}
      {sortCallbacks(callbacks).map((callback) => (
        <div key={callback.id} className="mt-4 border-t border-app-border pt-3 text-sm">
          <p className="font-semibold">{formatCallbackDate(callback.scheduledAt, callback.organizationTimezone)} · {callbackStatusLabel(callback.status)}</p>
          <p className="mt-1 text-xs text-app-muted">{callback.ownerId === currentUserId ? 'Yours' : `With ${callback.ownerName ?? 'someone else'}`}{callback.reason ? ` · ${callback.reason}` : ''}{callback.outcome ? ` · Outcome: ${sentenceLabel(callback.outcome)}` : ''}</p>
          {/* Its owner works it; a Supervisor / Team Lead / Sales Head whose reach
              includes it can move or close it when the owner is away. */}
          {callback.status === 'pending' && !handedAway && (callback.ownerId === currentUserId || canManage) && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-app-muted">{callback.ownerId === currentUserId ? 'After the call, record how it went:' : `Handle it for ${callback.ownerName ?? 'its owner'} — record how it went, move it or cancel it:`}</p>
              <div className="flex flex-wrap gap-2">
                <Button kind="secondary" onClick={() => void run(() => callbackOutcome(callback.id, 'completed', 'connected'))}>We spoke</Button>
                <Button kind="secondary" onClick={() => void run(() => callbackOutcome(callback.id, 'not_reachable', 'not_reachable'))}>Couldn’t reach them</Button>
                <Button kind="secondary" onClick={() => void run(() => updateCallback(callback.id, { scheduledAt: anHourLater(callback.scheduledAt) }))}>Move 1 hour later</Button>
                <Button kind="danger" onClick={() => void run(() => callbackOutcome(callback.id, 'cancelled'))}>Cancel it</Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

function ConvertToDealModal({ lead, onClose, onCreated }: { lead: Lead; onClose: () => void; onCreated: (dealId: string) => void }): React.JSX.Element {
  const [title, setTitle] = useState(lead.companyName ? `${lead.companyName} — ${lead.contactName}` : lead.contactName);
  const [service, setService] = useState(lead.requirement ?? '');
  const [scope, setScope] = useState('');
  const [expectedCloseAt, setExpectedCloseAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const deal = await createDeal({
        originatingLeadId: lead.id,
        title: title.trim(),
        ...(service.trim() ? { serviceRequested: service.trim() } : {}),
        ...(scope.trim() ? { scopeSummary: scope.trim() } : {}),
        ...(expectedCloseAt ? { expectedCloseAt: new Date(expectedCloseAt).toISOString() } : {}),
        ...(lead.contactId ? { contactId: lead.contactId } : {}),
      });
      onCreated(deal.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the deal.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Qualify into a deal">
      <div className="w-full max-w-lg rounded-xl bg-app-background p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">Qualify into a deal</h2>
          <button type="button" onClick={onClose} className="text-sm text-app-muted hover:text-app-foreground">Close</button>
        </div>
        <p className="mt-2 text-sm text-app-muted">The lead becomes a deal you own. Next you build the proposal, get it approved if needed, and collect the advance.</p>
        {error && <p className="mt-3 rounded-lg bg-[#d86b6b]/10 p-2 text-sm text-app-danger">{error}</p>}
        <div className="mt-4 grid gap-4">
          <Field label="Deal title" value={title} onChange={setTitle} required />
          <Field label="What they are buying" value={service} onChange={setService} />
          <label className="text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Scope summary (optional)</span>
            <textarea value={scope} onChange={(event) => setScope(event.target.value)} className="min-h-[80px] w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm" />
          </label>
          <label className="text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Expected to close by (optional)</span>
            <input type="date" value={expectedCloseAt} onChange={(event) => setExpectedCloseAt(event.target.value)} className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm" />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <Button kind="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !title.trim()} onClick={() => void submit()}>{busy ? 'Creating…' : 'Create deal'}</Button>
        </div>
      </div>
    </div>
  );
}

const LOSS_REASONS: ReadonlyArray<{ value: string; label: string }> = ['not_interested', 'no_budget', 'competitor', 'timing', 'unqualified', 'duplicate', 'other'].map((value) => ({ value, label: lossReasonLabel(value) }));

function HandoverPanel({ lead, currentUserId, organizationTimezone, handovers, targets, onReload }: { lead: Lead; currentUserId: string; organizationTimezone: string; handovers: Handover[]; targets: HandoverTarget[]; onReload: () => Promise<void> }): React.JSX.Element {
  const active = handovers.find((handover) => handover.status === 'pending' || (handover.status === 'accepted' && handover.disposition === null));
  const [targetId, setTargetId] = useState('');
  const [reason, setReason] = useState('');
  const [lossReason, setLossReason] = useState('other');
  const [callbackAt, setCallbackAt] = useState('');
  const [error, setError] = useState('');
  const isTerminal = lead.status === 'converted' || lead.status === 'closed_lost';
  const ownerCanOffer = lead.currentHolderId === currentUserId && !active && !isTerminal;
  const receiver = active?.toUserId === currentUserId;
  const receivers = targets.filter((target) => target.id !== lead.currentHolderId);
  const anyoneAvailable = receivers.some((target) => target.selectable);
  const canQueue = Boolean(lead.salesTeamId);
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setError('');
      await onReload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Handover action failed.');
    }
  };
  return (
    <Card id={LEAD_ANCHORS.handover}>
      <h2 className="font-display text-lg font-bold">Hand over a live call</h2>
      {error && <p className="mt-3 text-xs text-app-danger">{error}</p>}
      {active ? (
        <div className="mt-3 space-y-3 text-sm">
          <p className="font-semibold">{active.status === 'pending' ? `Offered to ${active.toUserName ?? 'the team queue'}, waiting for them to accept` : `${active.toUserName ?? 'A colleague'} took the call`}</p>
          {receiver && active.status === 'pending' && (
            <div className="flex gap-2">
              <Button onClick={() => void run(() => acceptHandover(active.id))}>Accept the call</Button>
              <Button kind="secondary" onClick={() => void run(() => declineHandover(active.id, reason.trim() || 'Unable to take this call'))}>Decline</Button>
            </div>
          )}
          {receiver && active.status === 'accepted' && (
            <div className="space-y-3">
              <p className="text-xs text-app-muted">How did the call go?</p>
              <Button className="w-full" onClick={() => void run(() => recordHandoverDisposition(active.id, 'accepted'))}>They want to go ahead</Button>
              <div className="space-y-2 rounded-lg border border-app-border p-3">
                <p className="text-xs font-semibold">They want a call back</p>
                <input type="datetime-local" aria-label="Callback date and time" min={organizationNowLocal(organizationTimezone)} value={callbackAt} onChange={(event) => setCallbackAt(event.target.value)} className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm" />
                <p className="text-xs text-app-muted">Times are in {organizationTimezone}.</p>
                <Button kind="secondary" disabled={!callbackAt} onClick={() => void run(() => recordHandoverDisposition(active.id, 'callback', reason.trim() || undefined, organizationLocalToIso(callbackAt, organizationTimezone)))}>Book the callback</Button>
              </div>
              <div className="space-y-2 rounded-lg border border-app-border p-3">
                <p className="text-xs font-semibold">Not interested (closes the lead as lost)</p>
                <select aria-label="Why they are not interested" value={lossReason} onChange={(event) => setLossReason(event.target.value)} className="w-full rounded-lg border border-app-border bg-app-background px-2 py-2 text-sm">
                  {LOSS_REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <Button kind="danger" onClick={() => void run(() => recordHandoverDisposition(active.id, 'rejected', reason.trim() || undefined, undefined, lossReason))}>Close as lost</Button>
              </div>
            </div>
          )}
        </div>
      ) : ownerCanOffer ? (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-app-muted">On a call that needs someone senior? Offer it to a supervisor or team lead who is punched in. They have 5 minutes to accept.</p>
          <select aria-label="Who should take the call" value={targetId} onChange={(event) => setTargetId(event.target.value)} className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm">
            <option value="">Choose who takes the call</option>
            {receivers.map((target) => <option key={target.id} value={target.id} disabled={!target.selectable}>{target.fullName} · {target.positionCode.replaceAll('-', ' ')} · {sentenceLabel(target.availability)}</option>)}
          </select>
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why (optional)" className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm" />
          <div className="flex flex-wrap gap-2">
            <Button disabled={!targetId} onClick={() => void run(() => createHandover({ leadId: lead.id, toUserId: targetId, reason: reason.trim() || undefined }))}>Offer the call</Button>
            {canQueue && <Button kind="secondary" disabled={anyoneAvailable} onClick={() => void run(() => createHandover({ leadId: lead.id, handoverMode: 'team_queue', reason: reason.trim() || undefined }))}>Queue for the sales team</Button>}
          </div>
          {canQueue && anyoneAvailable && <p className="text-xs text-app-muted">Someone is free, so pick them above. The team queue is for when nobody is.</p>}
          {!anyoneAvailable && !canQueue && <p className="text-xs text-app-muted">Nobody is free to take the call right now, and this lead has no sales team to queue it for.</p>}
        </div>
      ) : null}
      {handovers.length > 0 && (
        <div className="mt-4 border-t border-app-border pt-3">
          <p className="text-xs font-bold uppercase tracking-wide text-app-muted">Earlier handovers</p>
          {handovers.slice(0, 5).map((handover) => <p key={handover.id} className="mt-2 text-xs text-app-muted">{sentenceLabel(handover.status)} · {handover.fromUserName ?? 'Unknown'} → {handover.toUserName ?? 'team queue'}{handover.disposition ? ` · ${sentenceLabel(handover.disposition)}` : ''}</p>)}
        </div>
      )}
    </Card>
  );
}
