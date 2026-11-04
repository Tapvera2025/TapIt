import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, SkeletonPage } from '../ui/index.js';
import { Icon } from '../ui/index.js';
import { AddSiteModal } from './AddSiteModal.js';
import { SeoOverviewPanel } from './SeoOverviewPanel.js';
import { SeoFindingsPanel } from './SeoAuditPanel.js';
import { SeoRulesPanel } from './SeoRulesPanel.js';
import {
  SeoSearchPanel,
  SeoKeywordsPanel,
  SeoRankPanel,
  SeoAiVisibilityPanel,
  SeoBacklinksPanel,
  SeoCwvPanel,
  SeoFixStudioPanel,
  SeoMonitoringPanel,
  SeoScansPanel,
} from './SeoDetailPanels.js';
import { SeoEmptyState, SeoSectionHeader, SeoBadge } from './SeoUi.js';
import {
  SEO_TABS,
  seoTabForSection,
  moveTabIndex,
  type SeoSection,
} from './seo-navigation.js';
import { useSeoResource } from './useSeoResource.js';
import { isScanInFlight } from './seo-display.js';
import * as api from './api.js';
import type {
  SeoSite,
  SeoScanRun,
  SeoFindingGroup,
  SeoFindingsTrendPoint,
  SeoGscMetrics,
  SeoKeyword,
  SeoSerpObservation,
  SeoAiObservation,
  SeoBacklink,
  SeoCwvObservation,
  SeoFixProposal,
  SeoAlert,
  SeoRuleRow,
} from './types.js';
import './seo-workspace.css';
import { SeoContentPanel, type ContentAccess } from './SeoContentPanel.js';

interface DetailData {
  scans?: SeoScanRun[];
  groups?: SeoFindingGroup[];
  totals?: SeoFindingsTrendPoint[];
  findings?: api.SeoFindingPage;
  metrics?: SeoGscMetrics[];
  keywords?: SeoKeyword[];
  observations?: SeoSerpObservation[];
  rankStatus?: api.SeoRankStatus;
  ai?: SeoAiObservation[];
  backlinks?: SeoBacklink[];
  performance?: SeoCwvObservation[];
  performanceStatus?: api.SeoPerformanceStatus[];
  fixes?: SeoFixProposal[];
  alerts?: SeoAlert[];
  rules?: SeoRuleRow[];
}
interface Props {
  pathname: string;
  onNavigate: (path: string) => void;
  canManage: boolean;
  contentAccess: ContentAccess;
}

