import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card, Modal, Notice, Page, SkeletonPage } from '../ui/index.js';
import { Icon } from '../ui/index.js';
import { APP_NAVIGATE_EVENT } from '../navigationEvent.js';
import {
  completeSocialConnection,
  getSocialClient,
  getSocialPost,
  getSocialSettings,
  listSocialAccounts,
  listSocialClients,
  listSocialProviders,
  selectSocialAccounts,
  type SocialConnectionCandidate,
} from './api.js';
import { ClientSelector } from './ClientSelector.js';
import { CompanyConnections } from './CompanyConnections.js';
import { Composer } from './Composer.js';
import { Planner } from './Planner.js';
import { PostDetails } from './PostDetails.js';
import { PlatformMark, SocialEmpty } from './presentation.js';
import {
  ConnectedAccounts,
  SocialAnalyticsPanel,
  SocialOverview,
  SocialSettingsPanel,
} from './SocialPanels.js';
import {
  PLATFORM_LABELS,
  type SocialAccount,
  type SocialClient,
  type SocialPlatform,
  type SocialPost,
  type SocialProvider,
  type SocialSettings,
} from './types.js';

const sections = [
  { id: 'overview', label: 'Overview', icon: 'grid' },
  { id: 'planner', label: 'Social Planner', icon: 'layers' },
  { id: 'calendar', label: 'Content Calendar', icon: 'calendar' },
  { id: 'create', label: 'Create Post', icon: 'plus' },
  { id: 'drafts', label: 'Drafts & Scheduled', icon: 'clock' },
  { id: 'published', label: 'Published Posts', icon: 'check' },
  { id: 'approvals', label: 'Approvals', icon: 'shield' },
  { id: 'analytics', label: 'Analytics', icon: 'chart' },
  { id: 'accounts', label: 'Connected Accounts', icon: 'share' },
  // Company-wide, not per client: shown only to people who manage integrations.
  { id: 'connections', label: 'Company connections', icon: 'building' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
] as const;

interface AccountSelection {
  clientId: string;
  platform: SocialPlatform;
  state: string;
  candidates: SocialConnectionCandidate[];
}

export function SocialWorkspace({
  pathname,
  onNavigate,
  canManage,
  canApprove,
  canConnect,
  canPublish,
  canSettings,
  canManageIntegrations,
}: {
  pathname: string;
  onNavigate: (path: string) => void;
  canManage: boolean;
  canApprove: boolean;
  canConnect: boolean;
  canPublish: boolean;
  canSettings: boolean;
  /** Connect the company's own Google account and assign its locations to clients. */
  canManageIntegrations: boolean;
}): React.JSX.Element {
  const sectionPart =
    pathname.replace(/^\/company\/social\/?/, '').split('/')[0] || 'overview';
  const section =
    sections.some((item) => item.id === sectionPart) &&
    (sectionPart !== 'connections' || canManageIntegrations)
      ? sectionPart
      : 'overview';
  const [client, setClient] = useState<SocialClient | null>(null);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [providers, setProviders] = useState<SocialProvider[]>([]);
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [post, setPost] = useState<SocialPost | null>(null);
  const [editing, setEditing] = useState<SocialPost | null>(null);
  const [accountSelection, setAccountSelection] = useState<AccountSelection | null>(null);
  const [selectedExternalIds, setSelectedExternalIds] = useState<string[]>([]);
  const [accountSearch, setAccountSearch] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [selectionError, setSelectionError] = useState('');
  const oauthHandled = useRef(false);
  const selectedClientId = useRef<string | null>(null);
  selectedClientId.current = client?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    const requestedId = new URLSearchParams(window.location.search).get('clientId');
    void Promise.all([
      listSocialProviders(),
      requestedId
        ? getSocialClient(requestedId)
        : listSocialClients().then((result) => result.items[0] ?? null),
    ])
      .then(([nextProviders, nextClient]) => {
        if (cancelled) return;
        setProviders(nextProviders);
        setClient((current) => current ?? nextClient);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : 'Unable to load social workspaces.',
          );
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const selectFromLocation = () => {
      const id = new URLSearchParams(window.location.search).get('clientId');
      if (!id || id === selectedClientId.current) return;
      void getSocialClient(id)
        .then(setClient)
        .catch((cause) =>
          setError(
            cause instanceof Error ? cause.message : 'Unable to open client workspace.',
          ),
        );
    };
    window.addEventListener('popstate', selectFromLocation);
    window.addEventListener(APP_NAVIGATE_EVENT, selectFromLocation);
    return () => {
      window.removeEventListener('popstate', selectFromLocation);
      window.removeEventListener(APP_NAVIGATE_EVENT, selectFromLocation);
    };
  }, []);

  useEffect(() => {
    if (oauthHandled.current || !window.location.hash.startsWith('#social-oauth='))
      return;
    // A company-wide sign-in returns to Company connections, which completes it.
    if (window.location.pathname.startsWith('/company/social/connections')) return;
    oauthHandled.current = true;
    const raw = window.location.hash.slice('#social-oauth='.length);
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${window.location.search}`,
    );
    setConnecting(true);
    async function complete(): Promise<void> {
      try {
        const payload = JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>;
        if (typeof payload['error'] === 'string')
          throw new Error(
            typeof payload['message'] === 'string'
              ? payload['message']
              : 'The platform did not authorize this connection.',
          );
        const clientId = payload['clientId'];
        const platform = payload['platform'];
        const code = payload['code'];
        const state = payload['state'];
        if (
          typeof clientId !== 'string' ||
          typeof platform !== 'string' ||
          !(platform in PLATFORM_LABELS) ||
          typeof code !== 'string' ||
          typeof state !== 'string'
        )
          throw new Error('The platform returned an incomplete authorization response.');
        const [choice, selectedClient] = await Promise.all([
          completeSocialConnection(clientId, platform as SocialPlatform, code, state),
          getSocialClient(clientId),
        ]);
        setClient(selectedClient);
        setSelectedExternalIds([]);
        setSelectionError('');
        setAccountSearch('');
        setAccountSelection({
          ...choice,
          clientId,
          platform: platform as SocialPlatform,
        });
        onNavigate(`/company/social/accounts?clientId=${encodeURIComponent(clientId)}`);
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : 'Account authorization failed.';
        setError(message);
        toast.error(message);
      } finally {
        setConnecting(false);
      }
    }
    void complete();
  }, [onNavigate]);

  useEffect(() => {
    let cancelled = false;
    setAccounts([]);
    setSettings(null);
    setPost(null);
    setEditing(null);
    if (!client) return;
    setLoading(true);
    setError('');
    void Promise.all([listSocialAccounts(client.id), getSocialSettings(client.id)])
      .then(([nextAccounts, nextSettings]) => {
        if (!cancelled) {
          setAccounts(nextAccounts);
          setSettings(nextSettings);
        }
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load this client’s social workspace.',
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, revision]);

  function navigate(next: string, clientId = client?.id): void {
    onNavigate(
      `/company/social${next === 'overview' ? '' : `/${next}`}${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`,
    );
  }
  function chooseClient(next: SocialClient): void {
    setClient(next);
    setPost(null);
    setEditing(null);
    navigate(section, next.id);
  }
  function changed(): void {
    setPost(null);
    setEditing(null);
    setRevision((value) => value + 1);
  }
  function create(): void {
    setEditing(null);
    navigate('create');
  }
  async function openPost(next: SocialPost): Promise<void> {
    const expectedClientId = next.clientId;
    try {
      const detail = await getSocialPost(expectedClientId, next.id);
      if (selectedClientId.current === expectedClientId) setPost(detail);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Unable to load post details.',
      );
    }
  }
  async function confirmAccounts(): Promise<void> {
    if (!accountSelection) return;
    setConnecting(true);
    setSelectionError('');
    try {
      await selectSocialAccounts(
        accountSelection.clientId,
        accountSelection.platform,
        accountSelection.state,
        selectedExternalIds,
      );
      setAccountSelection(null);
      setSelectedExternalIds([]);
      changed();
      toast.success('Selected accounts connected');
    } catch (cause) {
      setSelectionError(
        cause instanceof Error
          ? cause.message
          : 'Unable to connect the selected accounts.',
      );
    } finally {
      setConnecting(false);
    }
  }

  const title = sections.find((item) => item.id === section)?.label ?? 'Overview';
  return (
    <Page
      eyebrow="Manage Social Media"
      title={title}
      description="Plan, review and publish content for every client from one workspace."
      action={
        canManage && section !== 'create' && section !== 'connections' ? (
          <Button onClick={create} disabled={!client}>
            <Icon name="plus" className="mr-2 inline size-4" />
            Create post
          </Button>
        ) : undefined
      }
    >
      {section !== 'connections' && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <ClientSelector selected={client} onSelect={chooseClient} />
          {settings && (
            <p className="text-xs text-app-muted">
              <Icon name="clock" className="mr-1 inline size-3.5" />
              {settings.timezone}
              {settings.approvalRequired ? ' · Approval required' : ''}
            </p>
          )}
        </div>
      )}
      <nav
        aria-label="Social media sections"
        className="flex gap-1 overflow-x-auto border-b border-app-border pb-2"
      >
        {sections
          .filter(
            (item) =>
              (item.id !== 'create' || canManage) &&
              (item.id !== 'connections' || canManageIntegrations),
          )
          .map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.id)}
              aria-current={section === item.id ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold transition ${section === item.id ? 'bg-app-accent/10 text-app-accent' : 'text-app-muted hover:bg-app-surface-raised hover:text-app-foreground'}`}
            >
              <Icon name={item.icon} className="size-4" />
              {item.label}
            </button>
          ))}
      </nav>
      {error && (
        <Notice error>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button
              kind="secondary"
              onClick={() => {
                if (!client) window.location.reload();
                else changed();
              }}
            >
              Try again
            </Button>
          </div>
        </Notice>
      )}
      {connecting && !accountSelection && (
        <Notice>Completing platform authorization…</Notice>
      )}
      {section === 'connections' ? (
        <CompanyConnections providers={providers} onChanged={changed} />
      ) : initializing || loading ? (
        <SkeletonPage cards={3} rows={3} />
      ) : !client ? (
        <Card>
          <SocialEmpty
            title="Select a CRM client"
            description="Choose a client above to open their social workspace. Clients are managed in the CRM’s existing Clients section."
          />
        </Card>
      ) : settings ? (
        <>
          {section === 'overview' && (
            <SocialOverview
              clientId={client.id}
              accounts={accounts}
              timezone={settings.timezone}
              revision={revision}
              onPost={(next) => void openPost(next)}
              onCreate={create}
              onAccounts={() => navigate('accounts')}
              canManage={canManage}
            />
          )}
          {['planner', 'calendar', 'drafts', 'published', 'approvals'].includes(
            section,
          ) && (
            <Planner
              key={`${client.id}:${section}`}
              clientId={client.id}
              clientName={client.businessName || client.clientName}
              timezone={settings.timezone}
              section={section}
              canManage={canManage}
              canPublish={canPublish}
              onPost={(next) => void openPost(next)}
              onCreate={create}
              revision={revision}
            />
          )}
          {section === 'create' &&
            (canManage ? (
              <Composer
                key={`${client.id}:${editing?.id ?? 'new'}`}
                clientId={client.id}
                accounts={accounts}
                settings={settings}
                {...(editing ? { post: editing } : {})}
                canPublish={canPublish}
                onSaved={() => {
                  changed();
                  navigate('planner');
                }}
                onAccounts={() => navigate('accounts')}
              />
            ) : (
              <Notice error>
                Your role does not have permission to create social posts.
              </Notice>
            ))}
          {section === 'accounts' && (
            <ConnectedAccounts
              clientId={client.id}
              clientName={client.businessName || client.clientName}
              accounts={accounts}
              providers={providers}
              canConnect={canConnect}
              canManageIntegrations={canManageIntegrations}
              onCompanyConnections={() => navigate('connections')}
              onChanged={changed}
            />
          )}
          {section === 'analytics' && (
            <SocialAnalyticsPanel
              key={client.id}
              clientId={client.id}
              timezone={settings.timezone}
              canManage={canManage}
            />
          )}
          {section === 'settings' && (
            <SocialSettingsPanel
              key={client.id}
              clientId={client.id}
              settings={settings}
              canSettings={canSettings}
              onSaved={setSettings}
            />
          )}
        </>
      ) : null}
      {post && settings && post.clientId === client?.id && (
        <PostDetails
          key={post.id}
          post={post}
          timezone={settings.timezone}
          canManage={canManage}
          canApprove={canApprove}
          canPublish={canPublish}
          onClose={() => setPost(null)}
          onChanged={changed}
          onEdit={(next) => {
            setPost(null);
            setEditing(next);
            navigate('create');
          }}
        />
      )}
      {accountSelection && (
        <Modal
          title="Choose accounts for this client"
          size="lg"
          dirty={false}
          onClose={() => {
            if (!connecting) setAccountSelection(null);
          }}
        >
          <div className="space-y-4">
            <p className="text-sm leading-6 text-app-muted">
              Choose only the {PLATFORM_LABELS[accountSelection.platform]} accounts that
              belong to{' '}
              <strong className="text-app-foreground">
                {client?.businessName || client?.clientName || 'this client'}
              </strong>
              . This authorization expires after 10 minutes.
            </p>
            {selectionError && <Notice error>{selectionError}</Notice>}
            {accountSelection.candidates.length ? (
              <div className="space-y-2">
                <input
                  type="search"
                  placeholder="Search accounts…"
                  value={accountSearch}
                  onChange={(event) => setAccountSearch(event.target.value)}
                  disabled={connecting}
                  className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm placeholder:text-app-muted focus:outline-none focus:ring-2 focus:ring-app-accent disabled:opacity-50"
                />
                <div className="flex items-center justify-between pb-1">
                  <span className="text-xs text-app-muted">
                    {selectedExternalIds.length} of {accountSelection.candidates.length} selected
                  </span>
                  <button
                    type="button"
                    disabled={connecting}
                    className="text-xs font-medium text-app-accent hover:underline disabled:opacity-50"
                    onClick={() =>
                      setSelectedExternalIds(
                        selectedExternalIds.length === accountSelection.candidates.length
                          ? []
                          : accountSelection.candidates.map((c) => c.externalId),
                      )
                    }
                  >
                    {selectedExternalIds.length === accountSelection.candidates.length
                      ? 'Deselect all'
                      : 'Select all'}
                  </button>
                </div>
                {accountSelection.candidates
                  .filter((c) =>
                    accountSearch.trim() === '' ||
                    c.name.toLowerCase().includes(accountSearch.toLowerCase()) ||
                    c.externalId.toLowerCase().includes(accountSearch.toLowerCase()),
                  )
                  .map((candidate) => (
                  <label
                    key={candidate.externalId}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-app-border p-3"
                  >
                    <input
                      type="checkbox"
                      disabled={connecting}
                      checked={selectedExternalIds.includes(candidate.externalId)}
                      onChange={(event) =>
                        setSelectedExternalIds((current) =>
                          event.target.checked
                            ? [...current, candidate.externalId]
                            : current.filter((id) => id !== candidate.externalId),
                        )
                      }
                    />
                    <PlatformMark platform={candidate.platform} small />
                    <span>
                      <span className="block text-sm font-semibold">
                        {candidate.name}
                      </span>
                      <span className="text-xs text-app-muted">
                        {candidate.externalId}
                      </span>
                    </span>
                  </label>
                ))}
                {accountSearch.trim() !== '' &&
                  !accountSelection.candidates.some(
                    (c) =>
                      c.name.toLowerCase().includes(accountSearch.toLowerCase()) ||
                      c.externalId.toLowerCase().includes(accountSearch.toLowerCase()),
                  ) && (
                    <p className="py-4 text-center text-sm text-app-muted">
                      No accounts match "{accountSearch}"
                    </p>
                  )}
              </div>
            ) : (
              <Notice>
                No eligible accounts were returned. Check that you authorized the expected
                platform account and granted the required permissions.
              </Notice>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={connecting || !selectedExternalIds.length}
                onClick={() => void confirmAccounts()}
              >
                {connecting
                  ? 'Connecting…'
                  : `Connect ${selectedExternalIds.length || ''} selected account${selectedExternalIds.length === 1 ? '' : 's'}`}
              </Button>
              <Button
                kind="secondary"
                disabled={connecting}
                onClick={() => setAccountSelection(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Page>
  );
}
