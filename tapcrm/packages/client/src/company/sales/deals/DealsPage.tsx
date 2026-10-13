import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Field, Page, Select } from '../../../ui/components.js';
import { listDeals, type Deal, type DealListQuery } from './api.js';
import {
  APPROVAL_LABELS,
  CONTRACT_LABELS,
  DEAL_STAGES,
  LIFECYCLE_LABELS,
  type OPEN_DEAL_STAGES,
  PAYMENT_LABELS,
  STAGE_LABELS,
  approvalTone,
  contractTone,
  formatCurrencyLabel,
  formatProbability,
  formatRelativeDate,
  groupByStage,
  lifecycleTone,
  monthToRange,
  paymentTone,
  stageTone,
  type BadgeTone,
} from './deals-helpers.js';

type ViewMode = 'list' | 'kanban';

type StageFilter = 'all' | typeof DEAL_STAGES[number];
type LifecycleFilter = 'all' | 'open' | 'won' | 'lost' | 'cancelled';

interface DealsPageProps {
  readonly isSalesHod: boolean;
  readonly onNavigate: (path: string) => void;
}

const BADGE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-app-background text-app-muted',
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  danger: 'bg-[#d86b6b]/15 text-app-danger',
};

export function DealsPage({ isSalesHod, onNavigate }: DealsPageProps): React.JSX.Element {
  const [items, setItems] = useState<readonly Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('list');
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>('open');
  const [search, setSearch] = useState('');
  const [closeMonth, setCloseMonth] = useState('');

  async function reload(): Promise<void> {
    setLoading(true);
    try {
      const range = closeMonth ? monthToRange(closeMonth) : null;
      const query: DealListQuery = {
        pageSize: 100,
        ...(stageFilter !== 'all' ? { stage: stageFilter } : {}),
        ...(lifecycleFilter !== 'all' ? { lifecycleStatus: lifecycleFilter } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(range ? { expectedCloseFrom: range.from, expectedCloseTo: range.to } : {}),
      };
      const page = await listDeals(query);
      setItems(page.items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load deals.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageFilter, lifecycleFilter, closeMonth]);

  const groups = useMemo(() => groupByStage(items), [items]);
  const canKanban = isSalesHod;

  return (
    <Page
      eyebrow="Sales"
      title="Deals"
      description="Pipeline of qualified leads moving toward a signed, paid, delivered close."
      action={
        <div className="flex flex-wrap gap-2">
          {canKanban && (
            <Button
              kind="secondary"
              onClick={() => setView((v) => (v === 'list' ? 'kanban' : 'list'))}
            >
              {view === 'list' ? 'Kanban' : 'List'}
            </Button>
          )}
          <Button kind="secondary" onClick={() => void reload()}>
            Refresh
          </Button>
        </div>
      }
    >
      {error && (
        <p className="mb-4 rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger" role="alert">
          {error}
        </p>
      )}

      <Card className="mb-6">
        <div className="grid gap-4 md:grid-cols-4">
          <Select
            label="Lifecycle"
            value={lifecycleFilter}
            onChange={(value) => setLifecycleFilter(value as LifecycleFilter)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'open', label: 'Open' },
              { value: 'won', label: 'Won' },
              { value: 'lost', label: 'Lost' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
          <Select
            label="Stage"
            value={stageFilter}
            onChange={(value) => setStageFilter(value as StageFilter)}
            options={[
              { value: 'all', label: 'All stages' },
              ...DEAL_STAGES.map((stage) => ({ value: stage, label: STAGE_LABELS[stage] })),
            ]}
          />
          <label className="text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Expected close</span>
            <input
              type="month"
              value={closeMonth}
              onChange={(event) => setCloseMonth(event.target.value)}
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
            />
          </label>
          <Field
            label="Search"
            value={search}
            onChange={setSearch}
            placeholder="Title, contact, company"
          />
        </div>
        <div className="mt-3 flex justify-end">
          <Button kind="secondary" onClick={() => void reload()}>
            Apply search
          </Button>
        </div>
      </Card>

      {loading && items.length === 0 ? (
        <Card>
          <p className="text-sm text-app-muted">Loading deals…</p>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <h2 className="font-display text-xl font-bold">No deals match these filters</h2>
          <p className="mt-2 text-sm text-app-muted">
            Convert a qualified lead from the lead detail page to create a deal.
          </p>
        </Card>
      ) : view === 'kanban' && canKanban ? (
        <KanbanBoard groups={groups} onOpen={(deal) => onNavigate(`/company/sales/deals/${deal.id}`)} />
      ) : (
        <DealList deals={items} onOpen={(deal) => onNavigate(`/company/sales/deals/${deal.id}`)} />
      )}
    </Page>
  );
}

function DealList({
  deals,
  onOpen,
}: {
  deals: readonly Deal[];
  onOpen: (deal: Deal) => void;
}): React.JSX.Element {
  return (
    <Card className="overflow-hidden p-0">
      <div className="divide-y divide-app-border">
        {deals.map((deal) => (
          <button
            key={deal.id}
            className="flex w-full flex-wrap items-center justify-between gap-4 p-5 text-left hover:bg-app-background"
            onClick={() => onOpen(deal)}
          >
            <div className="min-w-0">
              <p className="font-display text-lg font-bold">{deal.title}</p>
              <p className="mt-1 text-sm text-app-muted">
                #{deal.dealNumber} ·{' '}
                {deal.contactName ?? 'No contact'}
                {deal.companyName ? ` · ${deal.companyName}` : ''} ·{' '}
                {deal.responsibleCloserName ?? 'Unassigned'}
              </p>
              <p className="mt-1 text-xs text-app-muted">
                Expected close {formatRelativeDate(deal.expectedCloseAt)} · Probability{' '}
                {formatProbability(deal)} · {formatCurrencyLabel(deal.currency)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={stageTone(deal.dealStage)}>{STAGE_LABELS[deal.dealStage]}</Badge>
              <Badge tone={lifecycleTone(deal.lifecycleStatus)}>
                {LIFECYCLE_LABELS[deal.lifecycleStatus]}
              </Badge>
              {deal.approvalStatus !== 'not_required' && (
                <Badge tone={approvalTone(deal.approvalStatus)}>
                  Approval · {APPROVAL_LABELS[deal.approvalStatus]}
                </Badge>
              )}
              {deal.contractStatus !== 'not_required' && (
                <Badge tone={contractTone(deal.contractStatus)}>
                  Contract · {CONTRACT_LABELS[deal.contractStatus]}
                </Badge>
              )}
              <Badge tone={paymentTone(deal.paymentStatus)}>
                {PAYMENT_LABELS[deal.paymentStatus]}
              </Badge>
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}

function KanbanBoard({
  groups,
  onOpen,
}: {
  groups: ReadonlyArray<{ stage: typeof OPEN_DEAL_STAGES[number]; deals: readonly Deal[] }>;
  onOpen: (deal: Deal) => void;
}): React.JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {groups.map(({ stage, deals }) => (
        <Card key={stage}>
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-bold">{STAGE_LABELS[stage]}</h3>
            <span className="text-xs font-semibold text-app-muted">{deals.length}</span>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            {deals.length === 0 && <p className="text-xs text-app-muted">No open deals.</p>}
            {deals.map((deal) => (
              <button
                key={deal.id}
                onClick={() => onOpen(deal)}
                className="rounded-lg border border-app-border bg-app-background p-3 text-left hover:border-app-accent"
              >
                <p className="font-semibold">{deal.title}</p>
                <p className="mt-1 text-xs text-app-muted">
                  #{deal.dealNumber} · {deal.contactName ?? '—'}
                </p>
                <p className="mt-1 text-xs text-app-muted">
                  {formatCurrencyLabel(deal.currency)} · {formatProbability(deal)} ·{' '}
                  {formatRelativeDate(deal.expectedCloseAt)}
                </p>
              </button>
            ))}
          </div>
        </Card>
      ))}
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
