import { useEffect, useState } from 'react';
import { Button, Card, Field, Page, Select } from '../../../ui/components.js';
import {
  cancelDealAfterWin,
  confirmPayment,
  getDeal,
  getWinReadiness,
  listDeals,
  markDealLost,
  overrideProbability,
  recordDealWin,
  revertPaymentConfirmation,
  updateDealStage,
  type ConfirmPaymentInput,
  type Deal,
  type DealLossReason,
  type DealStage,
  type ReadinessReport,
} from './api.js';
import {
  decideApproval,
  listPendingApprovals,
  type ApprovalRequest,
  type ApprovalVerdict,
} from '../approvals/api.js';
import {
  APPROVAL_LABELS,
  CONTRACT_LABELS,
  LIFECYCLE_LABELS,
  LOSS_REASON_LABELS,
  PAYMENT_LABELS,
  STAGE_LABELS,
  approvalTone,
  contractTone,
  formatCurrencyLabel,
  formatProbability,
  formatRelativeDate,
  lifecycleTone,
  nextStageOptions,
  paymentTone,
  stageTone,
  type BadgeTone,
} from './deals-helpers.js';

const BADGE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-app-background text-app-muted',
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  danger: 'bg-[#d86b6b]/15 text-app-danger',
};

interface DealDetailPageProps {
  readonly id: string;
  readonly currentUserId: string;
  readonly canApprove: boolean;
  readonly canDecideApprovals: boolean;
  readonly canRecordWin: boolean;
  readonly canConfirmPayment: boolean;
  readonly onBack: () => void;
  readonly onNavigate: (path: string) => void;
}

