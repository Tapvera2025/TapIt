import { useEffect, useRef, useState } from 'react';
import { Button, Field } from '../ui/components.js';
import { Icon } from '../ui/Icon.js';
import { listSocialClients } from './api.js';
import type { SocialClient, SocialClientPage } from './types.js';

/** Searches the existing CRM client records through the social permission boundary. */
export function ClientSelector({
  selected,
  onSelect,
}: {
  selected: SocialClient | null;
  onSelect: (client: SocialClient) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SocialClientPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [open]);
  useEffect(() => {
    let cancelled = false;
    if (!open) return;
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      void listSocialClients(search, page)
        .then((result) => {
          if (!cancelled) setData(result);
        })
        .catch((cause) => {
          if (!cancelled)
            setError(
              cause instanceof Error ? cause.message : 'Unable to search clients.',
            );
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, search, page]);
  return (
    <div
      ref={root}
      className="relative w-full max-w-sm"
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="social-client-picker"
        className="flex w-full items-center gap-3 rounded-xl border border-app-border bg-app-surface px-4 py-3 text-left hover:border-app-accent"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-app-accent/10 text-app-accent">
          <Icon name="briefcase" className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-app-muted">
            Client workspace
          </span>
          <span className="block truncate text-sm font-semibold">
            {selected
              ? selected.businessName || selected.clientName
              : 'Select an existing CRM client'}
          </span>
        </span>
        <Icon name="chevron-down" className="size-4 text-app-muted" />
      </button>
      {open && (
        <div
          id="social-client-picker"
          className="absolute left-0 right-0 z-30 mt-2 min-w-64 rounded-xl border border-app-border bg-app-surface p-3 shadow-xl"
        >
          <Field
            label="Search CRM clients"
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Name, business or email"
          />
          <div className="mt-3 max-h-64 overflow-y-auto" aria-busy={loading}>
            {loading ? (
              <p className="p-3 text-xs text-app-muted">Searching clients…</p>
            ) : error ? (
              <p className="p-3 text-xs text-app-danger" role="alert">
                {error}
              </p>
            ) : data?.items.length ? (
              data.items.map((client) => (
                <button
                  type="button"
                  key={client.id}
                  onClick={() => {
                    onSelect(client);
                    setOpen(false);
                  }}
                  className={`block w-full rounded-lg p-3 text-left hover:bg-app-surface-raised ${selected?.id === client.id ? 'bg-app-accent/10 text-app-accent' : ''}`}
                >
                  <span className="block truncate text-sm font-semibold">
                    {client.businessName || client.clientName}
                  </span>
                  <span className="block text-xs text-app-muted">
                    {client.clientName}
                  </span>
                </button>
              ))
            ) : (
              <p className="p-3 text-xs text-app-muted">No matching CRM clients.</p>
            )}
          </div>
          {(data?.totalPages ?? 0) > 1 && (
            <div className="mt-2 flex items-center justify-between border-t border-app-border pt-2">
              <Button
                kind="secondary"
                disabled={page <= 1 || loading}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </Button>
              <span className="text-xs text-app-muted">
                {page}/{data?.totalPages}
              </span>
              <Button
                kind="secondary"
                disabled={page >= (data?.totalPages ?? 1) || loading}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
