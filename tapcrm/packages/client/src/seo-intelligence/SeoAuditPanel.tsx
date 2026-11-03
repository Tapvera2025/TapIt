import { useState } from 'react';
import { getSeoRuleCopy } from '@tapcrm/contracts';
import { Button } from '../ui/components.js';
import { Icon } from '../ui/Icon.js';
import { RuleReference } from './RuleExplanation.js';
import { listSeoFindingGroups, listSeoFindings } from './api.js';
import { useSeoResource } from './useSeoResource.js';
import {
  SeoSectionHeader,
  SeoSeverityBadge,
  SeoEmptyState,
  SeoHint,
  SeoBadge,
  SEVERITY_LABELS,
} from './SeoUi.js';
import { getSeoGuidance } from './seo-rule-guidance.js';
import type { SeoFinding } from './types.js';

export function SeoFindingsPanel({
  filter,
  onFilterChange,
  onDismiss,
  canManage,
  siteId,
  offset,
  onPage,
  onFixes,
}: {
  filter: { status?: string; severity?: string };
  onFilterChange: (filter: { status?: string; severity?: string }) => void;
  onDismiss: (id: string) => Promise<void>;
  canManage: boolean;
  siteId: string | null;
  offset: number;
  onPage: (offset: number) => void;
  onFixes: () => void;
}) {
  const [view, setView] = useState<'grouped' | 'pages'>('grouped');
  const [search, setSearch] = useState('');
  const pageResource = useSeoResource(
    view === 'pages' && siteId
      ? `findings:${siteId}:${JSON.stringify(filter)}:${offset}`
      : null,
    () => listSeoFindings(siteId!, { ...filter, limit: 25, offset }),
    5000,
  );
  const findings = pageResource.data?.rows ?? [];
  const total = pageResource.data?.total ?? 0;
  const groupResource = useSeoResource(
    view === 'grouped' && siteId ? `groups:${siteId}` : null,
    () => listSeoFindingGroups(siteId!),
    5000,
  );
  const query = search.trim().toLowerCase();
  const groups = (groupResource.data ?? []).filter(
    (group) =>
      (!filter.severity || group.severity === filter.severity) &&
      `${getSeoRuleCopy(group.ruleId).title} ${group.ruleId} ${group.sampleTargets.join(' ')}`
        .toLowerCase()
        .includes(query),
  );
  const pageRows = findings.filter((finding) =>
    `${getSeoRuleCopy(finding.ruleId).title} ${finding.ruleId} ${finding.affectedTarget}`
      .toLowerCase()
      .includes(query),
  );
  return (
    <div className="seo-panel">
      <SeoSectionHeader
        eyebrow="Website health"
        title="Turn website issues into a clear to-do list"
        description="Start with urgent items. Expand an issue to understand why it matters, which pages it affects, and what you can do next."
        action={
          <Button kind="secondary" onClick={onFixes}>
            Recommended fixes <Icon name="arrow" className="ml-2 size-4" />
          </Button>
        }
      />
      <SeoHint icon="layers" title="One cause can affect many pages">
        The grouped view brings similar open findings together, so a repeated issue does
        not overwhelm your list. Individual findings include reviewed and resolved items
        too.
      </SeoHint>
      <div className="seo-filterbar">
        <div
          className="inline-flex rounded-xl border border-app-border bg-app-surface p-1"
          role="group"
          aria-label="Issue view"
        >
          <button
            className={`rounded-lg px-3 py-2 text-xs font-semibold ${view === 'grouped' ? 'bg-app-accent/10 text-app-accent' : 'text-app-muted'}`}
            type="button"
            aria-pressed={view === 'grouped'}
            onClick={() => setView('grouped')}
          >
            Grouped issues
          </button>
          <button
            className={`rounded-lg px-3 py-2 text-xs font-semibold ${view === 'pages' ? 'bg-app-accent/10 text-app-accent' : 'text-app-muted'}`}
            type="button"
            aria-pressed={view === 'pages'}
            onClick={() => setView('pages')}
          >
            Individual findings
          </button>
        </div>
        <label className="min-w-40 flex-1">
          <span className="sr-only">
            Search issues{view === 'pages' ? ' on this page' : ''}
          </span>
          <input
            type="search"
            className="seo-field w-full"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              view === 'pages'
                ? 'Search this page of findings…'
                : 'Search issue types or example URLs…'
            }
          />
        </label>
        <label>
          <span className="sr-only">Issue importance</span>
          <select
            className="seo-field"
            value={filter.severity ?? ''}
            onChange={(event) => {
              const next = { ...filter };
              if (event.target.value) next.severity = event.target.value;
              else delete next.severity;
              onFilterChange(next);
            }}
          >
            <option value="">All priorities</option>
            {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {view === 'pages' && (
          <label>
            <span className="sr-only">Finding status</span>
            <select
              className="seo-field"
              value={filter.status ?? ''}
              onChange={(event) => {
                const next = { ...filter };
                if (event.target.value) next.status = event.target.value;
                else delete next.status;
                onFilterChange(next);
              }}
            >
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="dismissed">Not applicable</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>
        )}
      </div>
      {view === 'grouped' ? (
        groupResource.error ? (
          <div role="alert">
            <SeoEmptyState
              compact
              title="Issue groups could not be loaded"
              description={groupResource.error}
              action={
                <Button kind="secondary" onClick={groupResource.reload}>
                  Try again
                </Button>
              }
            />
          </div>
        ) : !groupResource.data ? (
          <p role="status" className="seo-small-copy">
            Bringing similar issues together…
          </p>
        ) : groups.length === 0 ? (
          <SeoEmptyState
            compact
            title="No open issue groups to show"
            description="Try a broader search or check Individual findings for reviewed, reopened, and resolved items. No groups alone does not establish that every page is healthy."
            action={
              <Button kind="secondary" onClick={() => setView('pages')}>
                Browse individual findings
              </Button>
            }
          />
        ) : (
          <>
            <p className="seo-small-copy">
              {groups.length} open issue {groups.length === 1 ? 'type' : 'types'} ·
              ordered by the saved audit priority
            </p>
            <div className="seo-issue-list">
              {groups.map((group) => {
                const copy = getSeoRuleCopy(group.ruleId);
                const guide = getSeoGuidance(group.ruleId);
                return (
                  <details
                    className="seo-issue seo-surface"
                    key={`${group.ruleId}:${group.severity}`}
                  >
                    <summary className="seo-issue-head list-none">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <SeoSeverityBadge severity={group.severity} />
                          <span className="text-xs text-app-muted">
                            {group.count.toLocaleString()} affected{' '}
                            {group.count === 1 ? 'page' : 'pages'}
                          </span>
                        </div>
                        <h3>{copy.title}</h3>
                        <p className="seo-issue-meta">{guide.impact}</p>
                      </div>
                      <span className="mt-1 flex shrink-0 items-center gap-1 text-xs text-app-accent">
                        Details <Icon name="chevron-down" className="size-4" />
                      </span>
                    </summary>
                    <div className="seo-issue-detail">
                      <div>
                        <h4>What we found</h4>
                        <p>{copy.description}</p>
                      </div>
                      <div className="rounded-xl bg-app-accent/5 p-4">
                        <h4>What to do next</h4>
                        <p>{copy.recommendation ?? guide.action}</p>
                      </div>
                      <div>
                        <h4>Example affected pages</h4>
                        <p className="mb-2">
                          Showing up to {group.sampleTargets.length} saved examples from
                          this group.
                        </p>
                        <ul className="space-y-1">
                          {group.sampleTargets.map((url) => (
                            <li
                              key={url}
                              className="rounded-lg bg-app-surface-raised px-3 py-2"
                            >
                              {url}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <button
                        type="button"
                        className="seo-button-link w-fit"
                        onClick={() => {
                          setView('pages');
                          onFilterChange({ severity: group.severity });
                          setSearch('');
                        }}
                      >
                        Browse findings of this priority{' '}
                        <Icon name="arrow" className="size-4" />
                      </button>
                      <RuleReference ruleId={group.ruleId} />
                    </div>
                  </details>
                );
              })}
            </div>
          </>
        )
      ) : (
        <>
          {pageResource.error && (
            <div role="alert" className="seo-hint seo-tone-warning">
              <p>{pageResource.error}</p>
              <Button kind="secondary" onClick={pageResource.reload}>
                Try again
              </Button>
            </div>
          )}
          {pageResource.loading && !pageResource.data && (
            <p role="status" className="seo-small-copy">
              Loading findings…
            </p>
          )}
          <p className="seo-small-copy">
            {total
              ? `${offset + 1}–${Math.min(offset + findings.length, total)} of ${total.toLocaleString()} findings`
              : 'No findings in this filter'}
            {query ? ' · search applies to this page of results' : ''}
          </p>
          {(pageResource.loading && !pageResource.data) ||
          pageResource.error ? null : pageRows.length === 0 ? (
            <SeoEmptyState
              compact
              title="No matching findings on this page"
              description="Try another search, change the filters, or move to a different results page."
            />
          ) : (
            <div className="seo-issue-list">
              {pageRows.map((finding) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  canManage={canManage}
                  onDismiss={(id) => {
                    void onDismiss(id).then(pageResource.reload);
                  }}
                />
              ))}
            </div>
          )}
          {total > 25 && (
            <nav
              className="flex items-center justify-between gap-4"
              aria-label="Finding pages"
            >
              <Button
                kind="secondary"
                disabled={offset === 0}
                onClick={() => onPage(Math.max(0, offset - 25))}
              >
                Previous
              </Button>
              <span className="text-xs text-app-muted">
                Page {Math.floor(offset / 25) + 1} of {Math.ceil(total / 25)}
              </span>
              <Button
                kind="secondary"
                disabled={offset + 25 >= total}
                onClick={() => onPage(offset + 25)}
              >
                Next
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
function FindingCard({
  finding,
  canManage,
  onDismiss,
}: {
  finding: SeoFinding;
  canManage: boolean;
  onDismiss: (id: string) => void;
}) {
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const guide = getSeoGuidance(finding.ruleId);
  const copy = getSeoRuleCopy(finding.ruleId);
  const status: Record<string, string> = {
    open: 'Open',
    assigned: 'Assigned',
    in_progress: 'Being worked on',
    ready_for_verification: 'Ready to recheck',
    verified_resolved: 'Resolved',
    accepted_exception: 'Accepted exception',
    false_positive: 'Not applicable',
    unverifiable: 'Could not verify',
    reopened: 'Found again',
  };
  return (
    <details className="seo-issue seo-surface">
      <summary className="seo-issue-head list-none">
        <div>
          <div className="flex flex-wrap gap-2">
            <SeoSeverityBadge severity={finding.severity} />
            <SeoBadge>{status[finding.status] ?? finding.status}</SeoBadge>
          </div>
          <h3>{copy.title}</h3>
          <p className="seo-issue-meta break-all">{finding.affectedTarget}</p>
        </div>
        <Icon name="chevron-down" className="mt-2 size-4 shrink-0 text-app-muted" />
      </summary>
      <div className="seo-issue-detail">
        <div>
          <h4>What this means</h4>
          <p>{copy.description}</p>
          <p className="mt-2">{guide.impact}</p>
        </div>
        <div className="rounded-xl bg-app-accent/5 p-4">
          <h4>What to do next</h4>
          <p>{copy.recommendation ?? guide.action}</p>
        </div>
        <div>
          <h4>Evidence from the checkup</h4>
          <p>
            First found {new Date(finding.firstSeenAt).toLocaleDateString()} ·{' '}
            {finding.confidence === 'direct'
              ? 'Directly observed'
              : finding.confidence === 'corroborated'
                ? 'Supported by multiple observations'
                : 'Needs manual review'}
          </p>
          <FindingEvidence evidence={finding.evidence} />
        </div>
        {canManage && ['open', 'reopened'].includes(finding.status) && (
          <div className="border-t border-app-border pt-4">
            {confirmDismiss ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="max-w-xl">
                  Only mark this as not applicable after reviewing the evidence. This
                  updates the finding, without changing the website.
                </p>
                <Button
                  kind="secondary"
                  onClick={() => {
                    onDismiss(finding.id);
                    setConfirmDismiss(false);
                  }}
                >
                  Mark not applicable
                </Button>
                <button
                  type="button"
                  className="text-xs text-app-muted"
                  onClick={() => setConfirmDismiss(false)}
                >
                  Keep open
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="text-xs text-app-muted underline underline-offset-4"
                onClick={() => setConfirmDismiss(true)}
              >
                This finding does not apply
              </button>
            )}
          </div>
        )}
        <RuleReference ruleId={finding.ruleId} />
      </div>
    </details>
  );
}

function FindingEvidence({ evidence }: { evidence: Record<string, unknown> | null }) {
  if (!evidence || typeof evidence !== 'object') return null;
  // Known evidence shapes get a nice renderer; everything else falls back to a
  // key/value list so new rules show up usefully without needing a UI change.
  const brokenLinks = evidence['broken_links'];
  const genericAnchors = evidence['generic_anchors'];
  const missingReturn = evidence['missing_return_links'];
  const invalidLangs = evidence['invalid_langs'];
  const relativeHreflang = evidence['relative_hreflang'];
  const schemaErrors = evidence['schema_errors'];
  const duplicateOf = evidence['duplicate_of'];

  const entries: Array<[string, React.ReactNode]> = [];
  if (Array.isArray(brokenLinks)) {
    entries.push([
      'Broken links',
      <ul className="list-disc list-inside">
        {(brokenLinks as unknown[]).slice(0, 5).map((href, i) => (
          <li key={i} className="truncate">
            <code className="text-[11px]">{String(href)}</code>
          </li>
        ))}
        {brokenLinks.length > 5 && (
          <li className="italic">…and {brokenLinks.length - 5} more</li>
        )}
      </ul>,
    ]);
  }
  if (Array.isArray(genericAnchors)) {
    entries.push([
      'Generic anchors',
      <ul className="list-disc list-inside">
        {(genericAnchors as Array<{ href?: string; anchor?: string }>)
          .slice(0, 5)
          .map((a, i) => (
            <li key={i} className="truncate">
              "{String(a.anchor ?? '')}" →{' '}
              <code className="text-[11px]">{String(a.href ?? '')}</code>
            </li>
          ))}
      </ul>,
    ]);
  }
  if (Array.isArray(missingReturn)) {
    entries.push([
      'Missing return locales',
      <code className="text-[11px]">{(missingReturn as string[]).join(', ')}</code>,
    ]);
  }
  if (Array.isArray(invalidLangs)) {
    entries.push([
      'Invalid hreflang codes',
      <code className="text-[11px]">{(invalidLangs as string[]).join(', ')}</code>,
    ]);
  }
  if (Array.isArray(relativeHreflang)) {
    entries.push([
      'Relative hreflang hrefs',
      <code className="text-[11px]">
        {(relativeHreflang as string[]).slice(0, 5).join(', ')}
      </code>,
    ]);
  }
  if (Array.isArray(schemaErrors)) {
    entries.push([
      'Schema errors',
      <code className="text-[11px]">{(schemaErrors as string[]).join(', ')}</code>,
    ]);
  }
  if (typeof duplicateOf === 'string') {
    entries.push([
      'Canonical duplicate of',
      <code className="text-[11px]">{duplicateOf}</code>,
    ]);
  }
  // Scalar fallback: show numeric observations like word_count, h1_count
  for (const [k, v] of Object.entries(evidence)) {
    if (
      k === 'url' ||
      k === 'broken_links' ||
      k === 'generic_anchors' ||
      k === 'missing_return_links' ||
      k === 'invalid_langs' ||
      k === 'relative_hreflang' ||
      k === 'schema_errors' ||
      k === 'duplicate_of' ||
      k === 'content_hash'
    )
      continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      entries.push([
        k.replace(/_/g, ' '),
        <code className="text-[11px]">{String(v)}</code>,
      ]);
    }
  }

  if (entries.length === 0) return null;
  return (
    <div className="mt-2 pl-3 border-l-2 border-app-border text-xs text-app-text-muted space-y-1">
      {entries.map(([label, value], i) => (
        <div key={i}>
          <span className="font-medium text-app-text-subtle">{label}:</span> {value}
        </div>
      ))}
    </div>
  );
}
