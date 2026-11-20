import { useEffect, useState } from 'react';
import { Button, Card, Field, Icon, Page, SegmentedTabs, type SegmentedTabItem } from '../../../ui/index.js';
import { acceptHandover, addHandoverAnnotation, declineHandover, getAllHandovers, getLead, recordHandoverDisposition, type Handover, type Lead } from '../leads/api.js';
import { leadSteps } from '../guide/lead-guidance.js';
import { ErrorToast } from '../../../ui/ErrorToast.js';

type HandoverView = 'all' | 'incoming' | 'mine';

export function HandoverPage({ view, currentUserId, onNavigate }: { view: HandoverView; currentUserId: string; onNavigate: (path: string) => void }): React.JSX.Element {
  const [items, setItems] = useState<Handover[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = async (): Promise<void> => {
    try {
      const rows = await getAllHandovers();
      setItems(rows);
      setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id ?? '');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load handovers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, [view, currentUserId]);

  const incoming = items.filter((row) => row.status === 'pending' && (row.toUserId === currentUserId || (row.handoverMode === 'team_queue' && row.toUserId === null)));
  const mine = items.filter((row) => row.fromUserId === currentUserId || row.toUserId === currentUserId);
  const visible = view === 'incoming' ? incoming : view === 'mine' ? mine : items;
  const selected = visible.find((row) => row.id === selectedId) ?? visible[0] ?? null;
  const counts: Record<HandoverView, number> = { all: items.length, incoming: incoming.length, mine: mine.length };
  const tabs: SegmentedTabItem[] = [
    { id: 'all', label: `All (${counts.all})` },
    { id: 'incoming', label: `Incoming Offers (${counts.incoming})` },
    { id: 'mine', label: `My Handovers (${counts.mine})` },
  ];

  const changeView = (next: string): void => {
    const routes: Record<HandoverView, string> = {
      all: '/company/sales/handovers',
      incoming: '/company/sales/handovers/incoming',
      mine: '/company/sales/handovers/mine',
    };
    if (next in routes) onNavigate(routes[next as HandoverView]);
  };

  return (
    <Page
      eyebrow="Sales"
      title="Handovers"
      description="Authorize SDR-to-AE lead qualifications and ownership transfers."
      action={<SegmentedTabs items={tabs} value={view} onChange={changeView} ariaLabel="Handover views" />}
    >
      {error && <ErrorToast message={error} />}

      <section aria-label="Handover requests" className="space-y-3">
        {loading && items.length === 0 ? (
          <Card><p className="text-sm text-app-muted">Loading handovers…</p></Card>
        ) : visible.length === 0 ? (
          <Card className="py-10 text-center">
            <h2 className="font-display text-lg font-bold">No handovers in this view</h2>
            <p className="mt-1 text-sm text-app-muted">Incoming offers and transfers you are part of will appear here.</p>
          </Card>
        ) : visible.map((row) => (
          <HandoverSummary
            key={row.id}
            handover={row}
            selected={selected?.id === row.id}
            onSelect={() => setSelectedId(row.id)}
          />
        ))}
      </section>

      {selected && (
        <HandoverDetail
          key={selected.id}
          handover={selected}
          currentUserId={currentUserId}
          onUpdated={reload}
          onNavigate={onNavigate}
        />
      )}
    </Page>
  );
}

function HandoverSummary({ handover, selected, onSelect }: { handover: Handover; selected: boolean; onSelect: () => void }): React.JSX.Element {
  const title = handover.leadContactName || 'Lead handover';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="sales-handover-summary"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`font-mono text-xs font-bold uppercase tracking-[0.1em] ${selected ? 'text-app-accent' : 'text-app-muted'}`}>
            {handover.leadNumber ? `Lead #${handover.leadNumber}` : 'Lead handover'}
          </p>
          <h2 className="mt-2 break-words font-display text-xl font-bold tracking-tight text-app-foreground sm:text-2xl">
            {title}
          </h2>
          <p className="mt-1 text-sm text-app-muted">
            {handover.fromUserName ?? 'Original owner'} <span aria-hidden="true">→</span> {handover.toUserName ?? (handover.handoverMode === 'team_queue' ? 'Team queue' : 'Unassigned')}
          </p>
        </div>
        <StatusPill handover={handover} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-3 text-sm">
        <span className="font-semibold text-app-foreground">{handover.reason || (handover.handoverMode === 'team_queue' ? 'Shared team offer' : 'Ownership transfer')}</span>
        <time className="text-app-muted" dateTime={handover.offeredAt}>{formatDate(handover.offeredAt)}</time>
      </div>
    </button>
  );
}

