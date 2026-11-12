import { PLATFORM_LABELS, SOCIAL_COMPANY_PLATFORMS } from './types.js';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button,
  Card,
  Field,
  Modal,
  Notice,
  SkeletonMetric,
} from '../ui/index.js';
import { Icon } from '../ui/index.js';
import {
  disconnectSocialAccount,
  downloadSocialAnalyticsCsv,
  getSocialAnalytics,
  listSocialPosts,
  startSocialConnection,
  updateSocialSettings,
  syncSocialAnalytics,
} from './api.js';
import { AssignLocationModal } from './CompanyConnections.js';
import { sectionStatusQuery } from './planner-model.js';
import {
  dateInZone,
  PlatformMark,
  PostStatus,
  SocialEmpty,
  socialDate,
} from './presentation.js';
import type {
  SocialAccount,
  SocialAnalytics,
  SocialPost,
  SocialProvider,
  SocialPlatform,
  SocialSettings,
} from './types.js';

export function ConnectedAccounts({
  clientId,
  clientName,
  accounts,
  providers,
  canConnect,
  canManageIntegrations,
  onCompanyConnections,
  onChanged,
}: {
  clientId: string;
  clientName: string;
  accounts: SocialAccount[];
  providers: SocialProvider[];
  canConnect: boolean;
  /** May assign what the company's logins manage to clients. */
  canManageIntegrations: boolean;
  onCompanyConnections: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [revokeGrant, setRevokeGrant] = useState(false);
  const [disconnect, setDisconnect] = useState<SocialAccount | null>(null);
  const [assigning, setAssigning] = useState(false);
  const companyPlatform = providers.some((item) =>
    SOCIAL_COMPANY_PLATFORMS.some((platform) => platform === item.platform),
  );
  async function connect(provider: SocialProvider): Promise<void> {
    setBusy(provider.platform);
    setError('');
    try {
      const result = await startSocialConnection(clientId, provider.platform);
      const authorizationUrl = new URL(result.authorizationUrl);
      if (authorizationUrl.protocol !== 'https:')
        throw new Error('The platform returned an invalid authorization URL.');
      window.location.assign(authorizationUrl.href);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to start account authorization.',
      );
      setBusy('');
    }
  }
  async function confirmDisconnect(): Promise<void> {
    if (!disconnect) return;
    setBusy(disconnect.id);
    setError('');
    try {
      const company = disconnect.connectionScope === 'company';
      const result = await disconnectSocialAccount(
        clientId,
        disconnect.id,
        !company && revokeGrant,
      );
      if (result.revocationStatus === 'remove_access_in_platform_settings')
        toast(
          'Local access removed. Remove the app in the platform settings to revoke the full grant.',
        );
      setDisconnect(null);
      toast.success(company ? 'Unassigned from this client' : 'Account disconnected');
      onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to disconnect this account.',
      );
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="space-y-5">
      {error && <Notice error>{error}</Notice>}
      <Card>
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-app-accent/10 text-app-accent">
            <Icon name="share" />
          </span>
          <div>
            <h2 className="font-semibold">Connect this client’s social accounts</h2>
            <p className="mt-1 text-sm text-app-muted">
              Authorize through the platform. Choose which Pages, profiles or channels
              belong to this client.
            </p>
          </div>
        </div>
      </Card>
      {companyPlatform && (
        <Card>
          <div className="flex flex-wrap items-center gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-app-accent/10 text-app-accent">
              <Icon name="building" />
            </span>
            <div className="min-w-48 flex-1">
              <h3 className="font-semibold">Through your company logins</h3>
              <p className="mt-1 text-xs leading-5 text-app-muted">
                {canManageIntegrations
                  ? 'Assign a Page, Instagram account, Business Profile, LinkedIn page, YouTube channel or Search Console property one of your company’s logins manages. This client does not need to sign in.'
                  : 'Your company admin can assign this client’s Pages, profiles and channels from the company’s logins.'}
              </p>
            </div>
            {canManageIntegrations && (
              <div className="flex flex-wrap gap-2">
                <Button disabled={Boolean(busy)} onClick={() => setAssigning(true)}>
                  Assign from a company login
                </Button>
                <Button kind="secondary" onClick={onCompanyConnections}>
                  Company connections
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {providers.map((provider) => (
          <Card key={provider.platform}>
            <div className="flex items-center gap-3">
              <PlatformMark platform={provider.platform} />
              <div>
                <h3 className="font-semibold">{provider.name}</h3>
                <span
                  className={`text-xs ${provider.status === 'ready' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-200'}`}
                >
                  {provider.status === 'ready'
                    ? 'Ready to connect'
                    : provider.status === 'pending_approval'
                      ? 'Pending API approval'
                      : 'Setup required'}
                </span>
              </div>
            </div>
            <p className="mt-4 min-h-14 text-xs leading-5 text-app-muted">
              {provider.message}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-app-muted">
              {provider.capabilities.publishText && (
                <span className="rounded bg-app-surface-raised px-2 py-1">Text</span>
              )}
              {provider.capabilities.publishImages && (
                <span className="rounded bg-app-surface-raised px-2 py-1">Images</span>
              )}
              {provider.capabilities.publishVideo && (
                <span className="rounded bg-app-surface-raised px-2 py-1">Video</span>
              )}
              {(provider.capabilities.accountInsights ||
                provider.capabilities.postInsights) && (
                <span className="rounded bg-app-surface-raised px-2 py-1">Insights</span>
              )}
            </div>
            <Button
              className="mt-5 w-full"
              kind="secondary"
              disabled={!canConnect || provider.status !== 'ready' || Boolean(busy)}
              onClick={() => void connect(provider)}
            >
              {busy === provider.platform ? 'Opening authorization…' : 'Connect account'}
            </Button>
          </Card>
        ))}
      </div>
      <Card>
        <h2 className="font-semibold">Connected accounts</h2>
        {accounts.length ? (
          <div className="mt-4 divide-y divide-app-border">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex flex-wrap items-center gap-3 py-4 first:pt-0 last:pb-0"
              >
                {account.profileImageUrl ? (
                  <img
                    src={account.profileImageUrl}
                    alt=""
                    className="size-11 rounded-full object-cover"
                  />
                ) : (
                  <PlatformMark platform={account.platform} />
                )}
                <div className="min-w-32 flex-1">
                  <h3 className="text-sm font-semibold">{account.name}</h3>
                  <p className="mt-1 text-xs text-app-muted">
                    Connected {new Date(account.connectedAt).toLocaleDateString('en-IN')}
                    {account.connectionScope === 'company'
                      ? ' · through a company login'
                      : ''}
                  </p>
                  <p className="mt-1 text-[11px] text-app-muted">
                    Permissions:{' '}
                    {account.scopes.length
                      ? account.scopes.join(', ')
                      : 'Provider authorization'}
                  </p>
                  <p className="mt-1 text-[11px] text-app-muted">
                    Capabilities:{' '}
                    {account.capabilities.length
                      ? account.capabilities
                          .map(
                            (capability) =>
                              ({
                                publishText: 'Text posts',
                                publishImages: 'Images',
                                publishVideo: 'Video',
                                accountInsights: 'Account analytics',
                                postInsights: 'Post analytics',
                              })[capability] ?? capability,
                          )
                          .join(', ')
                      : 'See platform configuration'}
                  </p>
                  {account.lastError && (
                    <p className="mt-1 max-w-lg text-xs text-app-danger">
                      {account.lastError}
                    </p>
                  )}
                </div>
                <PostStatus status={account.status} />
                {canConnect && (
                  <div className="flex gap-2">
                    {account.status === 'reconnect_required' &&
                      (account.connectionScope === 'company' ? (
                        // The company sign-in is reconnected once, for every client.
                        canManageIntegrations && (
                          <Button
                            kind="secondary"
                            disabled={Boolean(busy)}
                            onClick={onCompanyConnections}
                          >
                            Reconnect company login
                          </Button>
                        )
                      ) : (
                        <Button
                          kind="secondary"
                          disabled={Boolean(busy)}
                          onClick={() => {
                            const provider = providers.find(
                              (item) => item.platform === account.platform,
                            );
                            if (provider) void connect(provider);
                          }}
                        >
                          Reconnect
                        </Button>
                      ))}
                    {account.status !== 'disconnected' && (
                      <Button
                        kind="danger"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          setRevokeGrant(false);
                          setDisconnect(account);
                        }}
                      >
                        {account.connectionScope === 'company' ? 'Unassign' : 'Disconnect'}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <SocialEmpty
            title="No connected accounts yet"
            description="Use a configured platform above to authorize this client’s account. Credentials and API approval must be configured by your CRM administrator."
          />
        )}
      </Card>
      {disconnect && disconnect.connectionScope === 'company' && (
        <Modal
          title="Unassign from this client"
          onClose={() => setDisconnect(null)}
          dirty={false}
        >
          <p className="text-sm leading-6">
            Unassign {disconnect.name} from {clientName}? Scheduled posts to it are
            cancelled. The company login keeps working for your other clients.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              kind="danger"
              disabled={Boolean(busy)}
              onClick={() => void confirmDisconnect()}
            >
              Unassign
            </Button>
            <Button
              kind="secondary"
              disabled={Boolean(busy)}
              onClick={() => setDisconnect(null)}
            >
              Keep it
            </Button>
          </div>
        </Modal>
      )}
      {disconnect && disconnect.connectionScope !== 'company' && (
        <Modal
          title="Disconnect account"
          onClose={() => setDisconnect(null)}
          dirty={false}
        >
          <p className="text-sm leading-6">
            Disconnect {disconnect.name}? This removes the stored connection credentials.
            Unpublished posts using this account will require attention.
          </p>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={revokeGrant}
              onChange={(event) => setRevokeGrant(event.target.checked)}
            />
            <span>
              Also revoke platform access for this CRM app. This can disconnect other
              accounts and client workspaces using the same grant.
            </span>
          </label>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              kind="danger"
              disabled={Boolean(busy)}
              onClick={() => void confirmDisconnect()}
            >
              Disconnect account
            </Button>
            <Button
              kind="secondary"
              disabled={Boolean(busy)}
              onClick={() => setDisconnect(null)}
            >
              Keep connected
            </Button>
          </div>
        </Modal>
      )}
      {assigning && (
        <AssignLocationModal
          clientId={clientId}
          clientName={clientName}
          onClose={() => setAssigning(false)}
          onAssigned={() => {
            setAssigning(false);
            onChanged();
          }}
          onOpenConnections={() => {
            setAssigning(false);
            onCompanyConnections();
          }}
        />
      )}
    </div>
  );
}

export function SocialOverview({
  clientId,
  accounts,
  timezone,
  revision,
  onPost,
  onCreate,
  onAccounts,
  canManage,
}: {
  clientId: string;
  accounts: SocialAccount[];
  timezone: string;
  revision: number;
  onPost: (post: SocialPost) => void;
  onCreate: () => void;
  onAccounts: () => void;
  canManage: boolean;
}): React.JSX.Element {
  const [stats, setStats] = useState<{
    scheduled: number;
    approvals: number;
    published: number;
    recent: SocialPost[];
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setError('');
    void Promise.all([
      listSocialPosts(clientId, { status: 'scheduled', pageSize: '1' }),
      listSocialPosts(clientId, { status: 'pending_approval', pageSize: '1' }),
      // Counts what the Published section lists: partly published posts are out too.
      listSocialPosts(clientId, {
        status: sectionStatusQuery('published', ''),
        pageSize: '1',
      }),
      listSocialPosts(clientId, { pageSize: '5' }),
    ])
      .then(([scheduled, approvals, published, recent]) => {
        if (!cancelled)
          setStats({
            scheduled: scheduled.total,
            approvals: approvals.total,
            published: published.total,
            recent: recent.items,
          });
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : 'Unable to load workspace activity.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, revision]);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {!stats && !error
          ? Array.from({ length: 4 }, (_, index) => <SkeletonMetric key={index} />)
          : [
              {
                label: 'Connected accounts',
                value: accounts.filter((account) => account.status === 'connected')
                  .length,
                icon: 'share',
              },
              { label: 'Scheduled posts', value: stats?.scheduled, icon: 'calendar' },
              { label: 'Awaiting approval', value: stats?.approvals, icon: 'check' },
              { label: 'Published posts', value: stats?.published, icon: 'chart' },
            ].map((stat) => (
              <Card key={stat.label}>
                <div className="flex items-center justify-between text-app-muted">
                  <span className="text-xs font-semibold">{stat.label}</span>
                  <Icon name={stat.icon} className="size-4" />
                </div>
                <p className="mt-4 text-3xl font-bold tracking-tight">
                  {stat.value?.toLocaleString() ?? '—'}
                </p>
              </Card>
            ))}
      </div>
      {error && <Notice error>{error}</Notice>}
      {accounts.some((account) => account.status === 'reconnect_required') && (
        <Notice>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              A social account needs reconnection. Review it before your next scheduled
              post.
            </p>
            <Button kind="secondary" onClick={onAccounts}>
              Review accounts
            </Button>
          </div>
        </Notice>
      )}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Recent content</h2>
            <p className="mt-1 text-xs text-app-muted">
              Drafts, approvals and publishing activity for this client.
            </p>
          </div>
          {canManage && <Button onClick={onCreate}>Create post</Button>}
        </div>
        {stats?.recent.length ? (
          <div className="mt-5 divide-y divide-app-border">
            {stats.recent.map((post) => (
              <button
                key={post.id}
                type="button"
                onClick={() => onPost(post)}
                className="flex w-full flex-wrap items-center gap-3 py-4 text-left"
              >
                <div className="flex gap-1">
                  {post.destinations.map((destination) => (
                    <PlatformMark
                      key={destination.id}
                      platform={destination.platform}
                      small
                    />
                  ))}
                </div>
                <span className="min-w-32 flex-1">
                  <span className="line-clamp-1 text-sm font-semibold">
                    {post.caption || post.title || 'Media post'}
                  </span>
                  <span className="mt-1 block text-xs text-app-muted">
                    {socialDate(
                      post.scheduledAt ?? post.publishedAt ?? post.createdAt,
                      timezone,
                    )}
                  </span>
                </span>
                <PostStatus status={post.status} />
              </button>
            ))}
          </div>
        ) : (
          stats && (
            <SocialEmpty
              title="Your social workspace starts here"
              description="Connect this client’s accounts, create your first draft and plan content together."
              action={
                <Button kind="secondary" onClick={onAccounts}>
                  View connected accounts
                </Button>
              }
            />
          )
        )}
      </Card>
    </div>
  );
}

export function SocialPlatformAnalyticsPanel({
  clientId,
  timezone,
  canManage,
}: {
  clientId: string;
  timezone: string;
  canManage: boolean;
}): React.JSX.Element {
  const today = dateInZone(new Date().toISOString(), timezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [period, setPeriod] = useState({ from: monthStart, to: today });
  const [data, setData] = useState<SocialAnalytics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [activePlatform, setActivePlatform] = useState<'all' | SocialPlatform>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void getSocialAnalytics(clientId, period.from, period.to)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : 'Unable to load analytics.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, period, reloadKey]);

  const snapshots = (data?.snapshots ?? []).filter(
    (snapshot) => activePlatform === 'all' || snapshot.platform === activePlatform,
  );
  const unavailable = (data?.unavailable ?? []).filter(
    (item) => activePlatform === 'all' || item.platform === activePlatform,
  );
  const accountCount = data?.aggregates.reduce((sum, aggregate) => sum + aggregate.accountCount, 0) ?? 0;

  function applyPeriod(next: { from: string; to: string }): void {
    if (next.from > next.to) {
      setError('The start date must be before the end date.');
      return;
    }
    setError('');
    setFrom(next.from);
    setTo(next.to);
    setPeriod(next);
  }

  async function syncRange(): Promise<void> {
    if (from > to) {
      setError('The start date must be before the end date.');
      return;
    }
    setError('');
    if (period.from !== from || period.to !== to) setPeriod({ from, to });
    setSyncing(true);
    try {
      setData(await syncSocialAnalytics(clientId, from, to));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Synchronization failed.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-app-border/70 bg-gradient-to-br from-orange-50/70 via-app-surface to-sky-50/50 dark:from-orange-950/15 dark:via-app-surface dark:to-sky-950/15">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.18em] text-app-accent">SOCIAL PERFORMANCE</p>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-app-foreground sm:text-3xl">Channel analytics</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted">Review account health and post performance by platform. Each provider keeps its own metric definitions.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: '7 days', days: 7 },
              { label: '30 days', days: 30 },
              { label: '90 days', days: 90 },
              { label: 'Month to date', days: 0 },
            ].map((item) => {
              const end = today;
              const start = item.days === 0
                ? monthStart
                : (() => {
                    const date = new Date(`${end}T00:00:00Z`);
                    date.setUTCDate(date.getUTCDate() - (item.days - 1));
                    return date.toISOString().slice(0, 10);
                  })();
              const selected = period.from === start && period.to === end;
              return (
                <button key={item.label} type="button" onClick={() => applyPeriod({ from: start, to: end })} aria-pressed={selected} className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${selected ? 'border-app-accent bg-app-accent text-white' : 'border-app-border bg-app-surface/80 text-app-muted hover:border-app-accent/50 hover:text-app-accent'}`}>
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); applyPeriod({ from, to }); }} className="mt-5 flex flex-wrap items-end gap-3 border-t border-app-border/60 pt-4">
          <Field label="From" type="date" value={from} onChange={setFrom} required />
          <Field label="To" type="date" value={to} onChange={setTo} required />
          <Button type="submit" kind="secondary" disabled={loading || syncing}>Apply dates</Button>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button type="button" kind="secondary" disabled={loading || syncing} onClick={() => setReloadKey((key) => key + 1)}>
              <Icon name="refresh" className="mr-2 inline size-4" />Refresh
            </Button>
            {canManage && <Button type="button" kind="secondary" disabled={loading || syncing} onClick={() => void syncRange()}>
              <Icon name="refresh" className={`mr-2 inline size-4 ${syncing ? 'animate-spin' : ''}`} />{syncing ? 'Syncing…' : 'Sync channel data'}
            </Button>}
            <Button type="button" kind="secondary" disabled={loading || syncing || !data?.snapshots.length} onClick={() => {
              void downloadSocialAnalyticsCsv(clientId, period.from, period.to).catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : 'Export failed.'),
              );
            }}>
              <Icon name="download" className="mr-2 inline size-4" />Export CSV
            </Button>
          </div>
        </form>
        <p className="mt-3 text-[11px] leading-5 text-app-muted">Metrics come from each platform’s official API. Missing or unsupported metrics stay unavailable; totals are never combined across platforms.</p>
      </Card>

      {error && <Notice error><div className="flex flex-wrap items-center justify-between gap-3"><span>{error}</span><Button kind="secondary" onClick={() => setReloadKey((key) => key + 1)}>Try again</Button></div></Notice>}
      {loading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <SkeletonMetric key={index} />)}</div>
      ) : data ? (
        <>
          {loading && <p className="text-right text-[10px] font-semibold text-app-muted">Refreshing this period…</p>}

          <section aria-labelledby="social-channel-summary-title" className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-app-accent">BY NETWORK</p><h3 id="social-channel-summary-title" className="mt-1 font-display text-xl font-bold">Platform overview</h3></div>
              <button type="button" aria-pressed={activePlatform === 'all'} onClick={() => setActivePlatform('all')} className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${activePlatform === 'all' ? 'bg-app-accent/10 text-app-accent' : 'text-app-muted hover:bg-app-surface-raised'}`}>All platforms · {accountCount} accounts</button>
            </div>
            {data.aggregates.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.aggregates.map((aggregate) => {
                  const selected = activePlatform === aggregate.platform;
                  return (
                    <button key={aggregate.platform} type="button" aria-pressed={selected} onClick={() => setActivePlatform(selected ? 'all' : aggregate.platform)} className={`group rounded-2xl border bg-app-surface p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${selected ? 'border-app-accent ring-1 ring-app-accent/20' : 'border-app-border/80 hover:border-app-accent/45'}`}>
                      <div className="flex items-center gap-3">
                        <PlatformMark platform={aggregate.platform} />
                        <div className="min-w-0 flex-1"><h4 className="truncate text-sm font-bold">{PLATFORM_LABELS[aggregate.platform]}</h4><p className="mt-0.5 text-[11px] text-app-muted">{aggregate.accountCount} connected account{aggregate.accountCount === 1 ? '' : 's'}</p></div>
                        <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold ${selected ? 'bg-app-accent text-white' : 'bg-app-surface-raised text-app-muted'}`}>{selected ? 'Filtered' : 'View accounts'}</span>
                      </div>
                      {aggregate.latestAccountMetrics.length > 0 ? (
                        <div className="mt-4 grid grid-cols-2 gap-2">
                          {aggregate.latestAccountMetrics.slice(0, 4).map((metric) => (
                            <div key={`account:${metric.key}`} className="rounded-xl bg-app-background/75 px-3 py-2.5">
                              <p className="truncate text-[10px] font-medium text-app-muted">{metric.label}</p>
                              <p className="mt-1 truncate text-lg font-bold tabular-nums tracking-tight">{metric.value.toLocaleString()}</p>
                            </div>
                          ))}
                        </div>
                      ) : <p className="mt-4 rounded-xl border border-dashed border-app-border px-3 py-4 text-xs text-app-muted">No account counters returned.</p>}
                      {aggregate.postMetricTotals.length > 0 && (
                        <div className="mt-3 border-t border-app-border/70 pt-3">
                          <p className="text-[9px] font-bold uppercase tracking-wide text-app-muted">Post totals in this period</p>
                          <div className="mt-2 flex flex-wrap gap-2">{aggregate.postMetricTotals.slice(0, 3).map((metric) => <span key={`post:${metric.key}`} className="rounded-full bg-app-surface-raised px-2.5 py-1.5 text-[10px] text-app-muted"><strong className="text-app-foreground">{metric.value.toLocaleString()}</strong> {metric.label.toLowerCase()} · {metric.postCount} post{metric.postCount === 1 ? '' : 's'}</span>)}</div>
                        </div>
                      )}
                      <p className="mt-3 text-[10px] leading-4 text-app-muted">{aggregate.note}</p>
                    </button>
                  );
                })}
              </div>
            ) : <Card className="border-dashed"><p className="text-sm font-semibold">No platform summaries for this period.</p><p className="mt-1 text-xs text-app-muted">Sync connected channels with supported account-level metrics to populate this view.</p></Card>}
          </section>

          <section aria-labelledby="social-account-performance-title" className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-app-accent">ACCOUNT DETAIL</p><h3 id="social-account-performance-title" className="mt-1 font-display text-xl font-bold">Account performance</h3></div>
              <label className="text-[10px] font-semibold text-app-muted">Platform <select value={activePlatform} onChange={(event) => setActivePlatform(event.target.value as 'all' | SocialPlatform)} className="ml-2 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs text-app-foreground"><option value="all">All channels</option>{data.aggregates.map((aggregate) => <option key={aggregate.platform} value={aggregate.platform}>{PLATFORM_LABELS[aggregate.platform]}</option>)}</select></label>
            </div>
            {snapshots.length ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {snapshots.map((snapshot) => (
                  <Card key={snapshot.id} className="overflow-hidden p-0">
                    <div className="flex flex-wrap items-center gap-3 border-b border-app-border/70 bg-app-surface-raised/45 px-4 py-3.5 sm:px-5">
                      <PlatformMark platform={snapshot.platform} small />
                      <div className="min-w-0 flex-1"><h4 className="truncate text-sm font-bold">{snapshot.accountName}</h4><p className="mt-0.5 text-[10px] text-app-muted">{PLATFORM_LABELS[snapshot.platform]} · {snapshot.periodStart.slice(0, 10)} — {snapshot.periodEnd.slice(0, 10)}</p></div>
                      <span className="rounded-full border border-app-border bg-app-surface px-2.5 py-1 text-[9px] font-semibold text-app-muted">Synced {socialDate(snapshot.syncedAt, timezone)}</span>
                    </div>
                    <div className="p-4 sm:p-5">
                      {snapshot.postId && <div className="mb-3 rounded-xl bg-app-accent/[.06] px-3 py-2.5"><p className="text-[9px] font-bold uppercase tracking-wide text-app-accent">Post performance</p><p className="mt-1 truncate text-xs font-semibold" title={snapshot.caption || snapshot.postId}>{snapshot.caption || snapshot.postId}</p></div>}
                      {snapshot.note && <p className="mb-3 text-[11px] leading-5 text-app-muted">{snapshot.note}</p>}
                      {snapshot.metrics.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{snapshot.metrics.map((metric, index) => <div key={metric.key} className={`rounded-xl border px-3 py-3 ${index === 0 ? 'border-app-accent/25 bg-orange-50/50 dark:bg-orange-950/10' : 'border-app-border/70 bg-app-background/50'}`}><p className="truncate text-[10px] font-medium text-app-muted" title={metric.label}>{metric.label}</p><p className="mt-1.5 text-xl font-bold tabular-nums tracking-tight">{metric.value.toLocaleString()}{metric.unit ? <span className="ml-1 text-xs font-medium text-app-muted">{metric.unit}</span> : null}</p></div>)}</div> : <p className="rounded-xl border border-dashed border-app-border p-4 text-center text-xs text-app-muted">The provider returned no metrics for this account.</p>}
                      {snapshot.series.length > 0 && <details className="mt-4 group">
                        <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl border border-app-border/70 px-3 py-2.5 text-xs font-semibold hover:bg-app-surface-raised"><span>Daily performance · {snapshot.series.length} data points</span><span className="text-app-accent transition group-open:rotate-180">⌄</span></summary>
                        <div className="mt-2 max-h-64 overflow-auto rounded-xl border border-app-border/70">
                          <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-app-surface-raised text-[10px] uppercase tracking-wide text-app-muted"><tr><th className="px-3 py-2.5">Date</th><th className="px-3 py-2.5">Metric</th><th className="px-3 py-2.5 text-right">Value</th></tr></thead><tbody className="divide-y divide-app-border/60">{snapshot.series.map((point, index) => <tr key={`${point.date}:${point.metric}:${index}`}><td className="px-3 py-2.5">{point.date}</td><td className="px-3 py-2.5 capitalize">{point.metric.replaceAll('_', ' ')}</td><td className="px-3 py-2.5 text-right font-semibold tabular-nums">{point.value.toLocaleString()}</td></tr>)}</tbody></table>
                        </div>
                      </details>}
                    </div>
                  </Card>
                ))}
              </div>
            ) : <Card className="border-dashed"><p className="text-sm font-semibold">No account snapshots for this selection.</p><p className="mt-1 text-xs text-app-muted">Try another platform or reporting period, or sync channel data.</p></Card>}
          </section>

          {unavailable.length > 0 && (
            <Card className="border-amber-300/70 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/10">
              <div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300"><Icon name="alert-circle" className="size-4" /></span><div className="min-w-0"><h3 className="text-sm font-semibold">Some channel metrics are unavailable</h3><p className="mt-1 text-[11px] text-app-muted">These provider responses were not counted as zero.</p></div></div>
              <div className="mt-4 grid gap-2 md:grid-cols-2">{unavailable.map((item) => <div key={`${item.accountId}:${item.platform}`} className="flex min-w-0 items-start gap-2 rounded-xl border border-app-border/60 bg-app-surface/80 px-3 py-2.5"><PlatformMark platform={item.platform} small /><p className="text-xs leading-5 text-app-muted">{item.reason}</p></div>)}</div>
            </Card>
          )}
        </>
      ) : !loading && !error ? (
        <Card className="border-dashed"><SocialEmpty title="No social analytics yet" description="Connect a channel with analytics access, then sync its data for the reporting period." /></Card>
      ) : null}
    </div>
  );
}

export function SocialSettingsPanel({
  clientId,
  settings,
  canSettings,
  onSaved,
}: {
  clientId: string;
  settings: SocialSettings;
  canSettings: boolean;
  onSaved: (settings: SocialSettings) => void;
}): React.JSX.Element {
  const [timezone, setTimezone] = useState(settings.timezone);
  const [approvalRequired, setApprovalRequired] = useState(settings.approvalRequired);
  const [clientReviewEnabled, setClientReviewEnabled] = useState(
    settings.clientReviewEnabled,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      new Intl.DateTimeFormat('en-IN', { timeZone: timezone }).format();
      const updated = await updateSocialSettings(clientId, {
        clientId,
        timezone,
        approvalRequired,
        clientReviewEnabled,
      });
      toast.success('Social workspace settings saved');
      onSaved(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save settings.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <div className="max-w-2xl space-y-5">
        <div>
          <h2 className="font-semibold">Client workspace settings</h2>
          <p className="mt-1 text-sm text-app-muted">
            Set how content is reviewed and when it appears on the calendar.
          </p>
        </div>
        {error && <Notice error>{error}</Notice>}
        <Field
          label="Publishing timezone"
          value={timezone}
          onChange={setTimezone}
          disabled={!canSettings}
          placeholder="Asia/Kolkata"
          hint="Use an IANA timezone, such as Asia/Kolkata, Europe/London or America/New_York. Scheduled instants are stored in UTC."
        />
        <label className="flex items-start gap-3 rounded-xl border border-app-border p-4">
          <input
            type="checkbox"
            className="mt-1"
            checked={approvalRequired}
            disabled={!canSettings}
            onChange={(event) => setApprovalRequired(event.target.checked)}
          />
          <span>
            <span className="block text-sm font-semibold">
              Require approval before publishing
            </span>
            <span className="mt-1 block text-xs leading-5 text-app-muted">
              An authorized reviewer must approve content before it can be scheduled or
              published. New or revised content must be reviewed before publishing.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-xl border border-app-border p-4">
          <input
            type="checkbox"
            className="mt-1"
            checked={clientReviewEnabled}
            disabled={!canSettings}
            onChange={(event) => setClientReviewEnabled(event.target.checked)}
          />
          <span>
            <span className="block text-sm font-semibold">
              Allow the existing client login to review content
            </span>
            <span className="mt-1 block text-xs leading-5 text-app-muted">
              The client can view this workspace and approve or request changes to their
              own content using their existing CRM account. They cannot connect accounts
              or publish posts.
            </span>
          </span>
        </label>
        {canSettings ? (
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save settings'}
          </Button>
        ) : (
          <p className="text-xs text-app-muted">
            Your role can view these settings. Ask an administrator to change them.
          </p>
        )}
        <div className="border-t border-app-border pt-5">
          <h3 className="text-sm font-semibold">Platform application setup</h3>
          <p className="mt-2 text-xs leading-6 text-app-muted">
            Developer applications, encryption keys, redirect URLs and platform approval
            status are managed through the CRM server’s environment configuration.
            Connection readiness appears under Connected Accounts.
          </p>
        </div>
      </div>
    </Card>
  );
}
