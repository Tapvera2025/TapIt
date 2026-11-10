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
  SkeletonTable,
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

export function SocialAnalyticsPanel({
  clientId,
  timezone,
  canManage,
}: {
  clientId: string;
  timezone: string;
  canManage: boolean;
}): React.JSX.Element {
  const today = dateInZone(new Date().toISOString(), timezone);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [period, setPeriod] = useState({ from, to });
  const [data, setData] = useState<SocialAnalytics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);
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
  }, [clientId, period]);
  return (
    <div className="space-y-5">
      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (from > to) {
              setError('The start date must be before the end date.');
              return;
            }
            setPeriod({ from, to });
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <Field label="From" type="date" value={from} onChange={setFrom} required />
          <Field label="To" type="date" value={to} onChange={setTo} required />
          <Button type="submit" kind="secondary" disabled={loading}>
            Apply reporting period
          </Button>
          {canManage && (
            <Button
              kind="secondary"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                void syncSocialAnalytics(clientId, from, to)
                  .then(setData)
                  .catch((cause: unknown) =>
                    setError(
                      cause instanceof Error ? cause.message : 'Synchronization failed',
                    ),
                  )
                  .finally(() => setLoading(false));
              }}
            >
              Sync platform data
            </Button>
          )}
          <Button
            kind="secondary"
            disabled={loading || !data?.snapshots.length}
            onClick={() => {
              void downloadSocialAnalyticsCsv(clientId, period.from, period.to).catch(
                (cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : 'Export failed'),
              );
            }}
          >
            Export CSV
          </Button>
        </form>
        <p className="mt-4 text-xs leading-5 text-app-muted">
          Metrics come from each platform’s official API. Definitions and reporting
          periods can differ; compare matching sources and periods. No estimates are
          substituted for missing data.
        </p>
      </Card>
      {error && <Notice error>{error}</Notice>}
      {loading ? (
        <SkeletonTable columns={4} rows={5} />
      ) : (
        data && (
          <>
            {data.aggregates.length > 0 && (
              <Card>
                <h2 className="font-semibold">Per-platform aggregates</h2>
                <p className="mt-1 text-xs leading-5 text-app-muted">
                  Within each platform only. Metric definitions differ across
                  platforms, so no cross-platform totals are computed.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {data.aggregates.map((aggregate) => (
                    <div
                      key={aggregate.platform}
                      className="rounded-xl border border-app-border p-4"
                    >
                      <div className="flex items-center gap-2">
                        <PlatformMark platform={aggregate.platform} small />
                        <div>
                          <h3 className="text-sm font-semibold">
                            {PLATFORM_LABELS[aggregate.platform]}
                          </h3>
                          <p className="text-[11px] text-app-muted">
                            {aggregate.accountCount} account
                            {aggregate.accountCount === 1 ? '' : 's'}
                          </p>
                        </div>
                      </div>
                      {aggregate.latestAccountMetrics.length > 0 && (
                        <div className="mt-3">
                          <p className="text-[11px] font-semibold uppercase text-app-muted">
                            Latest account counters
                          </p>
                          <ul className="mt-1 space-y-1 text-sm">
                            {aggregate.latestAccountMetrics.map((metric) => (
                              <li
                                key={`account:${metric.key}`}
                                className="flex items-baseline justify-between gap-2"
                              >
                                <span className="truncate">{metric.label}</span>
                                <span className="font-semibold tabular-nums">
                                  {metric.value.toLocaleString()}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {aggregate.postMetricTotals.length > 0 && (
                        <div className="mt-3">
                          <p className="text-[11px] font-semibold uppercase text-app-muted">
                            Post metric totals
                          </p>
                          <ul className="mt-1 space-y-1 text-sm">
                            {aggregate.postMetricTotals.map((metric) => (
                              <li
                                key={`post:${metric.key}`}
                                className="flex items-baseline justify-between gap-2"
                              >
                                <span className="truncate">
                                  {metric.label}{' '}
                                  <span className="text-[11px] text-app-muted">
                                    ({metric.postCount} post
                                    {metric.postCount === 1 ? '' : 's'})
                                  </span>
                                </span>
                                <span className="font-semibold tabular-nums">
                                  {metric.value.toLocaleString()}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <p className="mt-3 text-[11px] text-app-muted">{aggregate.note}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            {data.snapshots.length ? (
              data.snapshots.map((snapshot) => (
                <Card key={snapshot.id}>
                  <div className="flex flex-wrap items-center gap-3">
                    <PlatformMark platform={snapshot.platform} />
                    <div>
                      <h2 className="font-semibold">{snapshot.accountName}</h2>
                      <p className="mt-1 text-xs text-app-muted">
                        {PLATFORM_LABELS[snapshot.platform]} ·{' '}
                        {snapshot.periodStart.slice(0, 10)} to{' '}
                        {snapshot.periodEnd.slice(0, 10)}
                      </p>
                    </div>
                    <p className="ml-auto text-[11px] text-app-muted">
                      Synced {socialDate(snapshot.syncedAt, timezone)}
                    </p>
                  </div>
                  <div className="mt-3 space-y-2">
                    {snapshot.postId && (
                      <p className="text-sm font-semibold">
                        Post performance · {snapshot.caption || snapshot.postId}
                      </p>
                    )}
                    {snapshot.note && (
                      <p className="text-xs leading-5 text-app-muted">{snapshot.note}</p>
                    )}
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {snapshot.metrics.map((metric) => (
                      <div
                        key={metric.key}
                        className="rounded-xl bg-app-surface-raised p-4"
                      >
                        <h3 className="text-xs text-app-muted">{metric.label}</h3>
                        <p className="mt-2 text-2xl font-semibold">
                          {metric.value.toLocaleString()}
                          {metric.unit ? (
                            <span className="ml-1 text-sm text-app-muted">
                              {metric.unit}
                            </span>
                          ) : null}
                        </p>
                      </div>
                    ))}
                  </div>
                  {snapshot.series.length > 0 && (
                    <details className="mt-4">
                      <summary className="cursor-pointer text-sm font-semibold">
                        Daily engagement and performance
                      </summary>
                      <div className="mt-3 max-h-72 overflow-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr>
                              <th className="p-2">Date</th>
                              <th className="p-2">Native metric</th>
                              <th className="p-2">Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {snapshot.series.map((point, index) => (
                              <tr key={index}>
                                <td className="p-2">{point.date}</td>
                                <td className="p-2">
                                  {point.metric.replaceAll('_', ' ')}
                                </td>
                                <td className="p-2">{point.value.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
                </Card>
              ))
            ) : (
              <Card>
                <SocialEmpty
                  title="No platform metrics available for this period"
                  description="Analytics appear after a connected account grants the required permissions and the backend completes a supported synchronization."
                />
              </Card>
            )}
            {data.unavailable.length > 0 && (
              <Card>
                <h2 className="text-sm font-semibold">Metric availability</h2>
                <div className="mt-3 space-y-3">
                  {data.unavailable.map((item) => (
                    <div
                      key={`${item.accountId}:${item.platform}`}
                      className="flex items-start gap-2"
                    >
                      <PlatformMark platform={item.platform} small />
                      <p className="text-xs leading-5 text-app-muted">{item.reason}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )
      )}
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
