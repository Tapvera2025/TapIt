import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import type {
  SocialPortalAccount,
  SocialPortalConnectionChoice,
  SocialPortalOverview,
  SocialPortalPlatform,
  SocialPortalProvider,
} from '@tapcrm/contracts';
import { Button, Card, Loading, Modal, Notice, Page } from '../../ui/index.js';
import { IdentityApiError } from '../../identity/api/authApi.js';
import { getPortalProfile } from '../api/portalApi.js';
import {
  completeSocialConnection,
  disconnectSocialAccount,
  getSocialConnections,
  selectSocialAccounts,
  startSocialConnection,
} from '../api/socialConnectionsApi.js';
import {
  PLATFORM_NAMES,
  accessProviderName,
  candidateReason,
  disconnectSummary,
  isModuleOff,
  isSelectable,
  parseOAuthFragment,
  revokeWarning,
} from '../social-connections-model.js';

const UNAVAILABLE_TEXT =
  'Social accounts aren’t available for your account yet. Please contact your agency.';

function messageOf(cause: unknown, fallback: string): string {
  if (cause instanceof IdentityApiError && cause.code === 'SOCIAL_OAUTH_INVALID')
    return 'This connection attempt has expired or was already used. Please start again.';
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function Avatar({
  name,
  url,
  platform,
}: {
  name: string;
  url: string | null;
  platform: string;
}): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  if (url && !broken)
    return (
      <img
        src={url}
        alt=""
        onError={() => setBroken(true)}
        referrerPolicy="no-referrer"
        className="size-10 shrink-0 rounded-full border border-app-border object-cover"
      />
    );
  return (
    <span
      aria-hidden="true"
      className="grid size-10 shrink-0 place-items-center rounded-full bg-app-accent/10 text-sm font-bold text-app-accent"
    >
      {(PLATFORM_NAMES[platform] ?? name).charAt(0).toUpperCase()}
    </span>
  );
}

