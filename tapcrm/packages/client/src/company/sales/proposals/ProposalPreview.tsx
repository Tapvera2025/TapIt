import { Card } from '../../../ui/components.js';
import type { Commercials } from './api.js';
import {
  COMMERCIALS_STATE_LABELS,
  commercialsStateTone,
  currencySymbol,
  paiseToRupees,
  type BadgeTone,
} from './proposals-helpers.js';

const BADGE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-app-background text-app-muted',
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  danger: 'bg-[#d86b6b]/15 text-app-danger',
};

export function ProposalPreview({ commercials }: { commercials: Commercials }): React.JSX.Element {
  const symbol = currencySymbol(commercials.currency);
  const tone = commercialsStateTone(commercials.state);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg font-bold">
          Version {commercials.version}
        </h3>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${BADGE_CLASSES[tone]}`}>
          {COMMERCIALS_STATE_LABELS[commercials.state]}
        </span>
      </div>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <Fact label="Subtotal">{symbol}{paiseToRupees(commercials.subtotalMinor)}</Fact>
        <Fact label="Discount">{symbol}{paiseToRupees(commercials.discountMinor)}</Fact>
        <Fact label="Tax">{symbol}{paiseToRupees(commercials.taxMinor)}</Fact>
        <Fact label="Total">
          <span className="font-display text-base font-bold">
            {symbol}{paiseToRupees(commercials.totalMinor)}
          </span>
        </Fact>
        <Fact label="Expected advance">{symbol}{paiseToRupees(commercials.advanceMinor)}</Fact>
        <Fact label="Valid until">
          {commercials.validityAt
            ? new Date(commercials.validityAt).toLocaleDateString()
            : '—'}
        </Fact>
      </div>
      {commercials.scope && (
        <PreviewSection label="Scope">{commercials.scope}</PreviewSection>
      )}
      {commercials.exclusions && (
        <PreviewSection label="Exclusions">{commercials.exclusions}</PreviewSection>
      )}
      {commercials.timeline && (
        <PreviewSection label="Timeline">{commercials.timeline}</PreviewSection>
      )}
      {commercials.terms && (
        <PreviewSection label="Terms">{commercials.terms}</PreviewSection>
      )}
      {commercials.pdfChecksum && (
        <p className="mt-4 text-xs text-app-muted">
          PDF checksum: <span className="font-mono">{commercials.pdfChecksum.slice(0, 16)}…</span>
        </p>
      )}
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">{label}</p>
      <p className="mt-1 font-semibold">{children}</p>
    </div>
  );
}

function PreviewSection({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-app-foreground">{children}</p>
    </div>
  );
}
