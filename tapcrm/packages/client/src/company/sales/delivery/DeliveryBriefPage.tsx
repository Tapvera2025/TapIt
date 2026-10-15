import { useEffect, useRef, useState } from 'react';
import { Button, Card, Field, Page, Select } from '../../../ui/components.js';
import { getDeal, type Deal } from '../deals/api.js';
import { listCommercials, type Commercials } from '../proposals/api.js';
import {
  getBriefForDeal,
  patchBrief,
  reviewBrief,
  startBrief,
  submitBrief,
  type DeliveryBrief,
  type DeliveryBriefContent,
  type DeliveryBriefState,
  type ReviewDecisionInput,
} from './api.js';
import { BriefSections } from './BriefSections.js';

const AUTOSAVE_DEBOUNCE_MS = 800;

const STATE_LABELS: Record<DeliveryBriefState, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  changes_requested: 'Changes requested',
  accepted: 'Accepted',
  cancelled: 'Cancelled',
};

interface DeliveryBriefPageProps {
  readonly dealId: string;
  readonly canReviewDelivery: boolean;
  readonly canApproveDeals: boolean;
  readonly onBack: () => void;
  readonly onNavigate: (path: string) => void;
}

export function DeliveryBriefPage({
  dealId,
  canReviewDelivery,
  canApproveDeals,
  onBack,
  onNavigate,
}: DeliveryBriefPageProps): React.JSX.Element {
  const [deal, setDeal] = useState<Deal | null>(null);
  const [brief, setBrief] = useState<DeliveryBrief | null>(null);
  const [versions, setVersions] = useState<readonly Commercials[]>([]);
  const [content, setContent] = useState<DeliveryBriefContent | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'stale'>('idle');
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [startChoice, setStartChoice] = useState<string>('');

  const contentRef = useRef<DeliveryBriefContent | null>(null);
  const expectedUpdatedAtRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  async function reload(): Promise<void> {
    setLoadError(null);
    try {
      const [d, b, vs] = await Promise.all([
        getDeal(dealId),
        getBriefForDeal(dealId),
        listCommercials(dealId),
      ]);
      setDeal(d);
      setBrief(b);
      setVersions(vs);
      if (b) {
        setContent(b.content);
        contentRef.current = b.content;
        expectedUpdatedAtRef.current = b.updatedAt;
      }
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Unable to load delivery brief.');
    }
  }

  useEffect(() => {
    void reload();
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  function scheduleAutosave(next: DeliveryBriefContent): void {
    if (!brief || !isEditable(brief.state)) return;
    contentRef.current = next;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setSaveStatus('saving');
    timerRef.current = window.setTimeout(() => {
      void performSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  async function performSave(): Promise<void> {
    const next = contentRef.current;
    const expected = expectedUpdatedAtRef.current;
    if (!brief || !next || !expected) return;
    try {
      const result = await patchBrief(brief.id, { expectedUpdatedAt: expected, content: next });
      if (result.stale) {
        setSaveStatus('stale');
        setActionError('Someone else edited this brief; the server copy is now shown.');
        setBrief(result.stale.serverCopy);
        setContent(result.stale.serverCopy.content);
        contentRef.current = result.stale.serverCopy.content;
        expectedUpdatedAtRef.current = result.stale.actualUpdatedAt;
        return;
      }
      if (result.brief) {
        setBrief(result.brief);
        setContent(result.brief.content);
        contentRef.current = result.brief.content;
        expectedUpdatedAtRef.current = result.brief.updatedAt;
        setSaveStatus('saved');
        setActionError(null);
      }
    } catch (cause) {
      setSaveStatus('error');
      setActionError(cause instanceof Error ? cause.message : 'Autosave failed.');
    }
  }

  async function startNewBrief(): Promise<void> {
    if (!startChoice) return;
    setActionError(null);
    try {
      const created = await startBrief(dealId, startChoice);
      setBrief(created);
      setContent(created.content);
      contentRef.current = created.content;
      expectedUpdatedAtRef.current = created.updatedAt;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not start the brief.');
    }
  }

  async function doSubmit(): Promise<void> {
    if (!brief) return;
    setActionError(null);
    try {
      const next = await submitBrief(brief.id);
      setBrief(next);
      setContent(next.content);
      contentRef.current = next.content;
      expectedUpdatedAtRef.current = next.updatedAt;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Submit failed.');
    }
  }

  async function doReview(input: ReviewDecisionInput): Promise<DeliveryBrief | null> {
    if (!brief) return null;
    setActionError(null);
    try {
      const next = await reviewBrief(brief.id, input);
      setBrief(next);
      setContent(next.content);
      contentRef.current = next.content;
      expectedUpdatedAtRef.current = next.updatedAt;
      return next;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Review failed.');
      return null;
    }
  }

  if (loadError) {
    return (
      <Page eyebrow="Sales" title="Delivery brief">
        <p className="text-app-danger">{loadError}</p>
        <Button className="mt-4" kind="secondary" onClick={onBack}>
          Back to deal
        </Button>
      </Page>
    );
  }

  if (!deal) {
    return (
      <Page eyebrow="Sales" title="Delivery brief">
        <p className="text-sm text-app-muted">Loading…</p>
      </Page>
    );
  }

  const editable = Boolean(brief && isEditable(brief.state));
  const submittable = Boolean(brief && isEditable(brief.state));
  const canReview = Boolean(brief && brief.state === 'submitted' && canReviewDelivery);
  const canCancel = Boolean(
    brief
      && !['accepted', 'cancelled'].includes(brief.state)
      && (canReviewDelivery || (deal.lifecycleStatus === 'won' && canApproveDeals)),
  );

  return (
    <Page
      eyebrow="Sales"
      title={`Delivery brief — ${deal.title}`}
      description={`Deal #${deal.dealNumber} · ${deal.contactName ?? '—'}`}
      action={
        <Button kind="secondary" onClick={onBack}>
          Back to deal
        </Button>
      }
    >
      {actionError && (
        <p className="mb-4 rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger" role="alert">
          {actionError}
        </p>
      )}

      {!brief ? (
        <StartBriefPanel
          versions={versions}
          choice={startChoice}
          onChoose={setStartChoice}
          onStart={() => void startNewBrief()}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-app-border p-4">
              <h2 className="font-display text-lg font-bold">
                {STATE_LABELS[brief.state]}
              </h2>
              <SaveIndicator status={saveStatus} />
            </div>
            {brief.state === 'changes_requested' && brief.changeNotes && (
              <div className="border-b border-app-border bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                <p className="font-semibold">Changes requested</p>
                <p className="mt-1 whitespace-pre-wrap">{brief.changeNotes}</p>
              </div>
            )}
            {brief.state === 'cancelled' && brief.cancelledReason && (
              <div className="border-b border-app-border bg-[#d86b6b]/10 p-3 text-sm text-app-danger">
                Cancelled: {brief.cancelledReason}
              </div>
            )}
            <div className="p-4">
              {content && (
                <BriefSections
                  content={content}
                  readOnly={!editable}
                  onChange={(next) => {
                    setContent(next);
                    scheduleAutosave(next);
                  }}
                />
              )}
            </div>
            {submittable && (
              <div className="flex justify-end border-t border-app-border p-4">
                <Button onClick={() => void doSubmit()}>Submit for review</Button>
              </div>
            )}
          </Card>

          <div className="space-y-4">
            <SummaryCard brief={brief} onNavigate={onNavigate} />
            {canReview && (
              <ReviewActions
                onAccept={() => setAcceptOpen(true)}
                onRequestChanges={() => setChangesOpen(true)}
                onCancel={canCancel ? () => setCancelOpen(true) : null}
              />
            )}
            {!canReview && canCancel && (
              <Card>
                <h3 className="font-display text-lg font-bold">Cancel brief</h3>
                <p className="mt-2 text-xs text-app-muted">
                  Cancelling a brief after the deal is won requires deals:approve.
                </p>
                <Button
                  kind="danger"
                  className="mt-3 w-full"
                  onClick={() => setCancelOpen(true)}
                >
                  Cancel brief
                </Button>
              </Card>
            )}
          </div>
        </div>
      )}

      {acceptOpen && brief && (
        <AcceptDialog
          onClose={() => setAcceptOpen(false)}
          onConfirm={async (projectId) => {
            const next = await doReview({ decision: 'accept', projectId });
            if (next?.state === 'accepted' && next.projectId) {
              setAcceptOpen(false);
              onNavigate(`/company/projects/${next.projectId}`);
            }
          }}
        />
      )}

      {changesOpen && brief && (
        <ChangesDialog
          onClose={() => setChangesOpen(false)}
          onConfirm={async (changeNotes) => {
            const next = await doReview({ decision: 'request_changes', changeNotes });
            if (next?.state === 'changes_requested') setChangesOpen(false);
          }}
        />
      )}

      {cancelOpen && brief && (
        <CancelDialog
          onClose={() => setCancelOpen(false)}
          onConfirm={async (reason) => {
            const next = await doReview({ decision: 'cancel', reason });
            if (next?.state === 'cancelled') setCancelOpen(false);
          }}
        />
      )}
    </Page>
  );
}

function isEditable(state: DeliveryBriefState): boolean {
  return state === 'draft' || state === 'changes_requested';
}

function SaveIndicator({
  status,
}: {
  status: 'idle' | 'saving' | 'saved' | 'error' | 'stale';
}): React.JSX.Element {
  const label =
    status === 'saving'
      ? 'Saving…'
      : status === 'saved'
        ? 'Saved'
        : status === 'error'
          ? 'Save failed'
          : status === 'stale'
            ? 'Server copy newer'
            : '';
  const tone =
    status === 'saved'
      ? 'text-emerald-600'
      : status === 'error' || status === 'stale'
        ? 'text-app-danger'
        : 'text-app-muted';
  if (!label) return <span />;
  return <span className={`text-xs font-semibold ${tone}`}>{label}</span>;
}

function StartBriefPanel({
  versions,
  choice,
  onChoose,
  onStart,
}: {
  versions: readonly Commercials[];
  choice: string;
  onChoose: (id: string) => void;
  onStart: () => void;
}): React.JSX.Element {
  const published = versions.filter((v) => v.state === 'published' || v.state === 'accepted');
  const options = published.length > 0 ? published : versions;
  return (
    <Card>
      <h2 className="font-display text-xl font-bold">Start a delivery brief</h2>
      <p className="mt-2 text-sm text-app-muted">
        A brief links the deal to delivery. Pick the commercials version it is based on — only
        published or accepted versions should normally be used.
      </p>
      <div className="mt-4 max-w-md">
        <Select
          label="Commercials version"
          value={choice}
          onChange={onChoose}
          options={[
            { value: '', label: 'Select a version' },
            ...options.map((v) => ({
              value: v.id,
              label: `v${v.version} · ${v.state}`,
            })),
          ]}
        />
      </div>
      <div className="mt-4 flex gap-2">
        <Button disabled={!choice} onClick={onStart}>
          Start brief
        </Button>
      </div>
    </Card>
  );
}

function SummaryCard({
  brief,
  onNavigate,
}: {
  brief: DeliveryBrief;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  return (
    <Card>
      <h3 className="font-display text-lg font-bold">Summary</h3>
      <dl className="mt-3 space-y-2 text-sm">
        <Row label="State" value={STATE_LABELS[brief.state]} />
        {brief.submittedAt && (
          <Row label="Submitted" value={new Date(brief.submittedAt).toLocaleString()} />
        )}
        {brief.reviewedAt && (
          <Row label="Reviewed" value={new Date(brief.reviewedAt).toLocaleString()} />
        )}
        {brief.acceptedAt && (
          <Row label="Accepted" value={new Date(brief.acceptedAt).toLocaleString()} />
        )}
      </dl>
      {brief.projectId && (
        <Button
          kind="secondary"
          className="mt-4 w-full"
          onClick={() => onNavigate(`/company/projects/${brief.projectId}`)}
        >
          Open linked project
        </Button>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-app-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function ReviewActions({
  onAccept,
  onRequestChanges,
  onCancel,
}: {
  onAccept: () => void;
  onRequestChanges: () => void;
  onCancel: (() => void) | null;
}): React.JSX.Element {
  return (
    <Card>
      <h3 className="font-display text-lg font-bold">Review</h3>
      <p className="mt-2 text-xs text-app-muted">
        Accepting creates the project link. Requesting changes sends it back to Sales for revision.
      </p>
      <div className="mt-3 grid gap-2">
        <Button onClick={onAccept}>Accept</Button>
        <Button kind="secondary" onClick={onRequestChanges}>
          Request changes
        </Button>
        {onCancel && (
          <Button kind="danger" onClick={onCancel}>
            Cancel brief
          </Button>
        )}
      </div>
    </Card>
  );
}

function AcceptDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (projectId: string) => Promise<void>;
}): React.JSX.Element {
  const [projectId, setProjectId] = useState('');
  return (
    <Modal title="Accept brief and link project" onClose={onClose}>
      <p className="text-sm text-app-muted">
        A project must be pre-created in the Projects module. Paste its id below — the link is
        idempotent on this brief.
      </p>
      <div className="mt-4">
        <Field
          label="Project id"
          value={projectId}
          onChange={setProjectId}
          placeholder="UUID of an existing project"
        />
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button kind="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!/^[0-9a-fA-F-]{36}$/.test(projectId.trim())}
          onClick={() => void onConfirm(projectId.trim())}
        >
          Accept
        </Button>
      </div>
    </Modal>
  );
}

function ChangesDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (changeNotes: string) => Promise<void>;
}): React.JSX.Element {
  const [notes, setNotes] = useState('');
  return (
    <Modal title="Request changes" onClose={onClose}>
      <p className="text-sm text-app-muted">
        Describe what needs to change — the salesperson will see this on their draft.
      </p>
      <div className="mt-4">
        <Field label="Change notes" value={notes} onChange={setNotes} />
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button kind="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={notes.trim().length < 3}
          onClick={() => void onConfirm(notes.trim())}
        >
          Send back
        </Button>
      </div>
    </Modal>
  );
}

function CancelDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  return (
    <Modal title="Cancel brief" onClose={onClose}>
      <p className="text-sm text-app-muted">
        A cancelled brief cannot be reopened — Sales will have to start a new one.
      </p>
      <div className="mt-4">
        <Field label="Reason" value={reason} onChange={setReason} />
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button kind="secondary" onClick={onClose}>
          Keep brief
        </Button>
        <Button
          kind="danger"
          disabled={reason.trim().length < 3}
          onClick={() => void onConfirm(reason.trim())}
        >
          Cancel brief
        </Button>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-xl bg-app-background p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">{title}</h2>
          <button
            type="button"
            className="text-sm text-app-muted hover:text-app-foreground"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
