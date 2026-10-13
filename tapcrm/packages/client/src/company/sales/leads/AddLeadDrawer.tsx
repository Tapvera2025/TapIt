import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Field } from '../../../ui/components.js';
import {
  checkDuplicateLeads,
  createLead,
  type Campaign,
  type Lead,
  type LeadSource,
} from './api.js';
import {
  buildDuplicateQuery,
  generateIdempotencyKey,
  hasEnoughInputForLookup,
  normalizeEmailForLookup,
  normalizePhoneForLookup,
  offerDuplicateChoices,
} from './addLead-helpers.js';

/**
 * Add-Lead drawer (R1 plan step 1.12). Right-slide panel with:
 *   - the compact fields (name, phone or email, source, requirement)
 *   - a collapsed "Advanced" section (company, campaign, location, …)
 *   - a 400 ms-debounced live duplicate check that offers
 *     "Open existing" / "Add enquiry" / "Create separate"
 *   - a per-submission idempotency key resent on retry
 *
 * The component owns no routing: the parent passes `onNavigate` for
 * "Open existing" and `onCreated` for a successful lead.
 */

export interface AddLeadDrawerProps {
  readonly sources: readonly LeadSource[];
  readonly campaigns: readonly Campaign[];
  readonly onClose: () => void;
  readonly onCreated: (lead: Lead, duplicates: Array<{ leadId: string; leadNumber: string; ownerName: string | null }>) => void;
  readonly onOpenExisting: (leadId: string) => void;
  /** Receptionist mode changes the default direction + copy. */
  readonly mode?: 'agent' | 'receptionist';
}

interface DuplicateHit {
  readonly leadId: string;
  readonly leadNumber: string;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
}

const DEBOUNCE_MS = 400;