export function DealDetailPage({
  id,
  currentUserId,
  canApprove,
  canDecideApprovals,
  canRecordWin,
  canConfirmPayment,
  onBack,
  onNavigate,
}: DealDetailPageProps): React.JSX.Element {
  const [deal, setDeal] = useState<Deal | null>(null);
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const [myApproval, setMyApproval] = useState<ApprovalRequest | null>(null);
  const [decideBusy, setDecideBusy] = useState<ApprovalVerdict | null>(null);
  const [decideComment, setDecideComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmLost, setConfirmLost] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [probabilityOpen, setProbabilityOpen] = useState(false);
  const [confirmPaymentOpen, setConfirmPaymentOpen] = useState(false);
  const [revertPaymentOpen, setRevertPaymentOpen] = useState(false);

  async function reload(): Promise<void> {
    try {
      const next = await getDeal(id);
      setDeal(next);
      setError(null);
      if (next.lifecycleStatus === 'open') {
        try {
          const r = await getWinReadiness(id);
          setReadiness(r);
        } catch {
          setReadiness(null);
        }
      } else {
        setReadiness(null);
      }
      if (canDecideApprovals && next.approvalStatus === 'pending') {
        try {
          const queue = await listPendingApprovals();
          const match = queue.find(
            (a) => a.dealId === next.id && a.currentApproverId === currentUserId,
          );
          setMyApproval(match ?? null);
        } catch {
          setMyApproval(null);
        }
      } else {
        setMyApproval(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load deal.');
    }
  }

  async function decide(verdict: ApprovalVerdict): Promise<void> {
    if (!myApproval) return;
    setDecideBusy(verdict);
    setActionError(null);
    try {
      await decideApproval(myApproval.id, verdict, decideComment.trim() || undefined);
      setDecideComment('');
      await reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Decide failed.');
    } finally {
      setDecideBusy(null);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function runAction<T>(action: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setActionError(null);
    try {
      const result = await action();
      await reload();
      return result;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Action failed.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <Page eyebrow="Sales" title="Deal">
        <p className="text-app-danger">{error}</p>
        <Button className="mt-4" kind="secondary" onClick={onBack}>
          Back to deals
        </Button>
      </Page>
    );
  }

  if (!deal) {
    return (
      <Page eyebrow="Sales" title="Deal">
        <p className="text-sm text-app-muted">Loading deal…</p>
      </Page>
    );
  }

  const isOpen = deal.lifecycleStatus === 'open';
  const isWon = deal.lifecycleStatus === 'won';
  const stageOptions = nextStageOptions(deal.dealStage);
  const canClose = Boolean(readiness?.canClose);

  return (
    <Page
      eyebrow="Sales"
      title={deal.title}
      description={`Deal #${deal.dealNumber}`}
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            kind="secondary"
            onClick={() => onNavigate(`/company/sales/deals/${deal.id}/proposals`)}
          >
            Proposals
          </Button>
          <Button
            kind="secondary"
            onClick={() => onNavigate(`/company/sales/deals/${deal.id}/delivery`)}
          >
            Delivery brief
          </Button>
          <Button kind="secondary" onClick={onBack}>
            Back to deals
          </Button>
        </div>
      }
    >
      {actionError && (
        <p className="mb-4 rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger" role="alert">
          {actionError}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-wrap gap-2">
            <Badge tone={stageTone(deal.dealStage)}>{STAGE_LABELS[deal.dealStage]}</Badge>
            <Badge tone={lifecycleTone(deal.lifecycleStatus)}>
              {LIFECYCLE_LABELS[deal.lifecycleStatus]}
            </Badge>
            <Badge tone={approvalTone(deal.approvalStatus)}>
              Approval · {APPROVAL_LABELS[deal.approvalStatus]}
            </Badge>
            <Badge tone={contractTone(deal.contractStatus)}>
              Contract · {CONTRACT_LABELS[deal.contractStatus]}
            </Badge>
            <Badge tone={paymentTone(deal.paymentStatus)}>
              Payment · {PAYMENT_LABELS[deal.paymentStatus]}
            </Badge>
          </div>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <Fact label="Contact">{deal.contactName ?? '—'}</Fact>
            <Fact label="Company">{deal.companyName ?? '—'}</Fact>
            <Fact label="Service">{deal.serviceRequested ?? '—'}</Fact>
            <Fact label="Currency">{formatCurrencyLabel(deal.currency)} {deal.currency}</Fact>
            <Fact label="Responsible closer">{deal.responsibleCloserName ?? '—'}</Fact>
            <Fact label="Originating agent">{deal.originatingAgentName ?? '—'}</Fact>
            <Fact label="Expected close">{formatRelativeDate(deal.expectedCloseAt)}</Fact>
            <Fact label="Probability">
              {formatProbability(deal)}
              {isOpen && (
                <button
                  type="button"
                  className="ml-2 text-xs font-semibold text-app-accent underline"
                  onClick={() => setProbabilityOpen(true)}
                >
                  Override
                </button>
              )}
            </Fact>
            {deal.originatingLeadId && (
              <Fact label="Originating lead">
                <button
                  type="button"
                  className="font-semibold text-app-accent underline"
                  onClick={() => onNavigate(`/company/sales/leads/${deal.originatingLeadId}`)}
                >
                  View lead
                </button>
              </Fact>
            )}
            {deal.directEntryReason && (
              <Fact label="Direct-entry reason">{deal.directEntryReason}</Fact>
            )}
          </div>

          {deal.scopeSummary && (
            <div className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">Scope</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-app-foreground">{deal.scopeSummary}</p>
            </div>
          )}

          {deal.lifecycleStatus === 'lost' && (
            <div className="mt-6 rounded-lg bg-[#d86b6b]/10 p-3 text-sm">
              <p className="font-semibold text-app-danger">
                Lost — {deal.lossReason ? LOSS_REASON_LABELS[deal.lossReason] : 'reason unknown'}
              </p>
              <p className="mt-1 text-xs text-app-muted">
                {deal.lostAt ? `Marked at ${new Date(deal.lostAt).toLocaleString()}` : ''}
              </p>
            </div>
          )}
          {isWon && (
            <div className="mt-6 rounded-lg bg-emerald-500/10 p-3 text-sm">
              <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                Won{deal.wonAt ? ` on ${new Date(deal.wonAt).toLocaleString()}` : ''}
              </p>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          {myApproval && (
            <DecidePanel
              busy={decideBusy}
              comment={decideComment}
              onCommentChange={setDecideComment}
              onDecide={(verdict) => void decide(verdict)}
            />
          )}
          <ActionRail
            deal={deal}
            readiness={readiness}
            busy={busy}
            canApprove={canApprove}
            canRecordWin={canRecordWin}
            canConfirmPayment={canConfirmPayment}
            stageOptions={stageOptions}
            onChangeStage={(stage) => void runAction(() => updateDealStage(deal.id, stage))}
            onMarkLost={() => setConfirmLost(true)}
            onRecordWin={() => void runAction(() => recordDealWin(deal.id))}
            onCancelAfterWin={() => setConfirmCancel(true)}
            onConfirmPayment={() => setConfirmPaymentOpen(true)}
            onRevertPayment={() => setRevertPaymentOpen(true)}
            canClose={canClose}
          />
        </div>
      </div>

      {confirmLost && (
        <MarkLostDialog
          busy={busy}
          onClose={() => setConfirmLost(false)}
          onConfirm={async (reason, note) => {
            const result = await runAction(() => markDealLost(deal.id, reason, note));
            if (result) setConfirmLost(false);
          }}
        />
      )}

      {confirmCancel && (
        <CancelAfterWinDialog
          busy={busy}
          onClose={() => setConfirmCancel(false)}
          onConfirm={async (reason) => {
            const result = await runAction(() => cancelDealAfterWin(deal.id, reason));
            if (result) setConfirmCancel(false);
          }}
        />
      )}

      {probabilityOpen && (
        <ProbabilityDialog
          current={deal.probabilityOverride}
          busy={busy}
          onClose={() => setProbabilityOpen(false)}
          onConfirm={async (probability, reason) => {
            const result = await runAction(() => overrideProbability(deal.id, probability, reason));
            if (result) setProbabilityOpen(false);
          }}
        />
      )}

      {confirmPaymentOpen && (
        <ConfirmPaymentDialog
          currency={deal.currency}
          busy={busy}
          onClose={() => setConfirmPaymentOpen(false)}
          onConfirm={async (input) => {
            const result = await runAction(() => confirmPayment(deal.id, input));
            if (result) setConfirmPaymentOpen(false);
          }}
        />
      )}

      {revertPaymentOpen && (
        <RevertPaymentDialog
          busy={busy}
          onClose={() => setRevertPaymentOpen(false)}
          onConfirm={async (reason) => {
            const result = await runAction(() => revertPaymentConfirmation(deal.id, reason));
            if (result) setRevertPaymentOpen(false);
          }}
        />
      )}
    </Page>
  );
}

function ActionRail({
  deal,
  readiness,
  busy,
  canApprove,
  canRecordWin,
  canConfirmPayment,
  stageOptions,
  canClose,
  onChangeStage,
  onMarkLost,
  onRecordWin,
  onCancelAfterWin,
  onConfirmPayment,
  onRevertPayment,
}: {
  deal: Deal;
  readiness: ReadinessReport | null;
  busy: boolean;
  canApprove: boolean;
  canRecordWin: boolean;
  canConfirmPayment: boolean;
  stageOptions: readonly DealStage[];
  canClose: boolean;
  onChangeStage: (stage: DealStage) => void;
  onMarkLost: () => void;
  onRecordWin: () => void;
  onCancelAfterWin: () => void;
  onConfirmPayment: () => void;
  onRevertPayment: () => void;
}): React.JSX.Element {
  const isOpen = deal.lifecycleStatus === 'open';
  const isWon = deal.lifecycleStatus === 'won';
  const [nextStage, setNextStage] = useState<DealStage | ''>('');
  const paymentNeedsAction =
    deal.paymentStatus === 'unpaid' || deal.paymentStatus === 'partial';
  const showPaymentPanel =
    canConfirmPayment && (isOpen || isWon) && paymentNeedsAction;
  const showRevertPanel =
    canConfirmPayment && isOpen && deal.paymentStatus === 'advance_confirmed';

  return (
    <Card>
      <h2 className="font-display text-lg font-bold">Actions</h2>

      {isOpen ? (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">
              Change stage
            </p>
            <div className="mt-2 flex gap-2">
              <select
                value={nextStage}
                onChange={(event) => setNextStage(event.target.value as DealStage)}
                className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"
                disabled={busy || stageOptions.length === 0}
              >
                <option value="">Select next stage</option>
                {stageOptions.map((stage) => (
                  <option key={stage} value={stage}>
                    {STAGE_LABELS[stage]}
                  </option>
                ))}
              </select>
              <Button
                disabled={!nextStage || busy}
                onClick={() => nextStage && onChangeStage(nextStage)}
              >
                Apply
              </Button>
            </div>
          </div>

          {showPaymentPanel && (
            <div className="border-t border-app-border pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">
                Advance payment
              </p>
              <p className="mt-2 text-xs text-app-muted">
                Record the advance Finance has received so the deal becomes close-ready.
              </p>
              <Button className="mt-3 w-full" kind="secondary" disabled={busy} onClick={onConfirmPayment}>
                Confirm advance received
              </Button>
            </div>
          )}

          {showRevertPanel && (
            <div className="border-t border-app-border pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">
                Advance payment
              </p>
              <p className="mt-2 text-xs text-app-muted">
                Advance is confirmed. Revert if the entry was made in error — the deal returns to
                unpaid and must be re-confirmed before close.
              </p>
              <Button className="mt-3 w-full" kind="danger" disabled={busy} onClick={onRevertPayment}>
                Revert advance confirmation
              </Button>
            </div>
          )}

          <div className="border-t border-app-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">
              Record win
            </p>
            {readiness ? (
              <>
                {readiness.canClose ? (
                  <p className="mt-2 text-xs text-app-muted">All close conditions met.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-xs text-app-muted">
                    {readiness.unmet.map((item) => (
                      <li key={item.condition}>
                        <span className="font-semibold capitalize text-app-foreground">
                          {item.condition.replaceAll('_', ' ')}:
                        </span>{' '}
                        {item.description}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="mt-2 text-xs text-app-muted">Readiness unavailable.</p>
            )}
            <Button
              className="mt-3 w-full"
              disabled={!canClose || !canRecordWin || busy}
              onClick={onRecordWin}
            >
              Record win
            </Button>
            {!canRecordWin && (
              <p className="mt-2 text-xs text-app-muted">
                Only Sales HOD / Super Admin can record a win.
              </p>
            )}
          </div>

          <div className="border-t border-app-border pt-4">
            <Button kind="danger" disabled={busy} onClick={onMarkLost} className="w-full">
              Mark lost
            </Button>
          </div>
        </div>
      ) : isWon ? (
        <div className="mt-4 space-y-3">
          {canApprove ? (
            <Button kind="danger" disabled={busy} onClick={onCancelAfterWin} className="w-full">
              Cancel after win
            </Button>
          ) : (
            <p className="text-xs text-app-muted">
              Only users with deals:approve can cancel a won deal.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-xs text-app-muted">
          This deal is in a terminal state. No actions available.
        </p>
      )}
    </Card>
  );
}

const LOSS_REASONS: DealLossReason[] = [
  'not_interested',
  'no_budget',
  'no_need',
  'competitor',
  'timing',
  'unqualified',
  'duplicate',
  'other',
];

function MarkLostDialog({
  busy,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: DealLossReason, note?: string) => Promise<void>;
}): React.JSX.Element {
  const [reason, setReason] = useState<DealLossReason>('other');
  const [note, setNote] = useState('');
  return (
    <Modal title="Mark deal lost" onClose={onClose}>
      <Select
        label="Loss reason"
        value={reason}
        onChange={(value) => setReason(value as DealLossReason)}
        options={LOSS_REASONS.map((value) => ({ value, label: LOSS_REASON_LABELS[value] }))}
      />
      <div className="mt-4">
        <Field label="Note (optional)" value={note} onChange={setNote} placeholder="Context" />
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button kind="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          kind="danger"
          disabled={busy}
          onClick={() => void onConfirm(reason, note.trim() || undefined)}
        >
          Mark lost
        </Button>
      </div>
    </Modal>
  );
}

function CancelAfterWinDialog({
  busy,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  return (
    <Modal title="Cancel after win" onClose={onClose}>
      <Field
        label="Reason (required)"
        value={reason}
        onChange={setReason}
        placeholder="Why is this won deal being cancelled?"
      />
      <div className="mt-5 flex justify-end gap-3">
        <Button kind="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button kind="danger" disabled={busy || reason.trim().length < 5} onClick={() => void onConfirm(reason.trim())}>
          Cancel deal
        </Button>
      </div>
    </Modal>
  );
}

function ProbabilityDialog({
  current,
  busy,
  onClose,
  onConfirm,
}: {
  current: number | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (probability: number, reason: string) => Promise<void>;
}): React.JSX.Element {
  const [probability, setProbability] = useState(String(current ?? ''));
  const [reason, setReason] = useState('');
  const value = Number(probability);
  const valid =
    probability.trim().length > 0 &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 100 &&
    reason.trim().length >= 5;
  return (
    <Modal title="Override probability" onClose={onClose}>
      <Field
        label="Probability (0–100)"
        value={probability}
        onChange={setProbability}
        type="number"
      />
      <div className="mt-4">
        <Field label="Reason (required)" value={reason} onChange={setReason} />
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button kind="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy || !valid} onClick={() => void onConfirm(value, reason.trim())}>
          Save
        </Button>
      </div>
    </Modal>
  );
}

function ConfirmPaymentDialog({
  currency,
  busy,
  onClose,
  onConfirm,
}: {
  currency: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (input: ConfirmPaymentInput) => Promise<void>;
}): React.JSX.Element {
  const [amountRupees, setAmountRupees] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const parsedPaise = parseRupeesToPaise(amountRupees);
  const amountValid = parsedPaise !== null && parsedPaise > 0n;
  const canSubmit = amountValid && reference.trim().length > 0 && !busy;
  return (
    <Modal title="Confirm advance received" onClose={onClose}>
      <p className="text-xs text-app-muted">
        Record the advance Finance has already received. This flips the deal's payment status to
        "advance confirmed" and unblocks the Won readiness check. All amounts are in {currency}.
      </p>
      <div className="mt-4 grid gap-4">
        <Field
          label={`Amount received (${currency})`}
          value={amountRupees}
          onChange={setAmountRupees}
          placeholder="e.g. 50000.00"
        />
        <Field
          label="Reference (UTR, cheque no, invoice id)"
          value={reference}
          onChange={setReference}
        />
        <label className="text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Note (optional)</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-[80px] w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"
          />
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button kind="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!canSubmit}
          onClick={() =>
            void onConfirm({
              amountMinor: parsedPaise!.toString(),
              reference: reference.trim(),
              ...(note.trim() ? { note: note.trim() } : {}),
            })
          }
        >
          Confirm
        </Button>
      </div>
    </Modal>
  );
}

function RevertPaymentDialog({
  busy,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  return (
    <Modal title="Revert advance confirmation" onClose={onClose}>
      <p className="text-xs text-app-muted">
        The deal returns to <strong>unpaid</strong>. Readiness for Won will drop until the advance
        is confirmed again. Only open deals can be reverted — a confirmed advance on a Won deal
        requires cancel-after-win instead.
      </p>
      <div className="mt-4">
        <Field label="Reason (required)" value={reason} onChange={setReason} placeholder="Why?" />
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button kind="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button kind="danger" disabled={busy || reason.trim().length < 5} onClick={() => void onConfirm(reason.trim())}>
          Revert
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Local rupee → paise parser. We don't import the proposals helper to
 * avoid a circular dependency on that module from the deals surface.
 * Accepts non-negative decimals with up to 2 fractional digits.
 */
function parseRupeesToPaise(input: string): bigint | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  const paddedFraction = (fraction + '00').slice(0, 2);
  try {
    return BigInt((whole ?? '0') + paddedFraction);
  } catch {
    return null;
  }
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

function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }): React.JSX.Element {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold ${BADGE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">{label}</p>
      <p className="mt-1 font-semibold capitalize">{children}</p>
    </div>
  );
}

function DecidePanel({
  busy,
  comment,
  onCommentChange,
  onDecide,
}: {
  busy: ApprovalVerdict | null;
  comment: string;
  onCommentChange: (value: string) => void;
  onDecide: (verdict: ApprovalVerdict) => void;
}): React.JSX.Element {
  return (
    <Card>
      <h2 className="font-display text-lg font-bold">Approval decision</h2>
      <p className="mt-2 text-xs text-app-muted">
        This request is routed to you. Returning sends it back to the salesperson for revisions.
      </p>
      <div className="mt-4">
        <Field
          label="Comment (optional)"
          value={comment}
          onChange={onCommentChange}
          placeholder="Rationale or guidance"
        />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Button disabled={busy !== null} onClick={() => onDecide('approve')}>
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </Button>
        <Button kind="secondary" disabled={busy !== null} onClick={() => onDecide('return')}>
          {busy === 'return' ? 'Returning…' : 'Return'}
        </Button>
        <Button kind="danger" disabled={busy !== null} onClick={() => onDecide('reject')}>
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </Button>
      </div>
    </Card>
  );
}

/** Re-exported here so other R2 pages (wins-to-record) can share the API client. */
export { listDeals };
