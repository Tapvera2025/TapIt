import { CalendarPicker } from '../../../ui/CalendarPicker.js';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Card, Field, Icon, Page, WorkspacePageContainer } from '../../../ui/index.js';
import { acceptHandover, callbackOutcome, createCallback, createHandover, declineHandover, getCallbacks, getHandoverTargets, getHandovers, getLead, recordHandoverDisposition, updateCallback, updateLeadStatus, type Handover, type HandoverTarget, type Lead, type LeadCallback } from './api.js';
import { anHourLater, callbackStatusLabel, formatCallbackDate, organizationLocalToIso, organizationNowLocal, sentenceLabel, sortCallbacks } from './callback-ui.js';
import { ReassignModal } from './ReassignModal.js';
import { LeadStatusPanel } from './LeadStatusPanel.js';
import { isClosedLeadStatus, isHandedOverAway, isLeadReadyForDeal, leadStatusLabel, lossReasonLabel } from './lead-status.js';
import { convertedDealId, leadActivityLabel } from './lead-activity.js';
import { createDeal } from '../deals/api.js';
import { getCalls, type CallListItem } from '../calls/api.js';
import { directionLabel, formatCallTime, OUTCOME_LABELS, PROVIDER_NAMES } from '../calls/calls-format.js';
import { isStillStalled, LEAD_ANCHORS, leadGuidance, leadSteps } from '../guide/lead-guidance.js';
import { cannotOpen, mailHref, telHref, type GuideCommand } from '../guide/guidance.js';
import { SalesCoach, focusGuideTarget, useSalesGuide } from '../guide/SalesGuide.js';
import { IdentityApiError } from '../../../identity/api/authApi.js';
import { subscribeRealtimeEvent } from '../../live/realtimeClient.js';
import { ErrorToast } from '../../../ui/ErrorToast.js';

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

type LeadDetailTab = 'qualification' | 'calls' | 'callbacks' | 'activity';

