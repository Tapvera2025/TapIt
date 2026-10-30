import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../ui/Icon.js';
import type { CompanySearchDestination } from './navigation.js';

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function score(destination: CompanySearchDestination, query: string): number {
  const label = normalize(destination.label);
  const category = normalize(destination.category);
  const keywords = destination.keywords.map(normalize);
  if (label === query) return 100;
  if (label.startsWith(query)) return 80;
  if (label.includes(query)) return 65;
  if (category === query) return 58;
  if (category.includes(query)) return 45;
  if (keywords.some((keyword) => keyword.startsWith(query))) return 40;
  if (keywords.some((keyword) => keyword.includes(query))) return 25;
  return 0;
}

export function searchCompanyDestinations(
  destinations: readonly CompanySearchDestination[],
  query: string,
): CompanySearchDestination[] {
  const normalized = normalize(query);
  if (!normalized) return destinations.slice(0, 8);
  return destinations
    .map((destination) => ({ destination, rank: score(destination, normalized) }))
    .filter((entry) => entry.rank > 0)
    .sort(
      (a, b) => b.rank - a.rank || a.destination.label.localeCompare(b.destination.label),
    )
    .slice(0, 12)
    .map((entry) => entry.destination);
}

export function GlobalFeatureSearch({
  destinations,
  onNavigate,
  className = '',
}: {
  destinations: readonly CompanySearchDestination[];
  onNavigate: (path: string) => void;
  className?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    return searchCompanyDestinations(destinations, query);
  }, [destinations, query]);
  const groupedResults = useMemo(() => {
    const settings = results.filter(
      (destination) =>
        destination.category === 'Preferences' ||
        /settings|appearance|theme/i.test(destination.label),
    );
    const features = results.filter((destination) => !settings.includes(destination));
    return [
      { label: 'Features', items: features },
      { label: 'Settings', items: settings },
    ].filter((group) => group.items.length > 0);
  }, [results]);

  useEffect(() => {
    const focusInput = open
      ? window.setTimeout(
          () => (expanded ? inputRef.current : mobileInputRef.current)?.focus(),
          0,
        )
      : null;
    const onKeyDown = (event: KeyboardEvent) => {
      const isCommand =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (isCommand) {
        event.preventDefault();
        setExpanded(true);
        setOpen(true);
        return;
      }
      if (!open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        setExpanded(false);
        return;
      }
      if (!results.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % results.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + results.length) % results.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const destination = results[activeIndex];
        if (destination) {
          onNavigate(destination.path);
          setOpen(false);
          setQuery('');
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      if (focusInput !== null) window.clearTimeout(focusInput);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [activeIndex, expanded, onNavigate, open, results]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setExpanded(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function close(): void {
    setOpen(false);
    setExpanded(false);
    setQuery('');
  }

  const resultContent = query.trim() ? (
    groupedResults.length === 0 ? (
      <div className="grid min-h-0 flex-1 place-items-center px-6 py-16 text-center md:min-h-48 md:flex-none md:py-10">
        <div>
          <span className="mx-auto grid size-11 place-items-center rounded-full border border-app-border bg-app-surface text-app-muted">
            <Icon name="search" className="size-5" />
          </span>
          <p className="mt-4 text-sm font-semibold text-app-foreground">
            No matching features found
          </p>
          <p className="mt-1 text-xs text-app-muted">
            Try a different keyword or check the spelling.
          </p>
        </div>
      </div>
    ) : (
      <div className="space-y-4 p-3 md:p-0">
        {groupedResults.map((group) => (
          <section
            key={group.label}
            aria-labelledby={`search-group-${group.label.toLowerCase()}`}
          >
            <h2
              id={`search-group-${group.label.toLowerCase()}`}
              className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-app-muted"
            >
              {group.label}
            </h2>
            <div className="divide-y divide-app-border/60">
              {group.items.map((destination) => {
                const resultIndex = results.indexOf(destination);
                return (
                  <button
                    key={destination.path}
                    type="button"
                    role="option"
                    aria-selected={activeIndex === resultIndex}
                    onMouseEnter={() => setActiveIndex(resultIndex)}
                    onClick={() => {
                      onNavigate(destination.path);
                      close();
                    }}
                    className={`flex min-h-14 w-full items-center gap-3 px-2 py-2.5 text-left transition md:rounded-xl ${activeIndex === resultIndex ? 'bg-app-accent/10 text-app-foreground' : 'text-app-muted hover:bg-app-surface-raised hover:text-app-foreground'}`}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-app-accent/10 text-app-accent">
                      <Icon name={destination.icon} className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {destination.label}
                      </span>
                      <span className="block truncate text-[11px] text-app-muted">
                        {destination.category}
                      </span>
                    </span>
                    <Icon name="arrow" className="size-4 shrink-0 text-app-muted" />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    )
  ) : null;

  return (
    <div
      ref={containerRef}
      className={`relative min-w-0 flex-none md:flex-none ${className}`}
    >
      <button
        type="button"
        className="inline-flex size-9 items-center justify-center rounded-xl border border-app-border bg-app-surface-raised text-app-muted transition hover:border-app-accent/50 hover:text-app-accent md:hidden"
        onClick={() => {
          // Mobile search is a dedicated full-screen view and must not inherit
          // the desktop input's expanded state after a responsive resize.
          setExpanded(false);
          setOpen(true);
        }}
        aria-label="Search features, pages and settings"
      >
        <Icon name="search" className="size-4" />
      </button>

      <div
        className={`hidden overflow-hidden transition-[width,opacity] duration-250 ease-out md:block ${expanded ? 'w-[min(32rem,calc(100vw-24rem))] max-w-[32rem]' : 'w-9'}`}
      >
        {expanded ? (
          <div className="relative opacity-100">
            <Icon
              name="search"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-app-muted"
            />
            <input
              ref={inputRef}
              value={query}
              onFocus={() => setOpen(true)}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === 'ArrowDown' ||
                  event.key === 'ArrowUp' ||
                  event.key === 'Enter' ||
                  event.key === 'Escape'
                )
                  return;
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')
                  event.preventDefault();
              }}
              placeholder="Search features, pages and settings..."
              aria-label="Search features, pages and settings"
              aria-expanded={open}
              aria-controls="global-feature-search-results"
              className="h-9 w-full rounded-xl border border-app-border bg-app-surface-raised/80 py-2 pl-9 pr-16 text-xs text-app-foreground outline-none placeholder:text-app-muted focus:border-app-accent sm:text-sm"
            />
            <button
              type="button"
              onClick={() => {
                if (query) setQuery('');
                else close();
              }}
              className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-app-muted transition hover:bg-app-background hover:text-app-foreground"
              aria-label={query ? 'Clear search' : 'Close feature search'}
            >
              <Icon name="close" className="size-3.5" />
            </button>
            <kbd className="pointer-events-none absolute right-10 top-1/2 -translate-y-1/2 rounded-md border border-app-border px-1.5 py-0.5 text-[10px] font-semibold text-app-muted">
              ⌘K
            </kbd>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setExpanded(true);
              setOpen(true);
            }}
            className="inline-flex size-9 items-center justify-center rounded-xl border border-app-border bg-app-surface-raised text-app-muted transition hover:border-app-accent/50 hover:bg-app-accent/10 hover:text-app-accent"
            aria-label="Search features, pages and settings"
            title="Search features, pages and settings"
          >
            <Icon name="search" className="size-4" />
          </button>
        )}
      </div>

      {open && !expanded &&
        createPortal(
          <div
            id="global-feature-search-results"
            role="listbox"
            aria-label="Feature search results"
            className="fixed inset-0 z-[9999] flex flex-col overflow-hidden bg-app-background md:hidden"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-app-border bg-app-surface px-3 py-3">
              <button
                type="button"
                onClick={close}
                className="grid size-9 shrink-0 place-items-center rounded-xl border border-app-border bg-app-surface-raised text-app-muted transition hover:text-app-foreground"
                aria-label="Close search"
              >
                <Icon name="chevron-left" className="size-4" />
              </button>
              <div className="relative min-w-0 flex-1">
                <Icon
                  name="search"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-app-muted"
                />
                <input
                  ref={mobileInputRef}
                  value={query}
                  onFocus={() => setOpen(true)}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setOpen(true);
                  }}
                  placeholder="Search features, pages and settings..."
                  aria-label="Search features, pages and settings"
                  className="h-10 w-full rounded-xl border border-app-border bg-app-surface-raised py-2 pl-9 pr-3 text-sm text-app-foreground outline-none placeholder:text-app-muted focus:border-app-accent"
                />
              </div>
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    window.setTimeout(() => mobileInputRef.current?.focus(), 0);
                  }}
                  className="grid size-9 shrink-0 place-items-center rounded-xl text-app-muted transition hover:bg-app-surface-raised hover:text-app-foreground"
                  aria-label="Clear search"
                >
                  <Icon name="close" className="size-4" />
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {resultContent}
            </div>
          </div>
          ,
          document.body,
        )}

      {open && expanded && query.trim() && (
        <div
          id="global-feature-search-results"
          role="listbox"
          aria-label="Feature search results"
          className="absolute left-0 right-auto top-full z-[80] mt-2 max-h-[min(32rem,calc(100vh-7rem))] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-app-border bg-app-surface p-2 shadow-xl"
        >
          {resultContent}
        </div>
      )}
    </div>
  );
}