export function ClientSocialAccountsPage({
  onError,
}: {
  onError: (cause: unknown) => void;
}): React.JSX.Element {
  const [clientId, setClientId] = useState<string | null>(null);
  const [overview, setOverview] = useState<SocialPortalOverview | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [problem, setProblem] = useState('');
  const [completing, setCompleting] = useState(false);
  const [choice, setChoice] = useState<SocialPortalConnectionChoice | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<SocialPortalAccount | null>(null);
  const handled = useRef(false);
  const choiceHeading = useRef<HTMLHeadingElement>(null);

  // Take the sign-in result out of the address bar straight away, before anything else runs.
  const [returned] = useState(() => {
    const result = parseOAuthFragment(window.location.hash);
    if (result)
      window.history.replaceState(
        {},
        '',
        window.location.pathname + window.location.search,
      );
    return result;
  });

  const handleLoadFailure = useCallback(
    (cause: unknown) => {
      if (isModuleOff(cause)) setUnavailable(true);
      else {
        setLoadError(
          messageOf(cause, 'We couldn’t load your social accounts. Please try again.'),
        );
        onError(cause);
      }
    },
    [onError],
  );

  const load = useCallback(async (): Promise<string | null> => {
    try {
      const profile = await getPortalProfile();
      setClientId(profile.clientId);
      setOverview(await getSocialConnections(profile.clientId));
      setLoadError('');
      return profile.clientId;
    } catch (cause) {
      handleLoadFailure(cause);
      return null;
    }
  }, [handleLoadFailure]);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    if (returned?.kind === 'denied' || returned?.kind === 'invalid')
      setProblem(returned.message);
    if (returned?.kind === 'success') setCompleting(true);
    void (async () => {
      const id = await load();
      if (returned?.kind !== 'success') return;
      try {
        if (!id || id !== returned.clientId)
          throw new Error(
            'This connection belongs to a different account. Please start again.',
          );
        const next = await completeSocialConnection(
          id,
          returned.platform,
          returned.code,
          returned.state,
        );
        setPicked([]);
        setChoice(next);
      } catch (cause) {
        setProblem(messageOf(cause, 'We couldn’t finish connecting. Please try again.'));
      } finally {
        setCompleting(false);
      }
    })();
  }, [load, returned]);

  useEffect(() => {
    if (choice) choiceHeading.current?.focus();
  }, [choice]);

  const start = async (platform: SocialPortalPlatform) => {
    if (!clientId) return;
    setStarting(platform);
    setProblem('');
    try {
      const { authorizationUrl } = await startSocialConnection(clientId, platform);
      window.location.assign(authorizationUrl);
    } catch (cause) {
      setProblem(messageOf(cause, 'We couldn’t start the connection. Please try again.'));
      setStarting(null);
    }
  };

  const confirm = async () => {
    if (!clientId || !choice || picked.length === 0) return;
    setSaving(true);
    try {
      const next = await selectSocialAccounts(
        clientId,
        choice.platform,
        choice.state,
        picked,
      );
      setOverview(next);
      setChoice(null);
      setPicked([]);
      toast.success('Accounts connected');
    } catch (cause) {
      setProblem(
        messageOf(cause, 'We couldn’t connect those accounts. Please try again.'),
      );
      if (cause instanceof IdentityApiError && cause.code === 'SOCIAL_OAUTH_INVALID')
        setChoice(null);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  return (
    <Page
      eyebrow="Client portal"
      title="Social accounts"
      description="Connect your social accounts so your agency team can create, schedule and publish posts on them for you. You choose exactly which accounts to connect, and you can disconnect any of them at any time. Connecting does not let you publish from here or change your agency’s settings."
    >
      {unavailable ? (
        <Card className="text-center">
          <p className="text-sm text-app-muted">{UNAVAILABLE_TEXT}</p>
        </Card>
      ) : (
        <>
          {problem && (
            <div role="alert">
              <Notice error>{problem}</Notice>
              <div className="mt-2">
                <Button kind="secondary" onClick={() => setProblem('')}>
                  Try again
                </Button>
              </div>
            </div>
          )}
          {loadError && (
            <div role="alert">
              <Notice error>{loadError}</Notice>
              <div className="mt-2">
                <Button kind="secondary" onClick={() => void load()}>
                  Try again
                </Button>
              </div>
            </div>
          )}
          {completing && (
            <div role="status" aria-live="polite">
              <Notice>Finishing your connection… this takes a few seconds.</Notice>
              <Loading />
            </div>
          )}
          {choice && (
            <Card>
              <h2
                ref={choiceHeading}
                tabIndex={-1}
                className="font-display text-lg font-bold outline-none"
              >
                Choose the {PLATFORM_NAMES[choice.platform]} accounts to connect
              </h2>
              <p className="mt-1 text-sm text-app-muted">
                Tick only the accounts you want your agency to publish on. This choice
                stays open for {choice.expiresInMinutes} minutes.
              </p>
              <fieldset className="mt-3 space-y-2">
                <legend className="sr-only">Accounts you can connect</legend>
                {choice.candidates.map((candidate) => {
                  const reason = candidateReason(candidate);
                  const selectable = isSelectable(candidate);
                  const inputId = `social-candidate-${candidate.externalId}`;
                  return (
                    <label
                      key={candidate.externalId}
                      htmlFor={inputId}
                      className={`flex items-start gap-3 rounded-xl border border-app-border p-3 ${selectable ? 'cursor-pointer' : 'opacity-70'}`}
                    >
                      <input
                        id={inputId}
                        type="checkbox"
                        className="mt-1 size-4"
                        disabled={!selectable}
                        checked={picked.includes(candidate.externalId)}
                        onChange={() => toggle(candidate.externalId)}
                      />
                      <Avatar
                        name={candidate.name}
                        url={candidate.profileImageUrl}
                        platform={candidate.platform}
                      />
                      <span className="min-w-0">
                        <span className="block break-words text-sm font-semibold">
                          {candidate.name}
                        </span>
                        <span className="block text-xs text-app-muted">
                          {PLATFORM_NAMES[candidate.platform]}
                        </span>
                        {reason && (
                          <span className="mt-1 block text-xs text-app-muted">
                            {reason}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={() => void confirm()}
                  disabled={picked.length === 0 || saving}
                >
                  {saving
                    ? 'Connecting…'
                    : `Connect ${picked.length || ''} selected`.replace('  ', ' ')}
                </Button>
                <Button
                  kind="secondary"
                  disabled={saving}
                  onClick={() => {
                    setChoice(null);
                    setPicked([]);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </Card>
          )}

          {overview === null && !loadError ? (
            <Loading />
          ) : (
            overview && (
              <>
                <section className="space-y-3" aria-labelledby="social-connect-heading">
                  <h2
                    id="social-connect-heading"
                    className="border-b border-app-border pb-2 font-display text-lg font-bold"
                  >
                    Connect an account
                  </h2>
                  <div className="grid gap-3 md:grid-cols-2">
                    {overview.providers.map((provider) => (
                      <ProviderCard
                        key={provider.platform}
                        provider={provider}
                        busy={starting === provider.platform}
                        disabled={starting !== null || completing}
                        onConnect={() => void start(provider.platform)}
                      />
                    ))}
                  </div>
                </section>

                <section className="space-y-3" aria-labelledby="social-accounts-heading">
                  <h2
                    id="social-accounts-heading"
                    className="border-b border-app-border pb-2 font-display text-lg font-bold"
                  >
                    Your connected accounts
                  </h2>
                  {overview.accounts.length === 0 ? (
                    <Card className="text-center">
                      <p className="text-sm text-app-muted">
                        No accounts connected yet. Use “Connect” above to add one.
                      </p>
                    </Card>
                  ) : (
                    overview.accounts.map((account) => (
                      <AccountRow
                        key={account.id}
                        account={account}
                        disabled={starting !== null}
                        onReconnect={() =>
                          void start(account.platform as SocialPortalPlatform)
                        }
                        onDisconnect={() => setDisconnecting(account)}
                      />
                    ))
                  )}
                </section>
              </>
            )
          )}
        </>
      )}
      {disconnecting && clientId && (
        <DisconnectDialog
          clientId={clientId}
          account={disconnecting}
          onClose={() => setDisconnecting(null)}
          onDone={(message) => {
            setDisconnecting(null);
            toast.success(message, { duration: 8000 });
            void load();
          }}
        />
      )}
    </Page>
  );
}

function ProviderCard({
  provider,
  busy,
  disabled,
  onConnect,
}: {
  provider: SocialPortalProvider;
  busy: boolean;
  disabled: boolean;
  onConnect: () => void;
}): React.JSX.Element {
  const ready = provider.status === 'ready';
  const instagram = provider.platform === 'instagram';
  return (
    <Card>
      <div className="flex items-center gap-3">
        <Avatar name={provider.name} url={null} platform={provider.platform} />
        <h3 className="font-display text-base font-bold">{provider.name}</h3>
      </div>
      {instagram && (
        <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-semibold text-amber-700 dark:text-amber-300">
          Instagram must be a Business or Creator account linked to a Facebook Page. You
          sign in with Facebook, not Instagram.
        </p>
      )}
      {provider.requirements.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-app-muted">
          {provider.requirements.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {!ready && provider.message && (
        <p className="mt-3 text-sm text-app-muted">{provider.message}</p>
      )}
      <div className="mt-4">
        <Button
          onClick={onConnect}
          disabled={!ready || disabled}
          aria-label={`Connect ${provider.name}`}
        >
          {busy ? 'Opening…' : 'Connect'}
        </Button>
      </div>
    </Card>
  );
}

const BADGE = 'rounded-full border px-2.5 py-1 text-xs font-semibold';

function AccountRow({
  account,
  disabled,
  onReconnect,
  onDisconnect,
}: {
  account: SocialPortalAccount;
  disabled: boolean;
  onReconnect: () => void;
  onDisconnect: () => void;
}): React.JSX.Element {
  const label = PLATFORM_NAMES[account.platform] ?? account.platform;
  const agency = account.managedBy === 'agency';
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar
            name={account.name}
            url={account.profileImageUrl}
            platform={account.platform}
          />
          <div className="min-w-0">
            <p className="break-words text-sm font-semibold">{account.name}</p>
            <p className="text-xs text-app-muted">{label}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {agency && (
            <span
              className={`${BADGE} border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300`}
            >
              Managed by your agency
            </span>
          )}
          {account.status === 'connected' && (
            <span
              className={`${BADGE} border-app-accent/30 bg-app-accent/10 text-app-accent`}
            >
              Connected
            </span>
          )}
          {account.status === 'reconnect_required' && (
            <span
              className={`${BADGE} border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300`}
            >
              Needs reconnecting
            </span>
          )}
          {account.status === 'disconnected' && (
            <span
              className={`${BADGE} border-app-border bg-app-surface-raised text-app-muted`}
            >
              Disconnected
            </span>
          )}
        </div>
      </div>
      {account.status === 'reconnect_required' && !agency && account.lastError && (
        <p className="mt-2 text-sm text-app-muted">{account.lastError}</p>
      )}
      {!agency && (
        <div className="mt-3 flex flex-wrap gap-2">
          {account.status === 'reconnect_required' && (
            <Button
              onClick={onReconnect}
              disabled={disabled}
              aria-label={`Reconnect ${account.name} on ${label}`}
            >
              Reconnect
            </Button>
          )}
          {account.status === 'disconnected' && (
            <Button
              kind="secondary"
              onClick={onReconnect}
              disabled={disabled}
              aria-label={`Connect ${account.name} on ${label} again`}
            >
              Connect again
            </Button>
          )}
          {account.status !== 'disconnected' && (
            <Button
              kind="danger"
              onClick={onDisconnect}
              aria-label={`Disconnect ${account.name} on ${label}`}
            >
              Disconnect
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function DisconnectDialog({
  clientId,
  account,
  onClose,
  onDone,
}: {
  clientId: string;
  account: SocialPortalAccount;
  onClose: () => void;
  onDone: (message: string) => void;
}): React.JSX.Element {
  const [revoke, setRevoke] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = PLATFORM_NAMES[account.platform] ?? account.platform;
  const provider = accessProviderName(account.platform);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await disconnectSocialAccount(clientId, account.id, revoke);
      onDone(disconnectSummary(result, account.platform));
    } catch (cause) {
      setError(
        messageOf(cause, 'We couldn’t disconnect this account. Please try again.'),
      );
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Disconnect ${account.name}?`}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button kind="secondary" onClick={onClose} disabled={busy}>
            Keep connected
          </Button>
          <Button kind="danger" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm">
          Your agency will stop publishing to this {label} account, and any posts
          scheduled for it will be cancelled.
        </p>
        <div className="rounded-xl border border-app-border p-3">
          <label className="flex items-start gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={revoke}
              onChange={(event) => setRevoke(event.target.checked)}
            />
            <span>Also remove TapIt’s access on {provider}</span>
          </label>
          <p className="mt-2 text-xs text-app-muted">{revokeWarning(account.platform)}</p>
        </div>
        {error && (
          <div role="alert">
            <Notice error>{error}</Notice>
          </div>
        )}
      </div>
    </Modal>
  );
}
