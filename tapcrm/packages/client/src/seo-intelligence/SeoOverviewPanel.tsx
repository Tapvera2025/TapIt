import { useState } from 'react';
import { getSeoRuleCopy } from '@tapcrm/contracts';
import { Button } from '../ui/index.js';
import { Icon } from '../ui/index.js';
import { downloadSeoReport } from './api.js';
import { FindingsTrendChart } from './FindingsTrendChart.js';
import { SeoDashboardStatusRow } from './SeoDashboardStatusRow.js';
import {
  SeoBadge,
  SeoMetricCard,
  SeoHorizontalBar,
  SeoHint,
  SEVERITY_LABELS,
} from './SeoUi.js';
import { SeoProgressRing, SeoWebsiteIllustration } from './SeoVisuals.js';
import { isScanInFlight, STATUS_LABEL } from './seo-display.js';
import type { SeoSection } from './seo-navigation.js';
import type {
  SeoSite,
  SeoScanRun,
  SeoFindingGroup,
  SeoFindingsTrendPoint,
  SeoSeverity,
} from './types.js';

export function SeoOverviewPanel({
  site,
  scans,
  groups,
  totals,
  onNavigate,
  onScan,
  canManage,
  scanning,
}: {
  site: SeoSite;
  scans: SeoScanRun[];
  groups: SeoFindingGroup[];
  totals: SeoFindingsTrendPoint[];
  onNavigate: (section: SeoSection) => void;
  onScan: () => void;
  canManage: boolean;
  scanning: boolean;
}) {
  const [downloadState, setDownloadState] = useState('');
  const [downloading, setDownloading] = useState(false);
  const scan = scans[0];
  const running = !!scan && isScanInFlight(scan.status);
  const count = (severity: SeoSeverity) =>
    totals.find((point) => point.severity === severity)?.openCount ?? 0;
  const total = totals.reduce((sum, point) => sum + point.openCount, 0);
  const urgent = count('critical') + count('high');
  const checked = scan?.fetchedCount ?? 0;
  const discovered = scan
    ? Math.max(scan.discoveredCount, checked + scan.skippedCount + scan.failedCount)
    : 0;
  const hasResults = checked > 0;
  const heading = !scan
    ? 'Every improvement starts with a checkup.'
    : running
      ? 'Your website checkup is in progress.'
      : !hasResults
        ? 'Your website checkup needs another try.'
        : urgent > 0
          ? 'A few things need your attention.'
          : total > 0
            ? 'Let’s make your website easier to find.'
            : 'Your checked pages have no unresolved findings.';
  const detail = !scan
    ? 'We’ll check your pages for search visibility, broken links, content, and other common SEO issues. You’ll get a clear list of what to review next.'
    : running
      ? 'We’re visiting pages and checking for issues. Results update automatically as your checkup progresses.'
      : !hasResults
        ? 'The last checkup did not return enough page data to assess your website. Review the checkup history for the reason and try again.'
        : urgent > 0
          ? `Start with the ${urgent.toLocaleString()} urgent or high-priority findings below. Review the evidence before deciding what needs changing.`
          : total > 0
            ? 'Review the suggestions below, improve what matters to your visitors, and run another checkup to see what changed.'
            : 'This covers the pages we could inspect. Search visibility also depends on content, competition, and pages outside this checkup.';
  async function download() {
    setDownloading(true);
    setDownloadState('');
    try {
      const blob = await downloadSeoReport(site.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `website-checkup-${site.normalizedHost.replace(/[^a-z0-9.-]/gi, '-')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadState(
        error instanceof Error ? error.message : 'Your report could not be downloaded.',
      );
    } finally {
      setDownloading(false);
    }
  }
  return (
    <div className="seo-panel">
      <section className="seo-hero seo-surface">
        <div className="seo-hero-copy">
          <p className="seo-eyebrow">Your website, at a glance</p>
          <h2>{heading}</h2>
          <p>{detail}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {canManage && (
              <Button onClick={onScan} disabled={scanning || running}>
                <Icon name="refresh" className="mr-2 size-4" />
                {scanning
                  ? 'Starting checkup…'
                  : running
                    ? 'Checkup running…'
                    : scan
                      ? 'Run a new checkup'
                      : 'Check my website'}
              </Button>
            )}
            {hasResults && (
              <button
                type="button"
                className="seo-button-link"
                onClick={() => onNavigate('audit')}
              >
                Review website issues <Icon name="arrow" className="size-4" />
              </button>
            )}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <SeoBadge
              tone={running ? 'info' : scan?.status === 'failed' ? 'danger' : 'neutral'}
            >
              {scan
                ? `${running ? (STATUS_LABEL[scan.status] ?? 'Checking') : scan.status === 'completed' ? 'Checkup complete' : scan.status === 'completed_partial' ? 'Partially checked' : 'Checkup incomplete'} · ${new Date(scan.endedAt ?? scan.queuedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                : 'No checkup yet'}
            </SeoBadge>
            <SeoBadge>{site.normalizedHost}</SeoBadge>
          </div>
        </div>
        <SeoWebsiteIllustration className="seo-hero-art" />
      </section>
      {scan?.terminationReason && (
        <SeoHint tone="warning" title="A note about your last checkup">
          {scan.terminationReason}
        </SeoHint>
      )}
      <div className="seo-metric-grid">
        <SeoMetricCard
          icon="alert-circle"
          label="Items needing review"
          value={hasResults ? total.toLocaleString() : '—'}
          detail={
            hasResults
              ? 'Estimated unresolved findings across your website'
              : 'Available after pages have been checked'
          }
          tone={total ? 'warning' : 'neutral'}
          onClick={() => onNavigate('audit')}
        />
        <SeoMetricCard
          icon="flag"
          label="Start with these"
          value={hasResults ? urgent.toLocaleString() : '—'}
          detail="Urgent and high-priority findings"
          tone="danger"
          onClick={() => onNavigate('audit')}
        />
        <SeoMetricCard
          icon="file-text"
          label="Pages checked"
          value={scan ? checked.toLocaleString() : '—'}
          detail={
            scan
              ? `${discovered.toLocaleString()} URLs discovered in the last checkup`
              : 'Run a checkup to understand your coverage'
          }
          tone="accent"
          onClick={() => onNavigate('scans')}
        />
        <SeoMetricCard
          icon="layers"
          label="Types of open issues"
          value={hasResults ? groups.length : '—'}
          detail="Similar findings are grouped so you can fix the cause"
          tone="info"
          onClick={() => onNavigate('audit')}
        />
      </div>
      <div className="seo-overview-grid">
        <div className="seo-overview-main">
          <section className="seo-surface p-5 sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h3 className="seo-subtitle">Where should you start?</h3>
                <p className="seo-small-copy mt-1">
                  A short list to help you move from finding to fix.
                </p>
              </div>
              <span className="grid size-9 place-items-center rounded-xl bg-app-accent/10 text-app-accent">
                <Icon name="todo" className="size-5" />
              </span>
            </div>
            {groups.length > 0 ? (
              <div>
                {groups.slice(0, 3).map((group, index) => (
                  <button
                    key={`${group.ruleId}:${group.severity}`}
                    type="button"
                    className="seo-quick-action"
                    onClick={() => onNavigate('audit')}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-app-surface-raised text-xs text-app-muted">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong>{getSeoRuleCopy(group.ruleId).title}</strong>
                      <small>
                        {group.count} affected {group.count === 1 ? 'page' : 'pages'} ·{' '}
                        {SEVERITY_LABELS[group.severity]}
                      </small>
                    </span>
                    <Icon
                      name="chevron-right"
                      className="size-4 shrink-0 text-app-muted"
                    />
                  </button>
                ))}
              </div>
            ) : (
              <p className="seo-small-copy rounded-xl bg-app-surface-raised p-4">
                {!hasResults
                  ? 'Run a checkup first. Your most important next steps will appear here.'
                  : 'No unreviewed issue groups. Check the full findings list and your search visibility before deciding on the next improvement.'}
              </p>
            )}
            <div className="mt-5 flex flex-wrap gap-4">
              <button
                type="button"
                className="seo-button-link"
                onClick={() => onNavigate('audit')}
              >
                View all issues <Icon name="arrow" className="size-4" />
              </button>
              <button
                type="button"
                className="text-xs text-app-muted underline decoration-app-border underline-offset-4"
                onClick={() => onNavigate('fix-studio')}
              >
                See recommended fixes
              </button>
            </div>
          </section>
          {hasResults ? (
            <FindingsTrendChart
              key={site.id}
              siteId={site.id}
              refreshKey={`${scan?.id ?? ''}:${scan?.status ?? ''}`}
            />
          ) : (
            <SeoHint title="Your progress chart starts with a checkup" icon="chart">
              Once pages have been checked, you can follow estimated unresolved findings
              here over time. No saved page results means your website has not yet been
              assessed.
            </SeoHint>
          )}
        </div>
        <div className="seo-overview-side">
          <section className="seo-surface p-5 sm:p-6">
            <h3 className="seo-subtitle">What needs attention?</h3>
            <p className="seo-small-copy mt-1 mb-5">
              Estimated unresolved findings, by importance.
            </p>
            {hasResults ? (
              <div className="space-y-4">
                {(
                  [
                    'critical',
                    'high',
                    'moderate',
                    'low',
                    'informational',
                  ] as SeoSeverity[]
                ).map((severity) => (
                  <SeoHorizontalBar
                    key={severity}
                    value={count(severity)}
                    max={total}
                    label={SEVERITY_LABELS[severity]}
                    tone={
                      severity === 'critical'
                        ? 'danger'
                        : severity === 'high' || severity === 'moderate'
                          ? 'warning'
                          : severity === 'low'
                            ? 'info'
                            : 'neutral'
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="seo-small-copy rounded-xl bg-app-surface-raised p-4">
                Your issue breakdown will appear when pages have been checked. We cannot
                assess website health without page results.
              </p>
            )}
            <p className="seo-small-copy mt-5">
              An informational notice can be a data gap, rather than a website problem.
            </p>
          </section>
          <section className="seo-surface p-5 sm:p-6">
            <h3 className="seo-subtitle">How much did we check?</h3>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-4">
              <SeoProgressRing value={checked} total={discovered} label="Pages reached" />
              <div className="seo-coverage-legend">
                <span>
                  <strong>{checked}</strong> pages loaded
                </span>
                <span>
                  <strong>{scan?.skippedCount ?? 0}</strong> skipped
                </span>
                <span>
                  <strong>{scan?.failedCount ?? 0}</strong> could not load
                </span>
              </div>
            </div>
            <p className="seo-small-copy mt-5">
              This is checkup coverage, not an SEO score. Pages that could not be loaded
              have not been fully assessed.
            </p>
            <button
              className="seo-button-link mt-4"
              type="button"
              onClick={() => onNavigate('scans')}
            >
              See checkup details <Icon name="arrow" className="size-4" />
            </button>
          </section>
        </div>
      </div>
      <SeoDashboardStatusRow siteId={site.id} onNavigate={onNavigate} />
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-app-muted">
        <p>
          Historical counts use first sightings and latest resolutions, so earlier reopen
          cycles may change the estimate.
        </p>
        <button
          type="button"
          disabled={downloading}
          className="seo-button-link"
          onClick={() => {
            void download();
          }}
        >
          {downloading ? 'Preparing report…' : 'Download PDF report'}
          <Icon name="file-text" className="size-4" />
        </button>
      </div>
      {downloadState && (
        <p role="alert" className="text-sm text-app-danger">
          {downloadState}
        </p>
      )}
    </div>
  );
}
