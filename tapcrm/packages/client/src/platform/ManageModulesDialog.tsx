import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PLATFORM_MODULE_GROUPS,
  type PlatformModuleCatalogEntry,
  type PlatformModuleChangeRequest,
} from '@tapcrm/contracts';

export interface ManageModulesEntitlement {
  key: string;
  status: 'enabled' | 'disabled';
}

/** Keys that `key` needs, followed transitively, excluding `key` itself. */
export function transitiveDependencies(
  key: string,
  catalog: ReadonlyMap<string, PlatformModuleCatalogEntry>,
): string[] {
  const seen = new Set<string>();
  const stack = [...(catalog.get(key)?.dependsOn ?? [])];
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined || seen.has(next) || next === key) continue;
    seen.add(next);
    stack.push(...(catalog.get(next)?.dependsOn ?? []));
  }
  return [...seen];
}

/** Keys that need `key`, followed transitively, excluding `key` itself. */
export function transitiveDependents(
  key: string,
  catalog: ReadonlyMap<string, PlatformModuleCatalogEntry>,
): string[] {
  const seen = new Set<string>();
  const stack = [key];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    for (const entry of catalog.values()) {
      if (entry.dependsOn.includes(current) && !seen.has(entry.key) && entry.key !== key) {
        seen.add(entry.key);
        stack.push(entry.key);
      }
    }
  }
  return [...seen];
}

type Note = { kind: 'enable' | 'disable'; text: string };

