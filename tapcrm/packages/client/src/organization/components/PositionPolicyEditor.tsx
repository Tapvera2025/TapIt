import { useMemo, useState } from 'react';
import {
  REGISTRY,
  actionDescription,
  actionScopes,
  actionTitle,
  moduleTitle,
  protectedCapabilityReason,
  scopeHint,
  scopeLabel,
  type Action,
  type ActionDefinition,
} from '@tapcrm/contracts';
import { Button } from '../../ui/components.js';
import type { PolicyImpactPreview, PositionPolicy } from '../types/index.js';

/**
 * The position "powers" editor, written for the person who hands out access —
 * a company owner or HR manager — rather than for a developer:
 *
 *   - every power has a plain name and one line of what it means;
 *   - "who it applies to" is in everyday words ("Their team");
 *   - only the parts of TapCRM the company uses are listed, grouped and
 *     searchable, with the powers that are on counted per group;
 *   - Save lives in the window's footer, so it never needs scrolling to.
 */

interface Row {
  readonly policy: PositionPolicy;
  readonly index: number;
  readonly definition: ActionDefinition<Action>;
  readonly title: string;
  readonly description: string;
  readonly locked: string | null;
  readonly changed: boolean;
}

/** "Approve or reject leave (Just their own → Their team)". */
function describeScopeChange(change: PolicyImpactPreview['scopeChanges'][number]): string {
  const was = scopeLabel(change.from);
  const now = scopeLabel(change.to);
  return actionTitle(change.action) + ' (' + was + ' → ' + now + ')';
}

function isChanged(policy: PositionPolicy, before: PositionPolicy | undefined): boolean {
  const wasOn = before?.allowed ?? false;
  if (policy.allowed !== wasOn) return true;
  return policy.allowed && before !== undefined && before.scope !== policy.scope;
}