function HandoverDetail({ handover, currentUserId, onUpdated, onNavigate }: { handover: Handover; currentUserId: string; onUpdated: () => Promise<void>; onNavigate: (path: string) => void }): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [annotation, setAnnotation] = useState('');
  const [error, setError] = useState('');
  const [lead, setLead] = useState<Lead | null>(null);
  const [leadLoading, setLeadLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLeadLoading(true);
    void getLead(handover.leadId).then((data) => {
      if (active) setLead(data);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Unable to load the lead record.');
    }).finally(() => {
      if (active) setLeadLoading(false);
    });
    return () => { active = false; };
  }, [handover.leadId]);

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await action();
      setError('');
      setReason('');
      setAnnotation('');
      await onUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Handover action failed.');
    } finally {
      setBusy(false);
    }
  };

  const receiver = handover.toUserId === currentUserId;
  const canClaim = handover.handoverMode === 'team_queue' && handover.toUserId === null;
  const canAccept = handover.status === 'pending' && (receiver || canClaim);
  const canDecide = receiver && handover.status === 'accepted' && !handover.disposition;
  const heading = lead?.contactName ?? handover.leadContactName ?? 'Lead record';
  const companyName = lead?.companyName;

  return (
    <Card className="sales-handover-detail">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-app-border pb-5">
        <div className="min-w-0">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-app-accent">
            {handover.leadNumber ? `Lead #${handover.leadNumber}` : 'Handover'} <span aria-hidden="true">·</span> {formatDate(handover.offeredAt)}
          </p>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-app-foreground sm:text-3xl">
            {heading}{companyName ? ` (${companyName})` : ''}
          </h2>
        </div>
        <Button kind="secondary" onClick={() => onNavigate(`/company/sales/leads/${handover.leadId}`)}>Open Lead Record</Button>
      </div>

      {error && <div className="mt-4"><ErrorToast message={error} /></div>}

      <div className="mt-5 rounded-2xl border border-app-border bg-app-background p-4 text-sm leading-6 text-app-foreground sm:p-5">
        {leadLoading ? 'Loading lead context…' : lead?.intakeNotes || lead?.requirement || handover.reason || 'No qualification notes have been added to this handover yet.'}
        {lead?.intakeNotes && lead?.requirement && <p className="mt-2 border-t border-app-border pt-2 text-app-muted">Requirement: {lead.requirement}</p>}
      </div>

      <section className="mt-6" aria-labelledby="handover-context-heading">
        <h3 id="handover-context-heading" className="text-xs font-bold uppercase tracking-[0.1em] text-app-muted">Handover context</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Info label="Transfer" value={`${handover.fromUserName ?? 'Original owner'} → ${handover.toUserName ?? (handover.handoverMode === 'team_queue' ? 'Team queue' : 'Unassigned')}`} />
          <Info label="Lead stage" value={lead ? formatStage(lead.status) : leadLoading ? 'Loading…' : 'Unavailable'} />
          <Info label="Source" value={lead?.sourceName ?? '—'} />
          <Info label="Response time" value={formatSeconds(handover.timeToAcceptSeconds)} />
        </dl>
      </section>

      {lead && (
        <section className="mt-6 border-t border-app-border pt-5" aria-labelledby="handover-milestones-heading">
          <h3 id="handover-milestones-heading" className="text-xs font-bold uppercase tracking-wide text-app-muted">Lead milestones</h3>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {leadSteps(lead).map((step) => (
              <li key={step.key} className="flex items-center gap-3 text-sm font-semibold">
                <span className={`grid size-7 shrink-0 place-items-center rounded-full ${step.state === 'done' ? 'bg-app-success/15 text-app-success' : 'bg-app-surface-raised text-app-muted'}`}>
                  <Icon name={step.state === 'done' ? 'check' : 'clock'} className="size-4" />
                </span>
                <span>{step.label}</span>
                <span className="sr-only">{step.state === 'done' ? 'Complete' : 'Incomplete'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {handover.corrections.length > 0 && (
        <section className="mt-6 border-t border-app-border pt-5" aria-labelledby="handover-notes-heading">
          <h3 id="handover-notes-heading" className="text-xs font-bold uppercase tracking-[0.1em] text-app-muted">Handover notes</h3>
          <ul className="mt-3 space-y-2">
            {handover.corrections.map((item) => <li key={item.id} className="rounded-xl bg-app-background px-4 py-3 text-sm">{item.annotation}</li>)}
          </ul>
        </section>
      )}

      <div className="mt-6 grid gap-4 border-t border-app-border pt-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="max-w-xl">
          <Field label="Add handover note" value={annotation} onChange={setAnnotation} placeholder="Add qualification context or a correction…" disabled={busy} />
          <Button className="mt-2" kind="secondary" disabled={!annotation.trim() || busy} onClick={() => void run(() => addHandoverAnnotation(handover.id, annotation.trim()))}>Add note</Button>
          {receiver && handover.status === 'pending' && (
            <div className="mt-4 max-w-sm">
              <Field label="Decline reason" value={reason} onChange={setReason} placeholder="Why can’t you take this handover?" disabled={busy} />
            </div>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {canAccept && receiver && <Button kind="danger" disabled={busy || !reason.trim()} onClick={() => void run(() => declineHandover(handover.id, reason.trim()))}>Decline</Button>}
          {canAccept && <Button disabled={busy} onClick={() => void run(() => acceptHandover(handover.id))}>{busy ? 'Saving…' : 'Accept & Take Ownership'}</Button>}
          {canDecide && <>
            <Button kind="danger" disabled={busy} onClick={() => void run(() => recordHandoverDisposition(handover.id, 'rejected', 'Rejected from Handover detail', undefined, 'other'))}>Decline</Button>
            <Button kind="secondary" disabled={busy} onClick={() => void run(() => recordHandoverDisposition(handover.id, 'callback', undefined, new Date(Date.now() + 3600000).toISOString()))}>Schedule callback +1h</Button>
            <Button disabled={busy} onClick={() => void run(() => recordHandoverDisposition(handover.id, 'accepted'))}>Accept & Take Ownership</Button>
          </>}
          {!canAccept && !canDecide && <StatusPill handover={handover} />}
        </div>
      </div>
    </Card>
  );
}

function StatusPill({ handover }: { handover: Handover }): React.JSX.Element {
  const label = getStatusLabel(handover);
  const color = handover.status === 'pending' || handover.disposition === 'callback'
    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
    : handover.status === 'declined' || handover.status === 'expired' || handover.disposition === 'rejected'
      ? 'bg-app-danger/10 text-app-danger'
      : 'bg-app-accent/10 text-app-accent';
  return <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold sm:text-sm ${color}`}>{label}</span>;
}

function getStatusLabel(handover: Handover): string {
  if (handover.status === 'pending') return 'Pending Authorization';
  if (handover.status === 'declined') return 'Declined';
  if (handover.status === 'expired') return 'Expired';
  if (handover.disposition === 'accepted') return 'Accepted';
  if (handover.disposition === 'callback') return 'Callback Scheduled';
  if (handover.disposition === 'rejected') return 'Declined';
  return 'Awaiting Outcome';
}

function Info({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div className="min-w-0 rounded-xl bg-app-background px-4 py-3"><dt className="text-[11px] font-bold uppercase tracking-wide text-app-muted">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-app-foreground">{value}</dd></div>;
}

function formatDate(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (left: Date, right: Date): boolean => left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  const time = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  if (sameDay(date, today)) return `Today, ${time}`;
  if (sameDay(date, yesterday)) return `Yesterday, ${time}`;
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatSeconds(value: number | null): string {
  if (value === null) return 'Awaiting response';
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m ${value % 60}s`;
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
}

function formatStage(status: Lead['status']): string {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
