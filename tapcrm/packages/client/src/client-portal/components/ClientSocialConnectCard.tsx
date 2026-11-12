import { useEffect, useState } from 'react';
import type { SocialPortalAccount } from '@tapcrm/contracts';
import { Button, Card, Icon, Skeleton } from '../../ui/index.js';
import { getPortalProfile } from '../api/portalApi.js';
import { getSocialConnections } from '../api/socialConnectionsApi.js';
import {
  accountStatusLabel,
  hasActiveAccount,
  isActiveAccount,
  isModuleOff,
  platformLabel,
} from '../social-connections-model.js';

type State =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'error' }
  | { kind: 'ready'; accounts: SocialPortalAccount[]; anyActive: boolean };

export function ClientSocialConnectCard({
  onNavigate,
  variant,
  emphasis = false,
  hideWhenConnected = false,
}: {
  onNavigate: (path: string) => void;
  variant: 'project' | 'dashboard';
  emphasis?: boolean;
  hideWhenConnected?: boolean;
}): React.JSX.Element | null {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const profile = await getPortalProfile();
        const overview = await getSocialConnections(profile.clientId);
        if (live)
          setState({
            kind: 'ready',
            accounts: overview.accounts,
            anyActive: hasActiveAccount(overview),
          });
      } catch (cause) {
        if (live) setState(isModuleOff(cause) ? { kind: 'hidden' } : { kind: 'error' });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (state.kind === 'hidden') return null;
  if (state.kind === 'ready' && hideWhenConnected && state.anyActive) return null;

  const frame = `min-w-0 ${emphasis ? 'border-app-accent/60 bg-app-accent/5 ring-1 ring-app-accent/20' : ''} ${variant === 'project' ? 'mb-4' : ''}`;

  if (state.kind === 'loading')
    return (
      <Card className={frame}>
        <div aria-busy="true" aria-label="Loading social accounts" className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full max-w-lg" />
          <Skeleton className="h-9 w-40" />
        </div>
      </Card>
    );

  if (state.kind === 'error')
    return (
      <Card className={frame}>
        <p className="text-sm text-app-muted">
          Social account options couldn’t be loaded right now. You can still open{' '}
          <button type="button" className="font-semibold text-app-accent hover:underline" onClick={() => onNavigate('/client/social')}>
            Social accounts
          </button>
          .
        </p>
      </Card>
    );

  const { accounts, anyActive } = state;
  const headingId = `social-connect-${variant}`;
  return (
    <Card className={frame}>
      <div className="flex min-w-0 items-start gap-3" aria-labelledby={headingId} role="group">
        {emphasis && (
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-app-accent">
            <Icon name="share" className="size-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="font-display text-lg font-bold">
            {anyActive ? 'Your social accounts' : 'Connect your social accounts'}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-app-muted">
            Connect your Facebook Page, Instagram and YouTube so your agency team can prepare and publish posts for you. You choose exactly which accounts, and can disconnect any time.
          </p>
          {accounts.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {accounts.map((account) => (
                <li key={account.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-semibold">{platformLabel(account.platform)}</span>
                  <span className="min-w-0 break-words text-app-muted">{account.name}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${isActiveAccount(account) ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400' : 'border-amber-500/40 text-amber-700 dark:text-amber-400'}`}
                  >
                    {accountStatusLabel(account.status)}
                  </span>
                  {account.managedBy === 'agency' && (
                    <span className="text-xs text-app-muted">Managed by your agency</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <Button onClick={() => onNavigate('/client/social')}>
              {anyActive ? 'Manage social accounts' : 'Connect accounts'}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