/** How many powers differ from what is saved. */
export function countPolicyChanges(
  policies: readonly PositionPolicy[],
  baseline: readonly PositionPolicy[],
): number {
  const before = new Map(baseline.map((policy) => [policy.action, policy]));
  return policies.filter((policy) => isChanged(policy, before.get(policy.action))).length;
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 rounded-full border px-1 py-1 pr-3 text-xs font-bold transition ${
        checked
          ? 'border-app-accent/60 bg-app-accent/15 text-app-accent'
          : 'border-app-border text-app-muted hover:border-app-accent/50'
      }`}
    >
      <span
        aria-hidden="true"
        className={`relative h-5 w-9 rounded-full transition ${checked ? 'bg-app-accent' : 'bg-app-border'}`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}
        />
      </span>
      {checked ? 'Allowed' : 'Not allowed'}
    </button>
  );
}

export function PositionPolicyEditor({
  positionName,
  policies,
  baseline,
  enabledModules,
  onChange,
  impact,
}: {
  positionName: string;
  policies: readonly PositionPolicy[];
  baseline: readonly PositionPolicy[];
  /** The modules this company uses; null while unknown (everything is shown). */
  enabledModules: ReadonlySet<string> | null;
  onChange: (index: number, patch: Partial<PositionPolicy>) => void;
  impact: PolicyImpactPreview | null;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [onlyAllowed, setOnlyAllowed] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const search = query.trim().toLowerCase();

  const before = useMemo(() => new Map(baseline.map((policy) => [policy.action, policy])), [baseline]);

  const sections = useMemo(() => {
    const byModule = new Map<string, Row[]>();
    policies.forEach((policy, index) => {
      const definition = REGISTRY[policy.action as Action];
      if (!definition) return;
      if (enabledModules !== null && !enabledModules.has(definition.module)) return;
      const title = actionTitle(policy.action);
      const description = actionDescription(definition);
      const haystack = `${title} ${description} ${policy.action} ${moduleTitle(definition.module)}`.toLowerCase();
      if (search && !haystack.includes(search)) return;
      if (onlyAllowed && !policy.allowed) return;
      const rows = byModule.get(definition.module) ?? [];
      rows.push({
        policy,
        index,
        definition,
        title,
        description,
        locked: protectedCapabilityReason(definition),
        changed: isChanged(policy, before.get(policy.action)),
      });
      byModule.set(definition.module, rows);
    });
    return [...byModule.entries()]
      .map(([module, rows]) => ({
        module,
        title: moduleTitle(module as ActionDefinition['module']),
        // What can be handed out first; Super Admin-only powers last.
        rows: [...rows.filter((row) => row.locked === null), ...rows.filter((row) => row.locked !== null)],
        allowed: rows.filter((row) => row.policy.allowed).length,
        grantable: rows.filter((row) => row.locked === null).length,
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [policies, enabledModules, search, onlyAllowed, before]);

  const totalAllowed = policies.filter((policy) => {
    const definition = REGISTRY[policy.action as Action];
    return policy.allowed && definition && (enabledModules === null || enabledModules.has(definition.module));
  }).length;

  const isOpen = (module: string, allowed: number): boolean =>
    search !== '' || onlyAllowed ? true : (expanded[module] ?? allowed > 0);

  return (
    <div>
      <p className="text-sm text-app-muted">
        Choose what people in the <strong className="text-app-foreground">{positionName}</strong> position
        can do. Turn a power on, then pick who it applies to — just their own records, their team, their
        department or everyone. The Super Admin can always do everything.
      </p>

      {impact && (
        <div className="mt-4 rounded-xl border border-app-accent/30 bg-app-accent/10 p-4 text-sm">
          <p className="font-semibold">
            What saving will change{' '}
            <span className="font-normal text-app-muted">
              — {impact.holderCount} {impact.holderCount === 1 ? 'person holds' : 'people hold'} this position
            </span>
          </p>
          {impact.capabilitiesAdded.length > 0 && (
            <p className="mt-2">
              <span className="font-semibold text-app-success">Allowed:</span>{' '}
              {impact.capabilitiesAdded.map((action) => actionTitle(action)).join(', ')}
            </p>
          )}
          {impact.capabilitiesRemoved.length > 0 && (
            <p className="mt-1">
              <span className="font-semibold text-app-danger">No longer allowed:</span>{' '}
              {impact.capabilitiesRemoved.map((action) => actionTitle(action)).join(', ')}
            </p>
          )}
          {impact.scopeChanges.length > 0 && (
            <p className="mt-1">
              <span className="font-semibold">Changes who it applies to:</span>{' '}
              {impact.scopeChanges.map(describeScopeChange).join(', ')}
            </p>
          )}
          {impact.capabilitiesAdded.length + impact.capabilitiesRemoved.length + impact.scopeChanges.length === 0 && (
            <p className="mt-2 text-app-muted">Nothing changes.</p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Escape clears the search first; a second Escape closes the window.
            if (event.key === 'Escape' && query !== '') {
              event.preventDefault();
              setQuery('');
            }
          }}
          placeholder="Search powers, e.g. leave, payslips, punch"
          aria-label="Search powers"
          className="min-w-56 flex-1 rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
        />
        <label className="flex items-center gap-2 text-sm text-app-muted">
          <input type="checkbox" checked={onlyAllowed} onChange={(event) => setOnlyAllowed(event.target.checked)} />
          Show only what's allowed
        </label>
        <span className="text-sm text-app-muted">{totalAllowed} allowed</span>
      </div>
      {enabledModules !== null && (
        <p className="mt-2 text-xs text-app-muted">Showing the parts of TapCRM your company uses.</p>
      )}

      <div className="mt-4 space-y-3">
        {sections.length === 0 && (
          <p className="rounded-xl border border-dashed border-app-border p-6 text-center text-sm text-app-muted">
            No powers match. Try another word, or clear “Show only what's allowed”.
          </p>
        )}
        {sections.map((section) => {
          const open = isOpen(section.module, section.allowed);
          return (
            <section key={section.module} className="rounded-xl border border-app-border">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setExpanded((state) => ({ ...state, [section.module]: !open }))}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="font-display text-base font-bold">{section.title}</span>
                <span className="flex items-center gap-3 text-xs text-app-muted">
                  <span className={section.allowed > 0 ? 'font-semibold text-app-accent' : ''}>
                    {section.allowed} of {section.grantable} allowed
                  </span>
                  <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                </span>
              </button>
              {open && (
                <div className="divide-y divide-app-border border-t border-app-border">
                  {section.rows.map((row) => (
                    <div
                      key={row.policy.action}
                      className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between ${row.changed ? 'bg-app-accent/5' : ''}`}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {row.title}
                          {row.changed && (
                            <span className="ml-2 rounded bg-app-accent/15 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-app-accent">
                              Changed
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-sm text-app-muted">{row.description}</p>
                        <p className="mt-1 font-mono text-[11px] text-app-muted opacity-70">{row.policy.action}</p>
                      </div>
                      {row.locked !== null ? (
                        <span className="shrink-0 self-start rounded-full border border-app-border px-3 py-1 text-xs text-app-muted">
                          Super Admin only
                        </span>
                      ) : (
                        <div className="flex shrink-0 flex-col gap-2 sm:w-60 sm:items-end">
                          <Switch
                            checked={row.policy.allowed}
                            label={`Allow: ${row.title}`}
                            onChange={(allowed) => onChange(row.index, { allowed })}
                          />
                          {row.policy.allowed && (
                            <label className="w-full text-xs font-semibold text-app-muted">
                              <span className="mb-1 block">Applies to</span>
                              <select
                                value={row.policy.scope}
                                onChange={(event) => onChange(row.index, { scope: event.target.value })}
                                aria-label={`Who “${row.title}” applies to`}
                                className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm font-normal text-app-foreground outline-none focus:border-app-accent"
                              >
                                {actionScopes(row.definition).map((scope) => (
                                  <option key={scope} value={scope}>
                                    {scopeLabel(scope)}
                                  </option>
                                ))}
                              </select>
                              <span className="mt-1 block font-normal">{scopeHint(row.policy.scope)}</span>
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** The window's footer: always in view, whatever is scrolled. */
export function PositionPolicyFooter({
  changes,
  busy,
  onPreview,
  onSave,
}: {
  changes: number;
  busy: boolean;
  onPreview: () => void;
  onSave: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-app-muted" aria-live="polite">
        {changes === 0 ? 'No changes yet' : `${changes} unsaved ${changes === 1 ? 'change' : 'changes'}`}
      </p>
      <div className="flex gap-2">
        <Button kind="secondary" onClick={onPreview} disabled={busy || changes === 0}>
          Preview changes
        </Button>
        <Button onClick={onSave} disabled={busy || changes === 0}>
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
