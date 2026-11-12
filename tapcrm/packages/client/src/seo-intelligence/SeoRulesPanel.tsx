import { useState } from 'react';
import { getSeoRuleCopy, getSeoRuleGroupLabel } from '@tapcrm/contracts';
import { Icon } from '../ui/index.js';
import { RuleReference } from './RuleExplanation.js';
import {
  SeoEmptyState,
  SeoHint,
  SeoMetricCard,
  SeoSectionHeader,
  SeoSeverityBadge,
} from './SeoUi.js';
import type { SeoRuleRow } from './types.js';

export function SeoRulesPanel({
  rules,
  canManage,
  loadError,
  onToggle,
}: {
  rules: SeoRuleRow[];
  canManage: boolean;
  loadError: string;
  onToggle: (id: string, active: boolean) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const query = search.trim().toLowerCase();
  const enabled = rules.filter((rule) => rule.active && rule.tested).length;
  const filtered = rules.filter((rule) => {
    const copy = getSeoRuleCopy(rule.ruleId);
    const matches = [
      rule.ruleId,
      copy.title,
      copy.description,
      rule.description ?? '',
      getSeoRuleGroupLabel(rule.group),
    ]
      .join(' ')
      .toLowerCase()
      .includes(query);
    return (
      matches &&
      (status === 'all' ||
        (status === 'enabled'
          ? rule.active && rule.tested
          : !rule.active || !rule.tested))
    );
  });
  const groups = [...new Set(filtered.map((rule) => rule.group))];

  async function toggle(rule: SeoRuleRow) {
    setSaving(rule.ruleId);
    setError('');
    setNotice('');
    try {
      await onToggle(rule.ruleId, !rule.active);
      setNotice(
        `${getSeoRuleCopy(rule.ruleId).title}: ${rule.active ? 'disabled' : 'enabled'}. Existing findings stay in history.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The rule setting could not be saved.',
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="seo-panel">
      <SeoSectionHeader
        eyebrow="Website settings"
        title="Choose what your checkup looks for"
        description="These checks look at how your website is built, how it reads, and how search engines can find it. Keep the checks that matter to your website switched on."
      />
      <div className="seo-metric-grid">
        <SeoMetricCard
          label="Checks available"
          value={rules.length}
          detail="All checks in your website toolkit"
          icon="layers"
        />
        <SeoMetricCard
          label="Included in checkups"
          value={enabled}
          detail="Switched on and ready to run"
          icon="check"
          tone="accent"
        />
        <SeoMetricCard
          label="Paused or unavailable"
          value={rules.length - enabled}
          detail="These will not run in a new checkup"
          icon="pause"
          tone="neutral"
        />
      </div>
      <SeoHint title="Settings apply to new checkups" icon="settings">
        Turning a check off does not fix an issue or remove its history. Run a new checkup
        after changing settings to see updated results.
      </SeoHint>
      <div className="seo-surface flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:p-5">
        <label className="min-w-0 flex-1 text-sm font-semibold">
          Find a check
          <div className="relative mt-2">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-app-muted">
              <Icon name="search" className="size-4" />
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Try page titles, images, or speed"
              className="w-full rounded-xl border border-app-border bg-app-surface py-2.5 pl-10 pr-3 text-sm font-normal"
            />
          </div>
        </label>
        <label className="text-sm font-semibold">
          Show
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="mt-2 block w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 font-normal sm:w-56"
          >
            <option value="all">All checks</option>
            <option value="enabled">Included in checkups</option>
            <option value="disabled">Paused or unavailable</option>
          </select>
        </label>
      </div>
      {(loadError || error) && (
        <p
          role="alert"
          className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-app-danger"
        >
          {error || loadError}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-app-accent/20 bg-app-accent/5 p-4 text-sm text-app-foreground"
        >
          {notice}
        </p>
      )}
      {filtered.length === 0 ? (
        <SeoEmptyState
          compact
          title={rules.length ? 'No matching checks' : 'No checks to show yet'}
          description={
            rules.length
              ? 'Try a different search term or choose All checks to see more results.'
              : 'Check settings will appear here when they are available for your organization.'
          }
        />
      ) : (
        <div className="space-y-5">
          <p className="text-xs text-app-muted">
            Showing {filtered.length} of {rules.length} checks
          </p>
          {groups.map((group) => (
            <section key={group} className="seo-surface overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-app-border bg-app-surface-raised/50 px-5 py-4">
                <h3 className="text-base font-bold">{getSeoRuleGroupLabel(group)}</h3>
                <span className="rounded-full border border-app-border bg-app-surface px-2.5 py-1 text-xs text-app-muted">
                  {filtered.filter((rule) => rule.group === group).length} checks
                </span>
              </div>
              <div className="divide-y divide-app-border">
                {filtered
                  .filter((rule) => rule.group === group)
                  .map((rule) => {
                    const copy = getSeoRuleCopy(rule.ruleId);
                    return (
                      <div key={rule.ruleId} className="px-5 py-5">
                        <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-5">
                          <div className="min-w-0 flex-1">
                            <div className="mb-2">
                              <SeoSeverityBadge severity={rule.severity} />
                            </div>
                            <p className="text-sm font-bold">{copy.title}</p>
                            <p className="mt-2 text-sm leading-relaxed text-app-muted">
                              {rule.description || copy.description}
                            </p>
                            {!rule.tested && (
                              <p className="mt-2 text-xs text-app-muted">
                                This check is being validated and is not available to run
                                yet.
                              </p>
                            )}
                            <RuleReference ruleId={rule.ruleId} />
                          </div>
                          {canManage ? (
                            <button
                              type="button"
                              role="switch"
                              aria-label={copy.title}
                              aria-checked={rule.active && rule.tested}
                              disabled={saving !== null || !rule.tested}
                              onClick={() => {
                                void toggle(rule);
                              }}
                              className="flex shrink-0 items-center gap-2.5 rounded-xl px-2 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <span
                                aria-hidden="true"
                                className={`relative h-6 w-10 rounded-full transition-colors ${rule.active && rule.tested ? 'bg-app-accent' : 'bg-app-border'}`}
                              >
                                <span
                                  className={`absolute top-1 size-4 rounded-full bg-white shadow-sm transition-transform ${rule.active && rule.tested ? 'translate-x-5' : 'translate-x-1'}`}
                                />
                              </span>
                              {saving === rule.ruleId
                                ? 'Saving…'
                                : !rule.tested
                                  ? 'Unavailable'
                                  : rule.active
                                    ? 'Included'
                                    : 'Paused'}
                            </button>
                          ) : (
                            <span className="text-sm text-app-muted">
                              {rule.active && rule.tested ? 'Enabled' : 'Disabled'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
