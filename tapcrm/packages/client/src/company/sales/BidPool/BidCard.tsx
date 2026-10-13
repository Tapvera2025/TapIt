import { useId, useState } from 'react';
import { Button } from '../../../ui/components.js';
import { claimBidPoolLead, passBidPoolLead, type MaskedBidCard } from './api.js';
import {
  classifyClaimError,
  describeAging,
  PASS_REASONS,
  type PassReason,
} from './bidPool-helpers.js';

/**
 * One bid-pool card (R1 plan step 1.13). Rendered inside a `<article>`
 * with `aria-labelledby` on its heading; Accept is the default focus
 * target so a keyboard user tabs onto it first.
 */

export type ToastKind = 'info' | 'error' | 'warning';
export interface BidCardCallbacks {
  readonly onClaimed: (leadId: string) => void;
  readonly onPassed: (leadId: string) => void;
  readonly onLost: (leadId: string, kind: 'already_claimed' | 'not_eligible' | 'other', message: string) => void;
}

export function BidCard({ card, callbacks, now = new Date() }: {
  card: MaskedBidCard;
  callbacks: BidCardCallbacks;
  /** Injectable for tests. */
  now?: Date;
}): React.JSX.Element {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [passing, setPassing] = useState(false);
  const aging = describeAging(card.expiresAt, now);
  const severityClass =
    aging.severity === 'fresh'
      ? 'border-emerald-500/40 bg-emerald-500/5'
      : aging.severity === 'warming'
        ? 'border-amber-500/40 bg-amber-500/5'
        : 'border-[#d86b6b]/40 bg-[#d86b6b]/5';

  async function onAccept(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await claimBidPoolLead(card.leadId);
      callbacks.onClaimed(card.leadId);
    } catch (cause: unknown) {
      const status = extractStatus(cause);
      const body = extractBody(cause);
      const kind = classifyClaimError(status, body);
      const message =
        kind === 'already_claimed'
          ? 'Another agent beat you to this lead.'
          : kind === 'not_eligible'
            ? 'You cannot claim right now — check your availability.'
            : cause instanceof Error
              ? cause.message
              : 'Unable to claim.';
      callbacks.onLost(card.leadId, kind, message);
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmPass(reason: PassReason): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await passBidPoolLead(card.leadId, reason);
      callbacks.onPassed(card.leadId);
    } catch (cause: unknown) {
      callbacks.onLost(card.leadId, 'other', cause instanceof Error ? cause.message : 'Pass failed.');
    } finally {
      setBusy(false);
      setPassing(false);
    }
  }

  return (
    <article
      aria-labelledby={titleId}
      className={`ui-card rounded-xl border p-5 ${severityClass}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 id={titleId} className="font-display text-lg font-bold">
            {card.maskedName || card.maskedPhone}
          </h3>
          <p className="mt-1 text-xs text-app-muted">
            {card.source}
            {card.campaign ? ` · ${card.campaign}` : ''}
          </p>
        </div>
        <span
          aria-label={`Time remaining: ${aging.label}`}
          className="rounded-full bg-app-background px-3 py-1 text-xs font-bold"
        >
          {aging.label}
        </span>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-app-muted">
        {card.service && (<><dt className="font-semibold">Service</dt><dd className="text-app-foreground">{card.service}</dd></>)}
        {card.location && (<><dt className="font-semibold">Location</dt><dd className="text-app-foreground">{card.location}</dd></>)}
        {card.budgetBracket && (<><dt className="font-semibold">Budget</dt><dd className="text-app-foreground">{card.budgetBracket}</dd></>)}
        {card.timeline && (<><dt className="font-semibold">Timeline</dt><dd className="text-app-foreground">{card.timeline}</dd></>)}
      </dl>

      {card.messagePreview && (
        <p className="mt-3 text-sm text-app-foreground">
          <span className="sr-only">Message preview: </span>
          {card.messagePreview}
        </p>
      )}

      <footer className="mt-5 flex items-center justify-between gap-3">
        <p className="text-xs text-app-muted">
          {card.maskedPhone}
          {card.maskedEmail ? ` · ${card.maskedEmail}` : ''}
        </p>
        <div className="flex gap-2">
          <Button kind="secondary" onClick={() => setPassing(true)} disabled={busy}>
            Pass
          </Button>
          <Button autoFocus onClick={() => void onAccept()} disabled={busy}>
            Accept
          </Button>
        </div>
      </footer>

      {passing && (
        <PassReasonPicker
          onCancel={() => setPassing(false)}
          onConfirm={(reason) => void onConfirmPass(reason)}
          busy={busy}
        />
      )}
    </article>
  );
}

function PassReasonPicker({
  onCancel,
  onConfirm,
  busy,
}: {
  onCancel: () => void;
  onConfirm: (reason: PassReason) => void;
  busy: boolean;
}): React.JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Why are you passing this lead?"
      className="mt-4 rounded-lg border border-app-border bg-app-background p-4"
    >
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-app-muted">
        Reason for passing
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {PASS_REASONS.map(({ value, label }) => (
          <Button
            key={value}
            kind="secondary"
            disabled={busy}
            onClick={() => onConfirm(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <Button kind="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface MaybeHttpError {
  readonly status?: number;
  readonly data?: unknown;
  readonly response?: { status?: number; data?: unknown };
}

function extractStatus(error: unknown): number {
  if (typeof error !== 'object' || error === null) return 0;
  const e = error as MaybeHttpError;
  return e.status ?? e.response?.status ?? 0;
}

function extractBody(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return null;
  const e = error as MaybeHttpError;
  return e.data ?? e.response?.data ?? null;
}