export function AddLeadDrawer({
  sources,
  campaigns,
  onClose,
  onCreated,
  onOpenExisting,
  mode = 'agent',
}: AddLeadDrawerProps): React.JSX.Element {
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [requirement, setRequirement] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [location, setLocation] = useState('');
  const [languagePreference, setLanguagePreference] = useState('');
  const [notes, setNotes] = useState('');

  const [duplicates, setDuplicates] = useState<DuplicateHit[]>([]);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idempotencyKey = useMemo(() => generateIdempotencyKey(), []);
  const closedRef = useRef(false);

  useEffect(() => {
    return () => {
      closedRef.current = true;
    };
  }, []);

  const query = buildDuplicateQuery(phone, email);
  const canLookup = hasEnoughInputForLookup(query);

  useEffect(() => {
    if (!canLookup) {
      setDuplicates([]);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(() => {
      checkDuplicateLeads({ phone: query.phone, email: query.email })
        .then((result) => {
          if (!cancelled) setDuplicates(result.duplicates);
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            setError(cause instanceof Error ? cause.message : 'Could not check duplicates');
          }
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canLookup, query.phone, query.email]);

  const offer = offerDuplicateChoices(duplicates.length);

  const canSubmit =
    !submitting &&
    contactName.trim().length > 0 &&
    (normalizePhoneForLookup(phone) !== null || normalizeEmailForLookup(email) !== null) &&
    sourceId.length > 0;

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createLead(
        {
          contactName: contactName.trim(),
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          sourceId,
          companyName: companyName.trim() || undefined,
          campaignId: campaignId || undefined,
        },
        { idempotencyKey },
      );
      onCreated(result.lead, result.duplicates);
      onClose();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to create lead.');
    } finally {
      if (!closedRef.current) setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add lead"
      className="fixed inset-0 z-50 flex"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <button
        type="button"
        aria-label="Close drawer"
        className="flex-1 bg-black/40"
        onClick={onClose}
      />
      <aside className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-app-border bg-app-background p-6 shadow-2xl">
        <header className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-app-accent">
              {mode === 'receptionist' ? 'Receptionist · Inbound' : 'New lead'}
            </p>
            <h2 className="mt-2 font-display text-2xl font-bold">Add a lead</h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-2 text-app-muted hover:bg-app-background hover:text-app-foreground"
          >
            ×
          </button>
        </header>

        <section className="grid gap-4">
          <Field label="Contact name" value={contactName} onChange={setContactName} required />
          <Field label="Phone (E.164)" value={phone} onChange={setPhone} placeholder="+91 98765 43210" />
          <Field label="Email" value={email} onChange={setEmail} type="email" />
          <label className="text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Source</span>
            <select
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"
              required
            >
              <option value="">Select source</option>
              {sources
                .filter((source) => source.status === 'active')
                .map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
            </select>
          </label>
          <Field label="Requirement" value={requirement} onChange={setRequirement} placeholder="What do they need?" />
        </section>

        <DuplicateCard
          checking={checking}
          duplicates={duplicates}
          offer={offer}
          onOpenExisting={(leadId) => {
            onOpenExisting(leadId);
            onClose();
          }}
          onCreateSeparate={() => setDuplicates([])}
        />

        <Advanced
          open={advancedOpen}
          onToggle={() => setAdvancedOpen((prev) => !prev)}
          companyName={companyName}
          setCompanyName={setCompanyName}
          campaignId={campaignId}
          setCampaignId={setCampaignId}
          campaigns={campaigns}
          location={location}
          setLocation={setLocation}
          languagePreference={languagePreference}
          setLanguagePreference={setLanguagePreference}
          notes={notes}
          setNotes={setNotes}
        />

        {error && (
          <p className="mt-4 rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger">{error}</p>
        )}

        <footer className="mt-6 flex justify-end gap-3">
          <Button kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? 'Creating…' : 'Create lead'}
          </Button>
        </footer>
      </aside>
    </div>
  );
}

function DuplicateCard({
  checking,
  duplicates,
  offer,
  onOpenExisting,
  onCreateSeparate,
}: {
  checking: boolean;
  duplicates: DuplicateHit[];
  offer: ReturnType<typeof offerDuplicateChoices>;
  onOpenExisting: (leadId: string) => void;
  onCreateSeparate: () => void;
}): React.JSX.Element | null {
  if (checking) {
    return (
      <p className="mt-4 text-xs text-app-muted" aria-live="polite">
        Checking for duplicates…
      </p>
    );
  }
  if (!offer.hasDuplicates) return null;
  return (
    <section
      aria-label="Possible duplicate"
      className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
    >
      <p className="text-sm font-semibold">
        Possible duplicate — {duplicates.length} existing lead{duplicates.length === 1 ? '' : 's'}
      </p>
      <ul className="mt-2 space-y-1 text-sm text-app-muted">
        {duplicates.slice(0, 3).map((duplicate) => (
          <li key={duplicate.leadId}>
            <button
              type="button"
              className="underline underline-offset-2 hover:text-app-foreground"
              onClick={() => onOpenExisting(duplicate.leadId)}
            >
              #{duplicate.leadNumber}
            </button>
            {duplicate.ownerName && <span> · {duplicate.ownerName}</span>}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Button kind="secondary" onClick={() => onOpenExisting(duplicates[0]!.leadId)}>
          Open existing
        </Button>
        <Button kind="secondary" onClick={onCreateSeparate}>
          Create separate anyway
        </Button>
      </div>
      <p className="mt-2 text-xs text-app-muted">
        "Add enquiry" happens automatically when you submit — the dedupe engine links the new row
        to the existing contact's active lead.
      </p>
    </section>
  );
}

function Advanced({
  open,
  onToggle,
  companyName,
  setCompanyName,
  campaignId,
  setCampaignId,
  campaigns,
  location,
  setLocation,
  languagePreference,
  setLanguagePreference,
  notes,
  setNotes,
}: {
  open: boolean;
  onToggle: () => void;
  companyName: string;
  setCompanyName: (value: string) => void;
  campaignId: string;
  setCampaignId: (value: string) => void;
  campaigns: readonly Campaign[];
  location: string;
  setLocation: (value: string) => void;
  languagePreference: string;
  setLanguagePreference: (value: string) => void;
  notes: string;
  setNotes: (value: string) => void;
}): React.JSX.Element {
  return (
    <section className="mt-5 border-t border-app-border pt-5">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center justify-between text-xs font-bold uppercase tracking-[0.14em] text-app-muted hover:text-app-foreground"
      >
        <span>Advanced</span>
        <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="mt-4 grid gap-4">
          <Field label="Company" value={companyName} onChange={setCompanyName} />
          <label className="text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Campaign</span>
            <select
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"
            >
              <option value="">No campaign</option>
              {campaigns
                .filter((campaign) => campaign.status === 'active')
                .map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
            </select>
          </label>
          <Field label="Location" value={location} onChange={setLocation} />
          <Field label="Language preference" value={languagePreference} onChange={setLanguagePreference} />
          <Field label="Notes" value={notes} onChange={setNotes} />
        </div>
      )}
    </section>
  );
}

/**
 * `A` or `Alt+N` toggles the drawer. Mounts a document-level listener;
 * exported so the sales workspace can reuse it on every page.
 */
export function useAddLeadShortcut(onOpen: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase() ?? '';
      const isTyping =
        tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
      if (isTyping) return;
      if (event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        onOpen();
        return;
      }
      if (!event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        onOpen();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onOpen]);
}