export function ManageModulesDialog({
  companyName,
  catalog,
  entitlements,
  initialGroupKey,
  onClose,
  onApply,
}: {
  companyName: string;
  catalog: readonly PlatformModuleCatalogEntry[];
  entitlements: readonly ManageModulesEntitlement[];
  initialGroupKey?: string | undefined;
  onClose: () => void;
  /** Resolves when saved; rejects with the server message otherwise. */
  onApply: (change: PlatformModuleChangeRequest) => Promise<void>;
}): React.JSX.Element {
  const byKey = useMemo(
    () => new Map(catalog.map((entry) => [entry.key as string, entry])),
    [catalog],
  );
  const nameOf = (key: string): string => byKey.get(key)?.name ?? key;
  const isCore = (key: string): boolean => byKey.get(key)?.isCore === true;

  const initial = useMemo(() => {
    const keys = new Set<string>();
    for (const row of entitlements) if (row.status === 'enabled') keys.add(row.key);
    return keys;
  }, [entitlements]);

  const [desired, setDesired] = useState<Set<string>>(() => new Set(initial));
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const groupRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    if (initialGroupKey) {
      groupRefs.current[initialGroupKey]?.scrollIntoView({ block: 'start' });
    }
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
    // Run once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  const isOn = (key: string): boolean => isCore(key) || desired.has(key);

  /** Apply enables/disables to a copy of the state and describe the cascade. */
  function stage(
    enableKeys: readonly string[],
    disableKeys: readonly string[],
  ): void {
    const next = new Set(desired);
    const nextNotes = { ...notes };
    const alsoEnabled: string[] = [];
    const alsoDisabled: string[] = [];

    for (const key of enableKeys) {
      if (isCore(key)) continue;
      next.add(key);
      delete nextNotes[key];
      for (const dep of transitiveDependencies(key, byKey)) {
        if (!next.has(dep) && !isCore(dep)) {
          next.add(dep);
          nextNotes[dep] = {
            kind: 'enable',
            text: `Will also be enabled: ${nameOf(key)} needs it`,
          };
          alsoEnabled.push(dep);
        }
      }
    }
    for (const key of disableKeys) {
      if (isCore(key)) continue;
      next.delete(key);
      delete nextNotes[key];
      for (const dependent of transitiveDependents(key, byKey)) {
        if (next.has(dependent) && !isCore(dependent)) {
          next.delete(dependent);
          nextNotes[dependent] = {
            kind: 'disable',
            text: `Will also be disabled: it needs ${nameOf(key)}`,
          };
          alsoDisabled.push(dependent);
        }
      }
    }

    const parts: string[] = [];
    if (alsoEnabled.length > 0) {
      parts.push(`Also enabling ${alsoEnabled.map(nameOf).join(', ')} because they are required.`);
    }
    if (alsoDisabled.length > 0) {
      parts.push(
        `Also disabling ${alsoDisabled.map(nameOf).join(', ')} because they depend on a module you turned off. Switch them back on to undo.`,
      );
    }
    setDesired(next);
    setNotes(nextNotes);
    setBanner(parts.length > 0 ? parts.join(' ') : null);
    setError(null);
  }

  const enable = [...desired].filter((key) => !initial.has(key) && !isCore(key));
  const disable = [...initial].filter((key) => !desired.has(key) && !isCore(key));
  const hasChanges = enable.length > 0 || disable.length > 0;

  async function apply(): Promise<void> {
    if (!hasChanges || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onApply({
        ...(enable.length > 0 ? { enable } : {}),
        ...(disable.length > 0 ? { disable } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Module update failed');
      setBusy(false);
    }
  }

  const summary = [
    enable.length > 0 ? `Enable: ${enable.map(nameOf).join(', ')}` : '',
    disable.length > 0 ? `Disable: ${disable.map(nameOf).join(', ')}` : '',
  ].filter(Boolean);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-3 py-4 backdrop-blur-sm sm:px-5 sm:py-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-modules-title"
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface text-app-foreground shadow-2xl outline-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-app-border px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-app-accent">
              Module access
            </p>
            <h2 id="manage-modules-title" className="font-display text-2xl tracking-[-0.04em]">
              Manage modules
            </h2>
            <p className="mt-1 truncate text-sm text-app-muted">{companyName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close manage modules dialog"
            title="Close"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-app-accent/10 text-app-accent transition hover:bg-app-accent/20 focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {banner && (
            <div
              role="status"
              className="mb-4 rounded-xl border border-[#f5c56b]/35 bg-[#f5c56b]/10 px-3.5 py-3 text-xs leading-5 text-[#f5c56b]"
            >
              {banner}
            </div>
          )}
          {PLATFORM_MODULE_GROUPS.map((group) => {
            const keys: readonly string[] = group.moduleKeys;
            const switchable = keys.filter((key) => !isCore(key));
            const onCount = keys.filter(isOn).length;
            const allOn = switchable.every((key) => desired.has(key));
            const noneOn = switchable.every((key) => !desired.has(key));
            return (
              <section
                key={group.key}
                ref={(node) => {
                  groupRefs.current[group.key] = node;
                }}
                aria-labelledby={`manage-group-${group.key}`}
                className={`mb-4 scroll-mt-2 rounded-2xl border bg-app-background/35 p-3 sm:p-4 ${group.key === initialGroupKey ? 'border-app-accent/40' : 'border-app-border'}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id={`manage-group-${group.key}`} className="font-display text-sm font-semibold">
                    {group.label}{' '}
                    <span className="ml-1 text-xs font-normal text-app-muted">
                      {onCount}/{keys.length} on
                    </span>
                  </h3>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy || allOn}
                      onClick={() => stage(switchable, [])}
                      className="rounded-lg border border-app-accent/30 px-2.5 py-1.5 text-[11px] font-semibold text-app-accent transition hover:bg-app-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Enable all
                    </button>
                    <button
                      type="button"
                      disabled={busy || noneOn}
                      onClick={() => stage([], switchable)}
                      className="rounded-lg border border-app-border px-2.5 py-1.5 text-[11px] text-app-muted transition hover:border-app-accent hover:text-app-accent disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Disable all
                    </button>
                  </div>
                </div>
                <ul className="mt-3 divide-y divide-app-border/60">
                  {keys.map((key) => {
                    const entry = byKey.get(key);
                    const core = isCore(key);
                    const on = isOn(key);
                    const note = notes[key];
                    const changed = !core && on !== initial.has(key);
                    const visibleNote =
                      note && changed && (note.kind === 'enable') === on ? note : undefined;
                    const needs = (entry?.dependsOn ?? []).map(nameOf);
                    const labelId = `manage-module-${key}`;
                    return (
                      <li key={key} className="flex items-start justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p id={labelId} className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                            {nameOf(key)}
                            {core && (
                              <span className="rounded-full border border-app-border px-2 py-0.5 text-[10px] font-semibold text-app-muted">
                                Always on
                              </span>
                            )}
                            {changed && (
                              <span className="rounded-full bg-app-accent/10 px-2 py-0.5 text-[10px] font-semibold text-app-accent">
                                {on ? 'Will enable' : 'Will disable'}
                              </span>
                            )}
                          </p>
                          {entry?.description && (
                            <p className="mt-0.5 text-xs leading-5 text-app-muted">
                              {entry.description}
                            </p>
                          )}
                          {needs.length > 0 && (
                            <p className="mt-0.5 text-[11px] text-app-muted">
                              Needs: {needs.join(', ')}
                            </p>
                          )}
                          {visibleNote && (
                            <p className="mt-0.5 text-[11px] text-[#f5c56b]">{visibleNote.text}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-labelledby={labelId}
                          disabled={busy || core}
                          onClick={() => (on ? stage([], [key]) : stage([key], []))}
                          className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-60 ${on ? 'border-app-accent bg-app-accent' : 'border-app-border bg-app-background'}`}
                        >
                          <span
                            aria-hidden="true"
                            className={`absolute top-0.5 size-[18px] rounded-full transition-all ${on ? 'left-[22px] bg-app-on-accent' : 'left-0.5 bg-app-muted'}`}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        <footer className="border-t border-app-border px-5 py-4 sm:px-6">
          {error && (
            <p
              role="alert"
              className="mb-3 rounded-xl border border-[#ff8d8d]/40 bg-[#ff8d8d]/10 px-3.5 py-2.5 text-xs leading-5 text-app-danger"
            >
              {error}
            </p>
          )}
          <p className="mb-3 text-xs leading-5 text-app-muted" aria-live="polite">
            {summary.length > 0 ? summary.join(' · ') : 'No changes yet.'}
          </p>
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              className="rounded-[9px] border border-app-border bg-app-background px-4 py-2.5 text-sm text-app-foreground transition hover:border-app-accent hover:text-app-accent disabled:cursor-wait disabled:opacity-55"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-[9px] bg-app-accent px-4 py-2.5 text-sm font-bold text-app-on-accent transition hover:-translate-y-px hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void apply()}
              disabled={busy || !hasChanges}
            >
              {busy ? 'Applying...' : 'Apply changes'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