export function SeoWorkspace({ canManage, contentAccess }: Props) {
  const [section, setSection] = useState<SeoSection>('overview');
  const [siteId, setSiteId] = useState<string | null>(null);
  const currentSiteId = useRef(siteId);
  currentSiteId.current = siteId;
  const [showAddSite, setShowAddSite] = useState(false);
  const [newSite, setNewSite] = useState<SeoSite | null>(null);
  const [findingFilter, setFindingFilter] = useState<{
    status?: string;
    severity?: string;
  }>({});
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [contentDirty, setContentDirty] = useState(false);
  const [contentSeed, setContentSeed] = useState<{ query: string } | null>(null);
  const setContentDirtyStable = useCallback(
    (dirty: boolean) => setContentDirty(dirty),
    [],
  );
  const siteResource = useSeoResource('seo-sites', api.listSeoSites);
  const loadedSites = siteResource.data ?? [];
  const sites =
    newSite && !loadedSites.some((site) => site.id === newSite.id)
      ? [...loadedSites, newSite]
      : loadedSites;
  const selectedSite = sites.find((site) => site.id === siteId) ?? sites[0] ?? null;
  const selectedId = selectedSite?.id ?? null;
  useEffect(() => {
    if (selectedId !== siteId) setSiteId(selectedId);
  }, [selectedId, siteId]);
  const activeTab = seoTabForSection(section);
  const detailKey =
    section === 'sites' || section === 'content-board' || section === 'content-brand'
      ? null
      : section === 'rules'
        ? 'seo-rules'
        : selectedId
          ? `${selectedId}:${section}`
          : null;
  const detail = useSeoResource<DetailData>(
    detailKey,
    async () => {
      if (section === 'rules') return { rules: await api.listSeoRules() };
      if (section === 'content-board' || section === 'content-brand') return {};
      if (!selectedId) return {};
      switch (section) {
        case 'overview': {
          const [scans, groups, totals] = await Promise.all([
            api.listSeoScans(selectedId),
            api.listSeoFindingGroups(selectedId),
            api.getSeoFindingsTrend(selectedId, 1),
          ]);
          return { scans, groups, totals };
        }
        case 'audit':
          return {};
        case 'scans':
          return { scans: await api.listSeoScans(selectedId) };
        case 'search-performance': {
          const range = gscDateRange(28);
          return {
            metrics: await api.listGscMetrics(selectedId, range.start, range.end, 500),
          };
        }
        case 'keywords':
          return { keywords: await api.listSeoKeywords(selectedId) };
        case 'rank-tracking': {
          const [observations, rankStatus] = await Promise.all([
            api.listSeoSerpObservations(selectedId),
            api.getSeoRankStatus(selectedId),
          ]);
          return { observations, rankStatus };
        }
        case 'ai-visibility':
          return { ai: await api.listSeoAiObservations(selectedId) };
        case 'backlinks':
          return { backlinks: await api.listSeoBacklinks(selectedId) };
        case 'performance': {
          const [performance, performanceStatus] = await Promise.all([
            api.listSeoCwvObservations(selectedId),
            api.getSeoPerformanceStatus(selectedId),
          ]);
          return { performance, performanceStatus };
        }
        case 'fix-studio':
          return { fixes: await api.listSeoFixProposals(selectedId) };
        case 'monitoring':
          return { alerts: await api.listSeoAlerts(selectedId) };
        case 'sites':
          return {};
      }
    },
    ['overview', 'scans', 'audit', 'rank-tracking', 'performance'].includes(section)
      ? 5000
      : 0,
  );
  const data = detail.data;
  const latestScan = data?.scans?.[0];
  function navigate(next: SeoSection) {
    if (
      contentDirty &&
      next !== section &&
      !window.confirm('Your changes are not fully saved yet. Leave the Content tab?')
    )
      return;
    setSection(next);
    setNotice('');
    setActionError('');
  }
  function changeSite(id: string) {
    if (
      contentDirty &&
      !window.confirm('Your changes are not fully saved yet. Switch websites?')
    )
      return;
    setSiteId(id);
    setNotice('');
    setActionError('');
    setFindingFilter({});
    setOffset(0);
  }
  async function mutate(
    name: string,
    action: () => Promise<unknown>,
    message: string,
    next?: SeoSection,
  ) {
    if (busy) return;
    const requestedSite = selectedId;
    setBusy(name);
    setNotice('');
    setActionError('');
    try {
      await action();
      if (currentSiteId.current === requestedSite) {
        if (next) setSection(next);
        detail.reload();
        setNotice(message);
      }
    } catch (error) {
      if (currentSiteId.current === requestedSite)
        setActionError(
          error instanceof Error
            ? error.message
            : 'The update could not be saved. Please try again.',
        );
    } finally {
      setBusy('');
    }
  }
  function triggerScan() {
    if (selectedId)
      void mutate(
        'scan',
        () => api.triggerSeoScan(selectedId),
        'Checkup started. Progress and results update automatically.',
        'scans',
      );
  }
  function syncGoogle() {
    if (selectedSite)
      void mutate(
        'sync',
        async () => {
          const range = gscDateRange(90);
          const result = await api.syncGscData(
            selectedSite.id,
            selectedSite.displayUrl,
            range.start,
            range.end,
          );
          if (result.state !== 'ok')
            throw new Error(
              result.message ??
                'Google data could not be imported. Ask your administrator to check access.',
            );
        },
        'Google search data imported. The view shows the latest complete reporting period.',
      );
  }
  function keyboardTabs(
    event: KeyboardEvent<HTMLButtonElement>,
    items: readonly { id: string }[],
    index: number,
    select: (index: number) => void,
  ) {
    const next = moveTabIndex(index, event.key, items.length);
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    select(next);
    const list = event.currentTarget.parentElement;
    const button = list?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
    button?.focus();
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  if (siteResource.loading && !siteResource.data) return <SkeletonPage />;
  return (
    <div className="seo-workspace">
      <header className="seo-topbar">
        <div>
          <p className="seo-eyebrow">Understand. Improve. Grow.</p>
          <h1>Website SEO</h1>
          <p>Know what’s holding your website back, and what to do next.</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {sites.length > 0 && (
            <div className="seo-site-selector">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-app-accent">
                <Icon name="monitor" className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <label htmlFor="seo-website">You’re viewing</label>
                <select
                  id="seo-website"
                  value={selectedId ?? ''}
                  onChange={(event) => changeSite(event.target.value)}
                  className="bg-transparent"
                >
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.normalizedHost || site.displayUrl}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {canManage && (
            <button
              className="btn-secondary inline-flex items-center gap-2"
              type="button"
              onClick={() => setShowAddSite(true)}
            >
              <Icon name="plus" className="size-4" />
              Add website
            </button>
          )}
        </div>
      </header>
      <div className="seo-primary-tabs" role="tablist" aria-label="SEO areas">
        {SEO_TABS.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            id={`seo-tab-${tab.id}`}
            className="seo-primary-tab"
            role="tab"
            aria-selected={activeTab.id === tab.id}
            tabIndex={activeTab.id === tab.id ? 0 : -1}
            aria-controls="seo-main-panel"
            data-active={activeTab.id === tab.id}
            onClick={() => navigate(tab.sections[0].id)}
            onKeyDown={(event) =>
              keyboardTabs(event, SEO_TABS, index, (next) =>
                navigate(SEO_TABS[next]!.sections[0].id),
              )
            }
          >
            <Icon name={tab.icon} className="size-4" />
            {tab.label}
          </button>
        ))}
      </div>
      <p className="seo-tab-scroll-hint" aria-hidden="true">
        Swipe the tabs to explore all areas <Icon name="arrow" className="size-3" />
      </p>
      {activeTab.sections.length > 1 && (
        <div
          className="seo-secondary-tabs"
          role="tablist"
          aria-label={`${activeTab.label} tools`}
        >
          {activeTab.sections.map((item, index) => (
            <button
              type="button"
              key={item.id}
              id={`seo-tool-${item.id}`}
              className="seo-secondary-tab"
              role="tab"
              aria-selected={section === item.id}
              tabIndex={section === item.id ? 0 : -1}
              aria-controls="seo-main-panel"
              data-active={section === item.id}
              onClick={() => navigate(item.id)}
              onKeyDown={(event) =>
                keyboardTabs(event, activeTab.sections, index, (next) =>
                  navigate(activeTab.sections[next]!.id),
                )
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="mb-5 rounded-xl border border-app-accent/20 bg-app-accent/5 p-4 text-sm"
        >
          {notice}
        </p>
      )}
      {actionError && (
        <p
          role="alert"
          className="mb-5 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-app-danger"
        >
          {actionError}
        </p>
      )}
      {['finding', 'fix', 'alert'].includes(busy) && (
        <p role="status" className="seo-small-copy mb-4">
          Saving your update…
        </p>
      )}
      <div
        role="tabpanel"
        id="seo-main-panel"
        aria-labelledby={
          activeTab.sections.length > 1
            ? `seo-tool-${section}`
            : `seo-tab-${activeTab.id}`
        }
        tabIndex={0}
      >
        {siteResource.error ? (
          <LoadFailure message={siteResource.error} retry={siteResource.reload} />
        ) : !selectedSite && section !== 'rules' && section !== 'sites' ? (
          <SeoEmptyState
            title="Let’s get to know your website"
            description="Add your website to start a checkup. We’ll turn technical findings into an understandable list of things to review and improve."
            action={
              canManage ? (
                <Button onClick={() => setShowAddSite(true)}>
                  Add your first website
                </Button>
              ) : undefined
            }
          />
        ) : section === 'content-board' || section === 'content-brand' ? (
          selectedSite ? (
            <SeoContentPanel
              key={`${selectedSite.id}:${section}`}
              siteId={selectedSite.id}
              access={contentAccess}
              initialView={section === 'content-brand' ? 'brand' : 'board'}
              onDirtyChange={setContentDirtyStable}
              seed={contentSeed}
              onSeedConsumed={() => setContentSeed(null)}
            />
          ) : (
            <SeoEmptyState
              title="Choose a website first"
              description="Select a website to open its content workspace."
            />
          )
        ) : section === 'sites' ? (
          <SeoSitesPanel
            sites={sites}
            selectedSite={selectedSite}
            canManage={canManage}
            onAdd={() => setShowAddSite(true)}
            onSelect={(site) => {
              changeSite(site.id);
              navigate('overview');
            }}
          />
        ) : detail.error ? (
          <LoadFailure message={detail.error} retry={detail.reload} />
        ) : !data ? (
          <div role="status" aria-label="Loading website information">
            <SkeletonPage />
          </div>
        ) : (
          <>
            {section === 'overview' && selectedSite && (
              <SeoOverviewPanel
                key={selectedSite.id}
                site={selectedSite}
                scans={data.scans ?? []}
                groups={data.groups ?? []}
                totals={data.totals ?? []}
                onNavigate={navigate}
                onScan={triggerScan}
                scanning={busy === 'scan'}
                canManage={canManage}
              />
            )}
            {section === 'audit' && (
              <SeoFindingsPanel
                key={selectedId}
                siteId={selectedId}
                filter={findingFilter}
                onFilterChange={(value) => {
                  setFindingFilter(value);
                  setOffset(0);
                }}
                onDismiss={(id) =>
                  mutate(
                    'finding',
                    () => api.updateSeoFinding(id, { status: 'dismissed' }),
                    'Finding marked as not applicable. This does not change your website.',
                  )
                }
                canManage={canManage}
                offset={offset}
                onPage={setOffset}
                onFixes={() => navigate('fix-studio')}
              />
            )}
            {section === 'search-performance' && (
              <SeoSearchPanel
                metrics={data.metrics ?? []}
                site={selectedSite}
                canManage={canManage}
                onSync={syncGoogle}
                syncing={busy === 'sync'}
                error=""
                notice=""
                loading={false}
                {...(contentAccess.create
                  ? {
                      onCreateBrief: (query: string) => {
                        if (
                          contentDirty &&
                          !window.confirm(
                            'Your changes are not fully saved yet. Leave the Content tab?',
                          )
                        )
                          return;
                        setContentSeed({ query });
                        setSection('content-board');
                        setNotice('');
                        setActionError('');
                      },
                    }
                  : {})}
              />
            )}
            {section === 'keywords' && (
              <SeoKeywordsPanel keywords={data.keywords ?? []} />
            )}
            {section === 'rank-tracking' && (
              <SeoRankPanel
                observations={data.observations ?? []}
                status={data.rankStatus ?? null}
                error=""
                notice=""
                checking={busy === 'ranks'}
                canManage={canManage}
                onCheck={() => {
                  if (selectedId)
                    void mutate(
                      'ranks',
                      () => api.checkSeoRanks(selectedId),
                      'Position checks queued. Saved observations update automatically.',
                    );
                }}
              />
            )}
            {section === 'ai-visibility' && (
              <SeoAiVisibilityPanel observations={data.ai ?? []} />
            )}
            {section === 'backlinks' && (
              <SeoBacklinksPanel backlinks={data.backlinks ?? []} />
            )}
            {section === 'performance' && (
              <SeoCwvPanel
                observations={data.performance ?? []}
                statuses={data.performanceStatus ?? []}
                error=""
                refreshing={busy === 'performance'}
                canManage={canManage}
                onRefresh={() => {
                  if (selectedId)
                    void mutate(
                      'performance',
                      () => api.refreshSeoPerformance(selectedId),
                      'Speed tests queued. Results update automatically.',
                    );
                }}
              />
            )}
            {section === 'fix-studio' && (
              <SeoFixStudioPanel
                fixes={data.fixes ?? []}
                canManage={canManage}
                onApply={(id) => {
                  void mutate(
                    'fix',
                    () => api.updateSeoFixProposal(id, { status: 'executed' }),
                    'Marked as done. Run another checkup to verify the change.',
                  );
                }}
              />
            )}
            {section === 'monitoring' && (
              <SeoMonitoringPanel
                alerts={data.alerts ?? []}
                canManage={canManage}
                onAcknowledge={(id) => {
                  void mutate(
                    'alert',
                    () => api.acknowledgeSeoAlert(id),
                    'Notification marked as reviewed.',
                  );
                }}
              />
            )}
            {section === 'scans' && (
              <SeoScansPanel
                scans={data.scans ?? []}
                onTrigger={triggerScan}
                scanning={
                  busy === 'scan' || (!!latestScan && isScanInFlight(latestScan.status))
                }
                canManage={canManage}
              />
            )}
            {section === 'rules' && (
              <SeoRulesPanel
                rules={data.rules ?? []}
                canManage={canManage}
                loadError=""
                onToggle={async (id, active) => {
                  await api.updateSeoRule(id, { active });
                  detail.reload();
                }}
              />
            )}
          </>
        )}
      </div>
      {showAddSite && (
        <AddSiteModal
          onClose={() => setShowAddSite(false)}
          onCreated={(site) => {
            setNewSite(site);
            setSiteId(site.id);
            siteResource.reload();
            setShowAddSite(false);
            navigate('overview');
          }}
        />
      )}
    </div>
  );
}
function LoadFailure({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div role="alert">
      <SeoEmptyState
        compact
        title="We couldn’t load this information"
        description={message}
        action={
          <Button kind="secondary" onClick={retry}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
function gscDateRange(days: number) {
  const end = new Date(Date.now() - 3 * 86400000);
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
function SeoSitesPanel({
  sites,
  selectedSite,
  onSelect,
  canManage,
  onAdd,
}: {
  sites: SeoSite[];
  selectedSite: SeoSite | null;
  onSelect: (site: SeoSite) => void;
  canManage: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="seo-panel">
      <SeoSectionHeader
        title="Your websites"
        description="Choose a website to see its checkups, issues, and search visibility. Each website has its own results."
        eyebrow="Website settings"
        action={
          canManage ? (
            <Button onClick={onAdd}>
              <Icon name="plus" className="mr-2 size-4" />
              Add website
            </Button>
          ) : undefined
        }
      />
      {sites.length === 0 ? (
        <SeoEmptyState
          title="Add the website you want to improve"
          description="All you need to get started is its web address. You can also link it to an existing CRM client."
          action={canManage ? <Button onClick={onAdd}>Add website</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sites.map((site) => (
            <button
              key={site.id}
              className="seo-surface flex items-center gap-4 p-5 text-left hover:border-app-accent/50"
              type="button"
              onClick={() => onSelect(site)}
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-app-accent/10 text-app-accent">
                <Icon name="monitor" className="size-6" />
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block break-all text-sm">{site.normalizedHost}</strong>
                <span className="mt-1 block text-xs text-app-muted">
                  {site.locale.toUpperCase()} · {site.timezone}
                </span>
                <span className="mt-2 inline-flex flex-wrap gap-2">
                  <SeoBadge tone={site.active ? 'accent' : 'neutral'}>
                    {site.active ? 'Active' : 'Inactive'}
                  </SeoBadge>
                  {selectedSite?.id === site.id && (
                    <SeoBadge tone="info">Currently selected</SeoBadge>
                  )}
                </span>
              </span>
              <Icon name="arrow" className="size-4 shrink-0 text-app-muted" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
