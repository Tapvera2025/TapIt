import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { IdentityApiError } from '../identity/api/authApi.js';
import { listSocialAccounts } from '../social/api.js';
import { PLATFORM_LABELS, type SocialAccount } from '../social/types.js';
import { Button, Card } from '../ui/index.js';
import {
  clientPortalSocialUrl,
  connectedByLabel,
  statusLabel,
} from './ClientSocialAccessCard.helpers.js';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; accounts: SocialAccount[] }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

export function ClientSocialAccessCard({
  clientId,
  clientName,
  isSocialProject,
  canViewSocial,
  onOpenSocial,
}: {
  clientId: string;
  clientName: string;
  isSocialProject: boolean;
  canViewSocial: boolean;
  onOpenSocial?: () => void;
}): React.JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const linkRef = useRef<HTMLInputElement>(null);
  const link = clientPortalSocialUrl(window.location.origin);

  useEffect(() => {
    if (!canViewSocial) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    listSocialAccounts(clientId)
      .then((accounts) => {
        if (!cancelled) setState({ kind: 'ready', accounts });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const status = cause instanceof IdentityApiError ? cause.status : 0;
        setState({ kind: status === 403 || status === 404 ? 'unavailable' : 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, canViewSocial]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copied');
    } catch {
      linkRef.current?.focus();
      linkRef.current?.select();
      toast('Press Ctrl+C to copy the selected link');
    }
  };

  return (
    <Card className={isSocialProject ? 'border-app-accent ring-1 ring-app-accent' : ''}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">
          Client&apos;s social accounts
        </p>
        {canViewSocial && onOpenSocial && (
          <Button onClick={onOpenSocial}>Open in Manage Social Media</Button>
        )}
      </div>

      {!canViewSocial ? (
        <p className="text-sm text-app-muted">
          You need the &apos;See social workspaces&apos; power to see which accounts are connected.
        </p>
      ) : state.kind === 'loading' ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading social accounts">
          <div className="h-9 animate-pulse rounded-md bg-app-border/50" />
          <div className="h-9 animate-pulse rounded-md bg-app-border/50" />
        </div>
      ) : state.kind === 'unavailable' ? (
        <p className="text-sm text-app-muted">Social accounts aren&apos;t available for this client.</p>
      ) : state.kind === 'failed' ? (
        <p className="text-sm text-app-muted">Couldn&apos;t load the connected accounts right now.</p>
      ) : state.accounts.length === 0 ? (
        <p className="text-sm text-app-muted">{clientName} hasn&apos;t connected any social accounts yet.</p>
      ) : (
        <ul className="divide-y divide-app-border">
          {state.accounts.map((account) => (
            <li key={account.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="font-medium">{PLATFORM_LABELS[account.platform]}</span>
              <span className="min-w-0 flex-1 truncate">{account.name}</span>
              <span className="rounded-full border border-app-border px-2 py-0.5 text-xs">
                {statusLabel(account.status)}
              </span>
              <span className="text-xs text-app-muted">{connectedByLabel(account)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-app-border pt-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-app-muted">
          Ask the client to connect
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={linkRef}
            readOnly
            value={link}
            aria-label="Client portal social link"
            onFocus={(event) => event.currentTarget.select()}
            className="min-w-0 flex-1 rounded-md border border-app-border bg-transparent px-2 py-1.5 text-sm"
          />
          <Button onClick={() => void copy()}>Copy link</Button>
        </div>
        <p className="mt-2 text-xs text-app-muted">
          Send this link to {clientName}. They sign in to their portal and choose which Facebook Page,
          Instagram and YouTube accounts your team can use.
        </p>
      </div>
    </Card>
  );
}