export function LeadDetailsPage({ id, currentUserId, organizationTimezone, canReassign = false, canTransferSourcingCredit = false, canCreateDeal = false, canEditLead = false, canViewCalls = false, canManageCallbacks = false, initialFocus, onBack, onNavigate }: { id: string; currentUserId: string; organizationTimezone: string; canReassign?: boolean; canTransferSourcingCredit?: boolean; canCreateDeal?: boolean; canEditLead?: boolean; canViewCalls?: boolean; canManageCallbacks?: boolean; initialFocus?: 'handover' | 'status' | undefined; onBack: () => void; onNavigate?: (path: string) => void }): React.JSX.Element {
  const [activeSection, setActiveSection] = useState<LeadDetailTab>('qualification');
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
    setActiveSection('qualification');
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
  const matchingLeadLoaded = lead?.id === id;
  useEffect(() => {
    if (initialFocus && matchingLeadLoaded) focusGuideTarget(LEAD_ANCHORS[initialFocus]);
  }, [id, initialFocus, matchingLeadLoaded]);
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
  const canConvert = canCreateDeal && isHolder && isLeadReadyForDeal(lead.status);
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

  function handleGuideFocus(target: string): void {
    if (target === LEAD_ANCHORS.callbacks) {
      setActiveSection('callbacks');
      window.setTimeout(() => focusGuideTarget(target), 0);
      return;
    }
    focusGuideTarget(target);
  }

  const activityEntries = [...lead.activities].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const callEntries = [...calls].sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime());
  const pendingCallback = sortCallbacks(callbacks).find((callback) => callback.status === 'pending');
  const nextCallback = callbacks.filter((callback) => callback.status === 'pending').sort((left, right) => new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime())[0];
  const holderLabel = lead.currentHolderId === currentUserId ? 'You' : lead.currentHolderName;
  const ownerLabel = lead.ownerId === currentUserId ? 'You' : lead.ownerName;
  const showHandover = handovers.length > 0 || (!closed && isHolder);
  const showCallbacks = callbacks.length > 0 || ((isHolder || (lead.ownerId === currentUserId && !handedAway)) && !closed);
  const tabs: Array<{ id: LeadDetailTab; label: string; count?: number }> = [
    { id: 'qualification', label: 'Touchpoints & Qualification', count: leadSteps(lead).length },
    { id: 'calls', label: 'Call History', ...(canViewCalls ? { count: calls.length } : {}) },
    { id: 'callbacks', label: 'Callbacks', count: callbacks.length },
    { id: 'activity', label: 'Activity Log', count: lead.activities.length },
  ];

  const phoneLink = telHref(lead.phone);
  const stalled = !closed && isStillStalled(lead);
  return (
    <WorkspacePageContainer>
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <button type="button" onClick={onBack} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-app-muted transition hover:text-app-foreground sm:text-base">
            <Icon name="chevron-left" className="size-5" />
            Back to Lead Management
          </button>
          <span className="shrink-0 text-sm text-app-muted sm:text-base">Record #{lead.leadNumber}</span>
        </div>

        <Card className="sales-record-card p-5 sm:p-7 lg:p-9">
          <div className="mb-5 inline-flex max-w-full items-center gap-2 rounded-xl bg-app-accent/10 px-3.5 py-2.5 text-sm font-semibold text-app-accent sm:px-4 sm:text-base">
            <Icon name="sparkles" className="size-5 shrink-0" />
            <span>{closed ? 'Closed pipeline record' : 'Active pipeline record'} · Current stage: {leadStatusLabel(lead.status)}</span>
          </div>

          <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="font-display text-3xl font-bold tracking-tight text-app-foreground sm:text-4xl">
                  Lead #{lead.leadNumber} <em className="font-semibold text-app-foreground/80">“{lead.contactName}”</em>
                </h1>
                <span className="rounded-xl bg-app-accent/10 px-3.5 py-2 text-sm font-bold text-app-accent">{leadStatusLabel(lead.status)}</span>
              </div>
              {lead.companyName && <p className="mt-2 text-sm text-app-muted sm:text-base">{lead.companyName}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className="text-sm text-app-muted sm:text-base">Sales Owner</span>
                {canReassign && !closed ? (
                  <Button kind="secondary" onClick={() => setReassignOpen(true)}>{lead.ownerName ?? 'Assign an owner'} <Icon name="chevron-down" className="ml-2 inline size-4" /></Button>
                ) : <span className="rounded-xl border border-app-border px-4 py-2 text-sm font-semibold text-app-foreground">{lead.ownerName ?? (lead.bidState === 'pool_open' ? 'Bid Pool' : 'Unassigned')}</span>}
                {canConvert && <Button onClick={() => setConvertOpen(true)}>Qualify into a deal</Button>}
                {dealId && onNavigate && <Button kind="secondary" onClick={() => onNavigate(`/company/sales/deals/${dealId}`)}>Open the deal</Button>}
              </div>
            </div>
            {guideMode === 'closed' && <p className="max-w-md rounded-xl bg-app-background px-4 py-3 text-sm text-app-muted"><span className="font-semibold text-app-foreground">Next step:</span> {guidance.title}</p>}
          </div>

          <div className="mt-6 border-t border-app-border pt-5 sm:mt-7 sm:pt-6">
            <dl className="grid gap-x-7 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              <LeadFact icon="clipboard" label="Lead ID" value={`#${lead.leadNumber}`} />
              <LeadFact icon="inbox" label="Source" value={lead.sourceName} />
              <LeadFact icon="calendar" label="Created Date" value={formatLeadDate(lead.createdAt, organizationTimezone)} />
              <LeadFact icon="clock" label="Next Callback" value={nextCallback ? formatCallbackDate(nextCallback.scheduledAt, organizationTimezone) : 'No callback scheduled'} />
              <LeadFact icon="pin" label="Territory" value={lead.territoryName ?? 'Not assigned'} accent={Boolean(lead.territoryName)} />
              <LeadFact icon="users" label="Working it now" value={holderLabel ?? ownerLabel ?? 'Unassigned'} />
            </dl>
          </div>
        </Card>

        <SalesCoach guidance={guidance} onCommand={handleCommand} onNavigate={navigate} onFocus={handleGuideFocus} />
        {reassignOpen && <ReassignModal lead={lead} canTransferSourcingCredit={canTransferSourcingCredit} onClose={() => setReassignOpen(false)} onReassigned={(updated) => { setLead(updated); void reload(); }} />}
        {convertOpen && <ConvertToDealModal lead={lead} onClose={() => setConvertOpen(false)} onCreated={(newDealId) => { setConvertOpen(false); if (onNavigate) onNavigate(`/company/sales/deals/${newDealId}`); }} />}

        <div className="overflow-x-auto border-b border-app-border">
          <div className="flex min-w-max items-center gap-3 sm:gap-6" role="tablist" aria-label="Lead record sections">
            {tabs.map((tab) => {
              const selected = activeSection === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`lead-panel-${tab.id}`}
                  onClick={() => setActiveSection(tab.id)}
                  className={`inline-flex min-h-12 items-center gap-2 border-b-2 px-1 text-sm font-semibold transition sm:text-base ${selected ? 'border-app-accent text-app-accent' : 'border-transparent text-app-muted hover:text-app-foreground'}`}
                >
                  {tab.label}
                  {tab.count !== undefined && <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${selected ? 'bg-app-accent text-white' : 'bg-app-background text-app-muted'}`}>{tab.count}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {activeSection === 'qualification' && (
          <div id="lead-panel-qualification" role="tabpanel" className="space-y-5">
            <LeadProgressTable lead={lead} />
            <Card className="sales-record-card">
              <h2 className="font-display text-lg font-bold">Lead details</h2>
              <div className="mt-4 grid gap-x-8 gap-y-4 lg:grid-cols-2">
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
                ]} />
                <DetailGroup title="Ownership" items={[
                  { label: 'Sales owner', value: ownerLabel ?? (lead.bidState === 'pool_open' ? 'Nobody yet (in the Bid Pool)' : 'Nobody yet') },
                  { label: 'Working it now', value: holderLabel },
                  { label: 'Sales team', value: lead.salesTeamName },
                  { label: 'Territory', value: lead.territoryName },
                ]} />
                <DetailGroup title="Additional context" items={[
                  { label: 'Lost because', value: lead.lossReason ? `${lossReasonLabel(lead.lossReason)}${lead.lostAt ? ` · ${new Date(lead.lostAt).toLocaleDateString()}` : ''}` : null },
                  { label: 'Stalled', value: isStillStalled(lead) ? (lead.stalledReason === 'missed_callback' ? 'A callback was missed' : 'No activity for a while') : null },
                  { label: 'Earlier lead', value: lead.previousLeadId && onNavigate ? <button type="button" className="font-semibold text-app-accent underline" onClick={() => onNavigate(`/company/sales/leads/${lead.previousLeadId}`)}>Open the earlier lead</button> : null },
                ]} />
              </div>
            </Card>

          </div>
        )}

        {activeSection === 'calls' && (
          <div id="lead-panel-calls" role="tabpanel" aria-label="Call history">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold">Recorded Calls for {lead.contactName}</h2>
                <p className="mt-1 text-sm text-app-muted">Synced calls associated with this lead’s phone number.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {phoneLink && !closed && !handedAway && <a className="sales-record-call" href={phoneLink}><Icon name="phone" className="size-4" /> Call lead</a>}
                {canViewCalls && onNavigate && <Button kind="secondary" onClick={() => onNavigate('/company/sales/calls/log')}>Open call log</Button>}
              </div>
            </div>
            {callsError && <div className="mt-4"><ErrorToast message={callsError} /></div>}
            {!canViewCalls ? <p className="mt-5 rounded-xl bg-app-background p-4 text-sm text-app-muted">Call history is not available to your role.</p> : callsLoading ? <p className="mt-5 text-sm text-app-muted">Checking synced calls for this phone number…</p> : callEntries.length === 0 ? <p className="mt-5 rounded-xl bg-app-background p-4 text-sm text-app-muted">No synced calls were found for this lead.</p> : (
              <ol className="mt-5 divide-y divide-app-border">
                {callEntries.map((call) => (
                  <li key={call.id} className="flex flex-wrap items-start justify-between gap-3 py-4 first:pt-0 last:pb-0">
                    <div>
                      <p className="font-semibold">{directionLabel(call.direction)} call · {OUTCOME_LABELS[call.outcome]}</p>
                      <p className="mt-1 text-sm text-app-muted">{PROVIDER_NAMES[call.provider]} · {formatCallTime(call.startedAt, organizationTimezone)} · {call.employeeName ?? call.agentName ?? 'Unmatched caller'}</p>
                      {call.disposition && <p className="mt-1 text-sm text-app-muted">Disposition: {call.disposition}</p>}
                      {(call.outcome === 'missed' || call.outcome === 'voicemail' || call.outcome === 'abandoned') && !pendingCallback && isHolder && !closed && <button type="button" className="mt-2 text-sm font-semibold text-app-accent underline" onClick={() => { setActiveSection('callbacks'); window.setTimeout(() => focusGuideTarget(LEAD_ANCHORS.callbacks), 0); }}>Book a callback</button>}
                    </div>
                    <span className="rounded-full bg-app-background px-3 py-1 text-xs font-semibold text-app-muted">{call.durationSeconds > 0 ? `${Math.floor(call.durationSeconds / 60)}m ${call.durationSeconds % 60}s` : 'No duration'}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          </div>
        )}

        {activeSection === 'callbacks' && (
          <div id="lead-panel-callbacks" role="tabpanel">
            {showCallbacks ? <CallbackPanel lead={lead} currentUserId={currentUserId} organizationTimezone={organizationTimezone} callbacks={callbacks} canManage={canManageCallbacks && !handedAway} handedAway={handedAway} onReload={reload} /> : <Card><h2 className="font-display text-lg font-bold">Callbacks</h2><p className="mt-2 text-sm text-app-muted">No callback history is available for this lead.</p></Card>}
          </div>
        )}

        {activeSection === 'activity' && (
          <div id="lead-panel-activity" role="tabpanel" aria-label="Activity log">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold">Audit &amp; Activity Timeline</h2>
                <p className="mt-1 text-sm text-app-muted">Changes and touchpoints recorded on this lead, newest first.</p>
              </div>
              {dealId && onNavigate && <Button kind="secondary" onClick={() => onNavigate(`/company/sales/deals/${dealId}`)}>Open the deal</Button>}
            </div>
            {activityEntries.length > 0 ? (
              <ol className="mt-5 divide-y divide-app-border">
                {activityEntries.map((activity) => (
                  <li key={activity.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold">{leadActivityLabel(activity)}</p>
                      <time dateTime={activity.createdAt} className="text-sm text-app-muted">{formatLeadDate(activity.createdAt, organizationTimezone)}</time>
                    </div>
                    {convertedDealId(activity) && onNavigate && <button type="button" className="mt-1 text-sm font-semibold text-app-accent underline" onClick={() => onNavigate(`/company/sales/deals/${convertedDealId(activity)}`)}>Open deal</button>}
                  </li>
                ))}
              </ol>
            ) : <p className="mt-5 rounded-xl bg-app-background p-4 text-sm text-app-muted">Nothing has been recorded on this lead yet.</p>}
          </Card>
          </div>
        )}
        <Card className="sales-record-card">
          <h2 className="font-display text-lg font-bold">Lead Actions</h2>
          <div className="mt-3 divide-y divide-app-border">
            {phoneLink && !closed && !handedAway && <a className="sales-record-action" href={phoneLink}><Icon name="phone" className="size-5" /> Call lead now</a>}
            {showCallbacks && <button type="button" className="sales-record-action" onClick={() => handleGuideFocus(LEAD_ANCHORS.callbacks)}><Icon name="calendar-plus" className="size-5" /> {pendingCallback || closed ? 'View callbacks' : 'Schedule callback'}</button>}
            {showHandover && <button type="button" className="sales-record-action" onClick={() => handleGuideFocus(LEAD_ANCHORS.handover)}><Icon name="arrow-left-right" className="size-5" /> {isHolder && !closed ? 'Transfer handover' : 'View handovers'}</button>}
            <button type="button" className="sales-record-action" onClick={() => handleGuideFocus(LEAD_ANCHORS.status)}><Icon name="refresh" className="size-5" /> {canEditThisLead && !closed ? 'Update lead status' : 'View lead status'}</button>
          </div>
        </Card>

        {stalled && (
          <aside className="sales-record-alert">
            <h2 className="font-display font-bold">Follow-up attention required</h2>
            <p className="mt-1 text-sm">{lead.stalledReason === 'missed_callback' ? 'A scheduled callback was missed.' : 'This lead was flagged after a period without activity.'}</p>
          </aside>
        )}

            <div className="grid items-start gap-5 lg:grid-cols-2">
              <div id={LEAD_ANCHORS.status} className="rounded-2xl"><LeadStatusPanel lead={lead} canEdit={canEditThisLead} lockedNote={handedAway ? `${lead.currentHolderName ?? 'A colleague'} took this lead from you in a handover and works it now. You can see it, but you can’t change its status until a manager gives it back to you.` : undefined} onChanged={reload} /></div>
              {showHandover && <HandoverPanel lead={lead} currentUserId={currentUserId} organizationTimezone={organizationTimezone} handovers={handovers} targets={targets} onReload={reload} />}
            </div>

        {lead.intakeNotes && (
          <Card className="sales-record-card">
            <h2 className="font-display text-lg font-bold">Intake Notes</h2>
            <p className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-app-surface-raised p-4 text-sm">{lead.intakeNotes}</p>
          </Card>
        )}
      </div>
    </WorkspacePageContainer>
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

function LeadFact({ icon, label, value, accent = false }: { icon: string; label: string; value: string; accent?: boolean }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <Icon name={icon} className="mt-0.5 size-5 shrink-0 text-app-muted" />
      <div className="min-w-0">
        <dt className="text-sm text-app-muted">{label}</dt>
        <dd className={`mt-0.5 break-words text-sm font-semibold sm:text-base ${accent ? 'text-app-accent' : 'text-app-foreground'}`}>{value}</dd>
      </div>
    </div>
  );
}

function LeadProgressTable({ lead }: { lead: Lead }): React.JSX.Element {
  const steps = leadSteps(lead);
  const completed = steps.filter((step) => step.state === 'done').length;
  return (
    <Card className="sales-record-milestones overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-6">
        <h2 className="font-display text-lg font-bold">Touchpoints &amp; Qualification</h2>
        <span className="text-sm text-app-muted">{completed} of {steps.length} milestones complete</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] border-t border-app-border text-left">
          <thead className="bg-app-background text-xs font-bold uppercase tracking-wide text-app-muted">
            <tr>
              <th scope="col" className="px-4 py-3 sm:px-6">Checkpoint</th>
              <th scope="col" className="px-4 py-3 sm:px-6">Milestone</th>
              <th scope="col" className="px-4 py-3 sm:px-6">Stage status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border">
            {steps.map((step, index) => {
              const stateLabel = step.state === 'done' ? 'Complete' : step.state === 'current' ? 'In progress' : step.state === 'lost' ? 'Closed as lost' : step.state === 'skipped' ? 'Not reached' : 'Upcoming';
              const stateClass = step.state === 'done'
                ? 'bg-app-success/10 text-app-success'
                : step.state === 'current'
                  ? 'bg-app-accent/10 text-app-accent'
                  : step.state === 'lost'
                    ? 'bg-app-danger/10 text-app-danger'
                    : 'bg-app-background text-app-muted';
              return (
                <tr key={step.key}>
                  <td className="px-4 py-3 font-mono text-sm text-app-muted sm:px-6">{index + 1}</td>
                  <th scope="row" className="px-4 py-3 text-sm font-semibold text-app-foreground sm:px-6">{step.label}</th>
                  <td className="px-4 py-3 sm:px-6">
                    <span className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold ${stateClass}`}>
                      <Icon name={step.state === 'done' ? 'check' : 'clock'} className="size-4" />
                      {stateLabel}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function formatLeadDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  }).format(new Date(value));
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
      {error && <ErrorToast message={error} />}
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
        {error && <ErrorToast message={error} />}
        <div className="mt-4 grid gap-4">
          <Field label="Deal title" value={title} onChange={setTitle} required />
          <Field label="What they are buying" value={service} onChange={setService} />
          <label className="text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Scope summary (optional)</span>
            <textarea value={scope} onChange={(event) => setScope(event.target.value)} className="min-h-[80px] w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm" />
          </label>
          <label className="text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Expected to close by (optional)</span>
            <CalendarPicker type="date" value={expectedCloseAt} onChange={(event) => setExpectedCloseAt(event.target.value)} className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm" />
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
      {error && <ErrorToast message={error} />}
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
