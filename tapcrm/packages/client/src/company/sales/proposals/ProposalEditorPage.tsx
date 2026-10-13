import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Page, Select } from '../../../ui/components.js';
import {
  createDraftCommercials,
  createShareLink,
  getCommercials,
  listCommercials,
  publishCommercials,
  revokeShareLink,
  updateDraftCommercials,
  type Commercials,
  type CommercialsBodyInput,
  type CommercialsItemInput,
  type DocumentDiscountInput,
  type ShareLinkResponse,
} from './api.js';
import { getDeal, type Deal } from '../deals/api.js';
import { CommercialsTable } from './CommercialsTable.js';
import { ProposalPreview } from './ProposalPreview.js';
import {
  COMMERCIALS_STATE_LABELS,
  commercialsStateTone,
  currencySymbol,
  isDraftEditable,
  paiseToRupees,
  percentToBps,
  portalUrl,
  rupeesToPaise,
  type BadgeTone,
} from './proposals-helpers.js';

const BADGE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-app-background text-app-muted',
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  danger: 'bg-[#d86b6b]/15 text-app-danger',
};

const AUTOSAVE_DEBOUNCE_MS = 800;

interface ProposalEditorPageProps {
  readonly dealId: string;
  readonly onBack: () => void;
}

export function ProposalEditorPage({ dealId, onBack }: ProposalEditorPageProps): React.JSX.Element {
  const [deal, setDeal] = useState<Deal | null>(null);
  const [versions, setVersions] = useState<readonly Commercials[]>([]);
  const [selected, setSelected] = useState<Commercials | null>(null);
  const [draftBody, setDraftBody] = useState<CommercialsBodyInput | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'stale'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [shareLink, setShareLink] = useState<ShareLinkResponse | null>(null);

  // Autosave debouncer. We hold the most recent body and expectedUpdatedAt
  // in refs so the timer can read them without re-arming on every keystroke.
  const bodyRef = useRef<CommercialsBodyInput | null>(null);
  const expectedUpdatedAtRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  async function reload(): Promise<void> {
    setLoadError(null);
    try {
      const [d, vs] = await Promise.all([getDeal(dealId), listCommercials(dealId)]);
      setDeal(d);
      setVersions(vs);
      if (vs.length > 0 && !selected) {
        const first = vs[0]!;
        setSelected(first);
        if (isDraftEditable(first.state)) openDraft(first);
      }
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Unable to load proposals.');
    }
  }

  useEffect(() => {
    void reload();
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  function openDraft(c: Commercials): void {
    setSelected(c);
    const body = commercialsToBody(c);
    setDraftBody(body);
    bodyRef.current = body;
    expectedUpdatedAtRef.current = c.updatedAt;
    setSaveStatus('idle');
    setSaveError(null);
  }

  function scheduleAutosave(body: CommercialsBodyInput): void {
    if (!selected || !isDraftEditable(selected.state)) return;
    bodyRef.current = body;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setSaveStatus('saving');
    timerRef.current = window.setTimeout(() => {
      void performSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  async function performSave(): Promise<void> {
    const body = bodyRef.current;
    const expected = expectedUpdatedAtRef.current;
    if (!body || !expected || !selected) return;
    const target = selected.id;
    try {
      const result = await updateDraftCommercials(target, { expectedUpdatedAt: expected, body });
      if (result.stale) {
        setSaveStatus('stale');
        setSaveError('Someone else edited this draft; review the server copy below.');
        setSelected(result.stale.serverCopy);
        setVersions((prev) => prev.map((v) => (v.id === target ? result.stale!.serverCopy : v)));
        expectedUpdatedAtRef.current = result.stale.actualUpdatedAt;
        return;
      }
      if (result.commercials) {
        const next = result.commercials;
        setSelected(next);
        setVersions((prev) => prev.map((v) => (v.id === target ? next : v)));
        expectedUpdatedAtRef.current = next.updatedAt;
        setSaveStatus('saved');
        setSaveError(null);
      }
    } catch (cause) {
      setSaveStatus('error');
      setSaveError(cause instanceof Error ? cause.message : 'Autosave failed.');
    }
  }

  async function createFirstDraft(): Promise<void> {
    try {
      const created = await createDraftCommercials(dealId, {
        items: [
          {
            serviceName: 'New line item',
            quantity: '1',
            unitPriceMinor: 0n,
            itemDiscountMinor: 0n,
            taxCategory: 'standard',
            taxRateBps: 0,
            sortOrder: 0,
          },
        ],
        documentDiscount: { kind: 'none' },
        currency: deal?.currency ?? 'INR',
        advanceMinor: 0n,
      });
      setVersions((prev) => [created, ...prev]);
      openDraft(created);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Unable to create draft.');
    }
  }

  async function copyFromVersion(source: Commercials): Promise<void> {
    const body = commercialsToBody(source);
    try {
      const created = await createDraftCommercials(dealId, body);
      setVersions((prev) => [created, ...prev]);
      openDraft(created);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Unable to copy draft.');
    }
  }

  async function openVersion(id: string): Promise<void> {
    try {
      const next = await getCommercials(id);
      if (isDraftEditable(next.state)) {
        openDraft(next);
      } else {
        setSelected(next);
        setDraftBody(null);
      }
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Unable to load version.');
    }
  }

  async function performPublish(): Promise<void> {
    if (!selected) return;
    try {
      const next = await publishCommercials(selected.id);
      setSelected(next);
      setVersions((prev) => prev.map((v) => (v.id === next.id ? next : v)));
      setPublishOpen(false);
      // After publish, immediately offer the share link UX.
      try {
        const link = await createShareLink(next.id);
        setShareLink(link);
      } catch {
        // Non-fatal — user can request a link later.
      }
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Publish failed.');
    }
  }

  async function regenerateLink(): Promise<void> {
    if (!selected) return;
    const prior = shareLink;
    try {
      const next = await createShareLink(selected.id);
      setShareLink(next);
      if (prior) {
        try {
          await revokeShareLink(selected.id, prior.tokenId);
        } catch {
          // Non-fatal — the new token works, the old one is still revocable by hand.
        }
      }
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not regenerate link.');
    }
  }

  const editable = selected && isDraftEditable(selected.state);
  const lineTotals = useMemo(
    () => selected?.items.map((i) => i.lineTotalMinor) ?? [],
    [selected],
  );

  if (loadError) {
    return (
      <Page eyebrow="Sales" title="Proposals">
        <p className="text-app-danger">{loadError}</p>
        <Button className="mt-4" kind="secondary" onClick={onBack}>
          Back to deal
        </Button>
      </Page>
    );
  }

  if (!deal) {
    return (
      <Page eyebrow="Sales" title="Proposals">
        <p className="text-sm text-app-muted">Loading…</p>
      </Page>
    );
  }

  return (
    <Page
      eyebrow="Sales"
      title={`Proposal — ${deal.title}`}
      description={`Deal #${deal.dealNumber} · ${deal.contactName ?? '—'}`}
      action={
        <div className="flex flex-wrap gap-2">
          <Button kind="secondary" onClick={onBack}>
            Back to deal
          </Button>
          {versions.length === 0 ? (
            <Button onClick={() => void createFirstDraft()}>Create draft</Button>
          ) : (
            <Button kind="secondary" onClick={() => void copyFromVersion(versions[0]!)}>
              New draft from latest
            </Button>
          )}
          {selected && editable && (
            <Button disabled={!canPublish(selected, deal)} onClick={() => setPublishOpen(true)}>
              Publish version {selected.version}
            </Button>
          )}
        </div>
      }
    >
      {saveError && (
        <p className="mb-4 rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger" role="alert">
          {saveError}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          {versions.length === 0 ? (
            <Card>
              <h2 className="font-display text-xl font-bold">No proposal yet</h2>
              <p className="mt-2 text-sm text-app-muted">
                Create the first draft to start quoting this deal.
              </p>
            </Card>
          ) : (
            <>
              <Card className="mb-4">
                <div className="flex flex-wrap gap-2">
                  {versions.map((v) => {
                    const tone = commercialsStateTone(v.state);
                    const isActive = v.id === selected?.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => void openVersion(v.id)}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                          isActive ? 'border-app-accent' : 'border-app-border hover:border-app-accent'
                        }`}
                      >
                        <span className="font-semibold">v{v.version}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${BADGE_CLASSES[tone]}`}>
                          {COMMERCIALS_STATE_LABELS[v.state]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Card>

              {selected && (
                <Card className="p-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-app-border p-4">
                    <h2 className="font-display text-lg font-bold">
                      {editable ? 'Edit draft' : COMMERCIALS_STATE_LABELS[selected.state]} · v{selected.version}
                    </h2>
                    <SaveIndicator status={saveStatus} />
                  </div>
                  <div className="p-4">
                    <CommercialsTable
                      items={draftBody?.items ?? selected.items.map(itemFromCommercials)}
                      currency={selected.currency}
                      readOnly={!editable}
                      lineTotalsMinor={lineTotals}
                      onChange={(next) => {
                        if (!draftBody) return;
                        const nextBody = { ...draftBody, items: next };
                        setDraftBody(nextBody);
                        scheduleAutosave(nextBody);
                      }}
                    />
                    <div className="mt-6 grid gap-4 md:grid-cols-3">
                      <MoneyField
                        label={`Advance expected (${currencySymbol(selected.currency)})`}
                        valuePaise={draftBody?.advanceMinor ?? selected.advanceMinor}
                        disabled={!editable}
                        onCommit={(paise) => {
                          if (!draftBody) return;
                          const nextBody = { ...draftBody, advanceMinor: paise };
                          setDraftBody(nextBody);
                          scheduleAutosave(nextBody);
                        }}
                      />
                      <DocumentDiscountField
                        value={draftBody?.documentDiscount ?? { kind: 'none' }}
                        disabled={!editable}
                        onChange={(docDiscount) => {
                          if (!draftBody) return;
                          const nextBody = { ...draftBody, documentDiscount: docDiscount };
                          setDraftBody(nextBody);
                          scheduleAutosave(nextBody);
                        }}
                      />
                      <label className="text-xs font-semibold text-app-muted">
                        <span className="mb-2 block">Valid until</span>
                        <input
                          type="date"
                          disabled={!editable}
                          value={draftBody?.validityAt?.slice(0, 10) ?? ''}
                          onChange={(event) => {
                            if (!draftBody) return;
                            const nextBody: CommercialsBodyInput = {
                              ...draftBody,
                              validityAt: event.target.value
                                ? new Date(event.target.value).toISOString()
                                : null,
                            };
                            setDraftBody(nextBody);
                            scheduleAutosave(nextBody);
                          }}
                          className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"
                        />
                      </label>
                    </div>
                    <div className="mt-6 grid gap-4">
                      <TextArea
                        label="Scope"
                        value={draftBody?.scope ?? ''}
                        disabled={!editable}
                        onChange={(scope) => {
                          if (!draftBody) return;
                          const nextBody = { ...draftBody, scope };
                          setDraftBody(nextBody);
                          scheduleAutosave(nextBody);
                        }}
                      />
                      <TextArea
                        label="Exclusions"
                        value={draftBody?.exclusions ?? ''}
                        disabled={!editable}
                        onChange={(exclusions) => {
                          if (!draftBody) return;
                          const nextBody = { ...draftBody, exclusions };
                          setDraftBody(nextBody);
                          scheduleAutosave(nextBody);
                        }}
                      />
                      <TextArea
                        label="Timeline"
                        value={draftBody?.timeline ?? ''}
                        disabled={!editable}
                        onChange={(timeline) => {
                          if (!draftBody) return;
                          const nextBody = { ...draftBody, timeline };
                          setDraftBody(nextBody);
                          scheduleAutosave(nextBody);
                        }}
                      />
                      <TextArea
                        label="Terms"
                        value={draftBody?.terms ?? ''}
                        disabled={!editable}
                        onChange={(terms) => {
                          if (!draftBody) return;
                          const nextBody = { ...draftBody, terms };
                          setDraftBody(nextBody);
                          scheduleAutosave(nextBody);
                        }}
                      />
                    </div>
                  </div>
                </Card>
              )}
            </>
          )}
        </div>

        <div className="space-y-4">
          {selected && <ProposalPreview commercials={selected} />}
          {shareLink && selected && (
            <ShareLinkCard
              link={shareLink}
              onRegenerate={() => void regenerateLink()}
            />
          )}
        </div>
      </div>

      {publishOpen && selected && (
        <Modal title={`Publish version ${selected.version}`} onClose={() => setPublishOpen(false)}>
          <p className="text-sm text-app-muted">
            Publishing freezes this version — items, totals, and terms become read-only.
            A share link will be generated so the recipient can accept.
          </p>
          <div className="mt-4">
            <ProposalPreview commercials={selected} />
          </div>
          <div className="mt-5 flex justify-end gap-3">
            <Button kind="secondary" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void performPublish()}>Publish</Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}

function SaveIndicator({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' | 'stale' }): React.JSX.Element {
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
    status === 'saved' ? 'text-emerald-600' : status === 'error' || status === 'stale' ? 'text-app-danger' : 'text-app-muted';
  if (!label) return <span />;
  return <span className={`text-xs font-semibold ${tone}`}>{label}</span>;
}

function MoneyField({
  label,
  valuePaise,
  disabled,
  onCommit,
}: {
  label: string;
  valuePaise: bigint;
  disabled: boolean;
  onCommit: (paise: bigint) => void;
}): React.JSX.Element {
  const current = paiseToRupees(valuePaise);
  return (
    <label className="text-xs font-semibold text-app-muted">
      <span className="mb-2 block">{label}</span>
      <input
        disabled={disabled}
        defaultValue={current}
        onBlur={(event) => {
          const parsed = rupeesToPaise(event.target.value);
          if (parsed !== null) onCommit(parsed);
          else event.target.value = current;
        }}
        className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"
      />
    </label>
  );
}

function DocumentDiscountField({
  value,
  disabled,
  onChange,
}: {
  value: DocumentDiscountInput;
  disabled: boolean;
  onChange: (next: DocumentDiscountInput) => void;
}): React.JSX.Element {
  const kind = value.kind;
  return (
    <div className="text-xs font-semibold text-app-muted">
      <span className="mb-2 block">Document discount</span>
      <div className="flex gap-2">
        <Select
          label=""
          value={kind}
          onChange={(nextKind) => {
            if (nextKind === 'none') onChange({ kind: 'none' });
            else if (nextKind === 'absolute') onChange({ kind: 'absolute', amountMinor: 0n });
            else onChange({ kind: 'percent', bps: 0 });
          }}
          disabled={disabled}
          options={[
            { value: 'none', label: 'None' },
            { value: 'absolute', label: 'Fixed amount' },
            { value: 'percent', label: 'Percent' },
          ]}
        />
        {kind === 'absolute' && (
          <input
            disabled={disabled}
            defaultValue={paiseToRupees(value.amountMinor)}
            onBlur={(event) => {
              const parsed = rupeesToPaise(event.target.value);
              if (parsed !== null) onChange({ kind: 'absolute', amountMinor: parsed });
            }}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"
            aria-label="Discount amount"
          />
        )}
        {kind === 'percent' && (
          <input
            disabled={disabled}
            defaultValue={(value.bps / 100).toString()}
            onBlur={(event) => {
              const bps = percentToBps(event.target.value);
              if (bps !== null) onChange({ kind: 'percent', bps });
            }}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"
            aria-label="Discount percent"
          />
        )}
      </div>
    </div>
  );
}

function TextArea({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <label className="text-xs font-semibold text-app-muted">
      <span className="mb-2 block">{label}</span>
      <textarea
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[80px] w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground"
      />
    </label>
  );
}

function ShareLinkCard({
  link,
  onRegenerate,
}: {
  link: ShareLinkResponse;
  onRegenerate: () => void;
}): React.JSX.Element {
  const url = portalUrl(link.portalPath);
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard denial is non-fatal; the URL is visible.
    }
  }
  return (
    <Card>
      <h3 className="font-display text-lg font-bold">Share link</h3>
      <p className="mt-2 text-xs text-app-muted">
        Valid until {new Date(link.expiresAt).toLocaleString()}
      </p>
      <div className="mt-3 rounded-lg border border-app-border bg-app-background p-2 text-xs break-all">
        {url}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button kind="secondary" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <Button kind="danger" onClick={onRegenerate}>
          Regenerate
        </Button>
      </div>
      <p className="mt-3 text-xs text-app-muted">
        Regenerating revokes the previous token.
      </p>
    </Card>
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
      <div className="w-full max-w-xl rounded-xl bg-app-background p-6 shadow-xl">
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

function canPublish(c: Commercials, deal: Deal): boolean {
  if (!isDraftEditable(c.state)) return false;
  if (c.items.length === 0) return false;
  if (deal.approvalStatus === 'pending' || deal.approvalStatus === 'rejected') return false;
  if (deal.lifecycleStatus !== 'open') return false;
  return true;
}

function itemFromCommercials(item: {
  serviceName: string;
  description: string | null;
  quantity: string;
  unitPriceMinor: bigint;
  itemDiscountMinor: bigint;
  taxCategory: string;
  taxRateBps: number;
  milestone: string | null;
  sortOrder: number;
}): CommercialsItemInput {
  const result: CommercialsItemInput = {
    serviceName: item.serviceName,
    quantity: item.quantity,
    unitPriceMinor: item.unitPriceMinor,
    itemDiscountMinor: item.itemDiscountMinor,
    taxCategory: item.taxCategory,
    taxRateBps: item.taxRateBps,
    sortOrder: item.sortOrder,
    ...(item.description ? { description: item.description } : {}),
    ...(item.milestone ? { milestone: item.milestone } : {}),
  };
  return result;
}

function commercialsToBody(c: Commercials): CommercialsBodyInput {
  const body: CommercialsBodyInput = {
    items: c.items.map(itemFromCommercials),
    documentDiscount: { kind: 'none' },
    currency: c.currency,
    advanceMinor: c.advanceMinor,
    ...(c.validityAt ? { validityAt: c.validityAt } : {}),
    ...(c.scope ? { scope: c.scope } : {}),
    ...(c.exclusions ? { exclusions: c.exclusions } : {}),
    ...(c.timeline ? { timeline: c.timeline } : {}),
    ...(c.terms ? { terms: c.terms } : {}),
  };
  return body;
}
