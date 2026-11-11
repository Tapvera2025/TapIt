import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Field, Icon, Modal, Notice, Page, SearchableSelect, Select, Skeleton } from '../../../ui/index.js';
import {
  connectProvider,
  disconnectProvider,
  getAgents,
  getConnections,
  getEmployeeOptions,
  getSyncRuns,
  mapAgent,
  rematchAgents,
  syncConnection,
  testConnection,
  updateConnection,
  type ConnectionsPayload,
  type CredentialsInput,
  type EmployeeOption,
  type SyncRun,
  type TelephonyAgent,
  type TelephonyConnection,
  type TelephonyProvider,
} from './api.js';
import {
  CONNECTION_STATUS_LABELS,
  connectionTone,
  formatPhone,
  MATCH_LABELS,
  PROVIDER_NAMES,
  SYNC_STATUS_LABELS,
  timeAgo,
} from './calls-format.js';
import { CallsTabs, errorText, SectionTitle, type CallsAccess } from './CallsShared.js';

const PROVIDERS: readonly TelephonyProvider[] = ['justcall', 'aircall'];

const PROVIDER_GUIDE: Readonly<Record<TelephonyProvider, { tagline: string; steps: readonly string[]; note: string }>> = {
  justcall: {
    tagline: 'Cloud phone system for sales and support teams.',
    steps: [
      'Sign in to JustCall as an admin.',
      'Open your profile menu and choose “APIs and Webhooks”.',
      'Copy the API Key and the API Secret into the form.',
    ],
    note: 'API access needs JustCall’s Team plan or higher. JustCall’s API returns the last 3 months of calls.',
  },
  aircall: {
    tagline: 'Cloud call center and business phone.',
    steps: [
      'Sign in to the Aircall Dashboard as an admin.',
      'Go to Integrations & API → API Keys and generate a key.',
      'Copy the API ID and the API token (the token is shown only once).',
    ],
    note: 'Aircall allows 120 API requests a minute per company; large backfills continue over several syncs.',
  },
};

const BACKFILL_OPTIONS: Readonly<Record<TelephonyProvider, readonly number[]>> = {
  justcall: [7, 30, 60, 90],
  aircall: [7, 30, 60, 90, 180, 365],
};

export function CallIntegrationsPage({ access, onNavigate }: { access: CallsAccess; onNavigate: (path: string) => void }): React.JSX.Element {
  const [payload, setPayload] = useState<ConnectionsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ provider: TelephonyProvider; connection: TelephonyConnection | null } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<TelephonyConnection | null>(null);
  const [historyFor, setHistoryFor] = useState<TelephonyConnection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [agentsVersion, setAgentsVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      setPayload(await getConnections());
      setError(null);
    } catch (cause) {
      setError(errorText(cause, 'Unable to load call integrations.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // While a sync runs, check back every few seconds so the card updates on its own.
  const running = payload?.connections.some((connection) => connection.lastSyncStatus === 'running') ?? false;
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!running) {
      if (wasRunning.current) setAgentsVersion((version) => version + 1);
      wasRunning.current = false;
      return;
    }
    wasRunning.current = true;
    const timer = window.setTimeout(() => void load(), 4000);
    return () => window.clearTimeout(timer);
  }, [running, payload, load]);

  const byProvider = useMemo(() => new Map((payload?.connections ?? []).map((connection) => [connection.provider, connection])), [payload]);

  async function act(key: string, work: () => Promise<string | null>): Promise<void> {
    setBusy(key);
    setMessage(null);
    setError(null);
    try {
      const note = await work();
      if (note) setMessage(note);
      await load();
    } catch (cause) {
      setError(errorText(cause, 'That did not work. Try again.'));
    } finally {
      setBusy(null);
    }
  }

  const connected = (payload?.connections ?? []).filter((connection) => connection.status !== 'disconnected');

  return (
    <Page
      eyebrow="Sales · Calls"
      title="Call integrations"
      description="Connect JustCall or Aircall with an API key. Calls sync every 15 minutes, and each platform user is matched to an employee by email."
    >
      <CallsTabs active="integrations" access={access} onNavigate={onNavigate} />

      {payload && !payload.keyConfigured && (
        <Notice error>
          This server cannot store API keys yet. Ask whoever runs TapCRM to set <code className="font-mono">TELEPHONY_CREDENTIALS_KEY</code> (a random
          32-byte key, e.g. <code className="font-mono">openssl rand -hex 32</code>) and restart the server.
        </Notice>
      )}
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}

      <div className="grid gap-5 lg:grid-cols-2">
        {PROVIDERS.map((provider) =>
          payload ? (
            <ProviderCard
              key={provider}
              provider={provider}
              connection={byProvider.get(provider) ?? null}
              canConnect={payload.keyConfigured}
              busy={busy}
              onConnect={() => setDialog({ provider, connection: byProvider.get(provider) ?? null })}
              onSync={(connection) =>
                void act(`sync:${connection.id}`, async () => {
                  const result = await syncConnection(connection.id);
                  return `${PROVIDER_NAMES[provider]} sync ${result.status === 'queued' ? 'queued' : 'started'}. New calls appear as they arrive.`;
                })
              }
              onTest={(connection) =>
                void act(`test:${connection.id}`, async () => {
                  const result = await testConnection(connection.id);
                  if (!result.ok) throw new Error(result.message);
                  return result.message;
                })
              }
              onTogglePause={(connection) =>
                void act(`pause:${connection.id}`, async () => {
                  const next = connection.status === 'paused' ? 'active' : 'paused';
                  await updateConnection(connection.id, { status: next });
                  return next === 'paused' ? `${PROVIDER_NAMES[provider]} sync paused.` : `${PROVIDER_NAMES[provider]} sync resumed.`;
                })
              }
              onDisconnect={setConfirmDisconnect}
              onHistory={setHistoryFor}
            />
          ) : (
            <Card key={provider} className="space-y-4">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-24 w-full" />
            </Card>
          ),
        )}
      </div>

      {connected.length > 0 && <AgentMatching connections={connected} version={agentsVersion} />}

      {dialog && (
        <ConnectDialog
          provider={dialog.provider}
          connection={dialog.connection}
          onClose={() => setDialog(null)}
          onSaved={(connection, replaced) => {
            setDialog(null);
            setMessage(
              replaced
                ? `${PROVIDER_NAMES[connection.provider]} key replaced and verified.`
                : `${PROVIDER_NAMES[connection.provider]} connected. The first sync has started; calls appear here and in Team calls as they arrive.`,
            );
            void load();
          }}
        />
      )}

      {confirmDisconnect && (
        <Modal
          title={`Disconnect ${PROVIDER_NAMES[confirmDisconnect.provider]}?`}
          onClose={() => setConfirmDisconnect(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button kind="secondary" onClick={() => setConfirmDisconnect(null)}>
                Keep connected
              </Button>
              <Button
                kind="danger"
                disabled={busy !== null}
                onClick={() => {
                  const target = confirmDisconnect;
                  setConfirmDisconnect(null);
                  void act(`disconnect:${target.id}`, async () => {
                    await disconnectProvider(target.id);
                    return `${PROVIDER_NAMES[target.provider]} disconnected. Its API key was deleted; synced calls stay in the CRM.`;
                  });
                }}
              >
                Disconnect
              </Button>
            </div>
          }
        >
          <p className="text-sm leading-6 text-app-muted">
            The saved API key is deleted and syncing stops. Calls already synced stay in Call analytics, but their recordings can no longer be played until you
            reconnect.
          </p>
        </Modal>
      )}

      {historyFor && <SyncHistoryDialog connection={historyFor} onClose={() => setHistoryFor(null)} />}
    </Page>
  );
}

/* ==================================================================== *
 * Provider cards
 * ==================================================================== */

function ProviderMark({ provider }: { provider: TelephonyProvider }): React.JSX.Element {
  return (
    <span
      className={`grid size-12 shrink-0 place-items-center rounded-2xl text-lg font-black text-white shadow-sm ${
        provider === 'justcall' ? 'bg-[linear-gradient(135deg,#1f9d55,#0f766e)]' : 'bg-[linear-gradient(135deg,#00b388,#047857)]'
      }`}
      aria-hidden="true"
    >
      {provider === 'justcall' ? 'J' : 'A'}
    </span>
  );
}

function ProviderCard({
  provider,
  connection,
  canConnect,
  busy,
  onConnect,
  onSync,
  onTest,
  onTogglePause,
  onDisconnect,
  onHistory,
}: {
  provider: TelephonyProvider;
  connection: TelephonyConnection | null;
  canConnect: boolean;
  busy: string | null;
  onConnect: () => void;
  onSync: (connection: TelephonyConnection) => void;
  onTest: (connection: TelephonyConnection) => void;
  onTogglePause: (connection: TelephonyConnection) => void;
  onDisconnect: (connection: TelephonyConnection) => void;
  onHistory: (connection: TelephonyConnection) => void;
}): React.JSX.Element {
  const live = connection !== null && connection.status !== 'disconnected';
  const guide = PROVIDER_GUIDE[provider];
  const syncing = connection?.lastSyncStatus === 'running';
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <ProviderMark provider={provider} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl font-bold">{PROVIDER_NAMES[provider]}</h2>
            {connection && (
              <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${connectionTone(connection.status)}`}>
                {CONNECTION_STATUS_LABELS[connection.status]}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-app-muted">{live ? connection.label : guide.tagline}</p>
        </div>
      </div>

      {live ? (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-app-border bg-app-surface-raised p-3">
              <p className="text-xl font-bold tabular-nums">{connection.callCount.toLocaleString()}</p>
              <p className="text-[11px] text-app-muted">calls synced</p>
            </div>
            <div className="rounded-xl border border-app-border bg-app-surface-raised p-3">
              <p className="text-xl font-bold tabular-nums">
                {connection.matchedAgentCount}/{connection.agentCount}
              </p>
              <p className="text-[11px] text-app-muted">users matched</p>
            </div>
            <div className="rounded-xl border border-app-border bg-app-surface-raised p-3">
              <p className="text-xl font-bold tabular-nums">{connection.backfillDays}d</p>
              <p className="text-[11px] text-app-muted">history</p>
            </div>
          </div>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-app-muted">Last sync</dt>
              <dd className="text-right font-medium">
                {syncing ? (
                  <span className="inline-flex items-center gap-1.5 text-app-accent">
                    <span className="size-2 animate-pulse rounded-full bg-app-accent" /> Syncing now…
                  </span>
                ) : connection.lastSyncStatus ? (
                  `${SYNC_STATUS_LABELS[connection.lastSyncStatus]} · ${timeAgo(connection.lastSyncFinishedAt)}`
                ) : (
                  'Waiting for the first sync'
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-app-muted">API key</dt>
              <dd className="font-mono text-xs">{connection.credentialsHint ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-app-muted">Key last checked</dt>
              <dd>{timeAgo(connection.lastVerifiedAt)}</dd>
            </div>
          </dl>
          {connection.unmatchedAgentCount > 0 && (
            <p className="rounded-xl border border-app-accent/30 bg-app-accent/10 px-3 py-2 text-xs text-app-accent">
              {connection.unmatchedAgentCount} platform {connection.unmatchedAgentCount === 1 ? 'user is' : 'users are'} not matched to an employee yet — see
              “Platform users” below.
            </p>
          )}
          {connection.lastSyncError && !syncing && (
            <p className="rounded-xl border border-app-danger/30 bg-app-danger/10 px-3 py-2 text-xs text-app-danger" role="alert">
              {connection.lastSyncError}
            </p>
          )}
          <div className="mt-auto flex flex-wrap gap-2">
            <Button onClick={() => onSync(connection)} disabled={busy !== null || syncing || connection.status === 'paused'}>
              <Icon name="refresh" className="size-4" /> {busy === `sync:${connection.id}` ? 'Starting…' : 'Sync now'}
            </Button>
            <Button kind="secondary" onClick={() => onTest(connection)} disabled={busy !== null}>
              {busy === `test:${connection.id}` ? 'Checking…' : 'Test key'}
            </Button>
            <Button kind="secondary" onClick={onConnect} disabled={busy !== null || !canConnect}>
              <Icon name="key" className="size-4" /> Replace key
            </Button>
            <Button kind="secondary" onClick={() => onTogglePause(connection)} disabled={busy !== null}>
              {connection.status === 'paused' ? 'Resume' : 'Pause'}
            </Button>
            <Button kind="secondary" onClick={() => onHistory(connection)}>
              History
            </Button>
            <Button kind="danger" onClick={() => onDisconnect(connection)} disabled={busy !== null}>
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <>
          <ol className="space-y-2 text-sm">
            {guide.steps.map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-app-accent/10 text-xs font-bold text-app-accent">{index + 1}</span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-app-muted">{guide.note}</p>
          {connection?.status === 'disconnected' && (
            <p className="text-xs text-app-muted">
              Disconnected. {connection.callCount.toLocaleString()} synced calls are kept; reconnect to resume syncing.
            </p>
          )}
          <div className="mt-auto">
            <Button onClick={onConnect} disabled={!canConnect}>
              <Icon name="link" className="size-4" /> {connection ? 'Reconnect' : 'Connect'} {PROVIDER_NAMES[provider]}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

/* ==================================================================== *
 * Connect / replace key
 * ==================================================================== */

function ConnectDialog({
  provider,
  connection,
  onClose,
  onSaved,
}: {
  provider: TelephonyProvider;
  connection: TelephonyConnection | null;
  onClose: () => void;
  onSaved: (connection: TelephonyConnection, replaced: boolean) => void;
}): React.JSX.Element {
  const replacing = connection !== null && connection.status !== 'disconnected';
  const [label, setLabel] = useState(connection?.label ?? PROVIDER_NAMES[provider]);
  const [backfillDays, setBackfillDays] = useState(String(connection?.backfillDays ?? 30));
  const [keyId, setKeyId] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = provider === 'justcall' ? { id: 'API key', secret: 'API secret' } : { id: 'API ID', secret: 'API token' };
  const guide = PROVIDER_GUIDE[provider];

  async function save(): Promise<void> {
    setError(null);
    if (keyId.trim().length < 8 || secret.trim().length < 8) {
      setError(`Paste both the ${names.id} and the ${names.secret}.`);
      return;
    }
    const credentials: CredentialsInput =
      provider === 'justcall'
        ? { provider, apiKey: keyId.trim(), apiSecret: secret.trim() }
        : { provider, apiId: keyId.trim(), apiToken: secret.trim() };
    setSaving(true);
    try {
      const saved = replacing
        ? await updateConnection(connection.id, { credentials, label: label.trim() || PROVIDER_NAMES[provider], backfillDays: Number(backfillDays) })
        : await connectProvider({ credentials, label: label.trim() || undefined, backfillDays: Number(backfillDays) });
      onSaved(saved, replacing);
    } catch (cause) {
      setError(errorText(cause, `${PROVIDER_NAMES[provider]} did not accept these keys.`));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={replacing ? `Replace ${PROVIDER_NAMES[provider]} key` : `Connect ${PROVIDER_NAMES[provider]}`}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs text-app-muted">
            <Icon name="shield" className="size-4" /> Keys are checked with {PROVIDER_NAMES[provider]}, then stored encrypted.
          </p>
          <div className="flex gap-2">
            <Button kind="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? 'Checking keys…' : replacing ? 'Verify and replace' : 'Verify and connect'}
            </Button>
          </div>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="rounded-xl border border-app-border bg-app-surface-raised p-4 text-sm">
          <p className="font-semibold">Where to find the keys</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-app-muted">
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
        <Field label={names.id} value={keyId} onChange={setKeyId} required placeholder={`Paste the ${names.id}`} />
        <Field
          label={names.secret}
          value={secret}
          onChange={setSecret}
          required
          type={showSecret ? 'text' : 'password'}
          placeholder={`Paste the ${names.secret}`}
          hint={
            <button type="button" className="text-app-accent hover:underline" onClick={() => setShowSecret((value) => !value)}>
              {showSecret ? 'Hide' : 'Show'} {names.secret.toLowerCase()}
            </button>
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name in the CRM" value={label} onChange={setLabel} placeholder={PROVIDER_NAMES[provider]} />
          <Select
            label="Import history"
            value={backfillDays}
            onChange={(value) => setBackfillDays(value || '30')}
            options={BACKFILL_OPTIONS[provider].map((days) => ({ value: String(days), label: `Last ${days} days` }))}
          />
        </div>
        <p className="text-xs text-app-muted">{guide.note}</p>
        {error && (
          <p className="rounded-xl border border-app-danger/30 bg-app-danger/10 p-3 text-sm text-app-danger" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

/* ==================================================================== *
 * Sync history
 * ==================================================================== */

function SyncHistoryDialog({ connection, onClose }: { connection: TelephonyConnection; onClose: () => void }): React.JSX.Element {
  const [runs, setRuns] = useState<SyncRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getSyncRuns(connection.id, 20)
      .then(setRuns)
      .catch((cause: unknown) => setError(errorText(cause, 'Unable to load sync history.')));
  }, [connection.id]);
  return (
    <Modal title={`${PROVIDER_NAMES[connection.provider]} sync history`} onClose={onClose} size="lg">
      {error && <Notice error>{error}</Notice>}
      {!runs && !error && <Skeleton className="h-40 w-full" />}
      {runs && runs.length === 0 && <p className="text-sm text-app-muted">No syncs have run yet.</p>}
      {runs && runs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-app-border text-left text-[11px] font-bold uppercase tracking-wider text-app-muted">
                <th className="py-2 pr-3">Started</th>
                <th className="py-2 pr-3">How</th>
                <th className="py-2 pr-3">Result</th>
                <th className="py-2 pr-3 text-right">Calls new / updated</th>
                <th className="py-2 text-right">API calls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app-border">
              {runs.map((run) => (
                <tr key={run.id}>
                  <td className="py-2 pr-3">{timeAgo(run.startedAt)}</td>
                  <td className="py-2 pr-3 text-app-muted">
                    {run.trigger === 'schedule' ? 'Automatic' : run.trigger === 'connect' ? 'On connect' : `By ${run.requestedByName ?? 'an admin'}`}
                  </td>
                  <td className="py-2 pr-3">
                    <span className={run.status === 'failed' ? 'font-semibold text-app-danger' : run.status === 'succeeded' ? 'text-app-success' : ''}>
                      {SYNC_STATUS_LABELS[run.status]}
                    </span>
                    {run.error && <span className="block max-w-xs truncate text-xs text-app-muted" title={run.error}>{run.error}</span>}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {run.callsCreated} / {run.callsUpdated}
                  </td>
                  <td className="py-2 text-right tabular-nums text-app-muted">{run.apiRequests}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/* ==================================================================== *
 * Platform users ↔ employees
 * ==================================================================== */

type AgentFilter = 'all' | 'unmatched' | 'matched' | 'ignored';

const AGENT_FILTERS: ReadonlyArray<{ id: AgentFilter; label: string }> = [
  { id: 'unmatched', label: 'Needs a match' },
  { id: 'matched', label: 'Matched' },
  { id: 'ignored', label: 'Not employees' },
  { id: 'all', label: 'All' },
];

function matchTone(method: TelephonyAgent['matchMethod']): string {
  if (method === 'email' || method === 'manual') return 'border-app-success/30 bg-app-success/10 text-app-success';
  if (method === 'ignored') return 'border-app-border bg-app-surface-raised text-app-muted';
  return 'border-app-danger/30 bg-app-danger/10 text-app-danger';
}

function AgentMatching({ connections, version }: { connections: readonly TelephonyConnection[]; version: number }): React.JSX.Element {
  const [filter, setFilter] = useState<AgentFilter>('all');
  const [agents, setAgents] = useState<TelephonyAgent[] | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAgents(await getAgents({ status: filter }));
      setError(null);
    } catch (cause) {
      setError(errorText(cause, 'Unable to load platform users.'));
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load, version]);

  useEffect(() => {
    getEmployeeOptions()
      .then(setEmployees)
      .catch(() => setEmployees([]));
  }, []);

  async function apply(agent: TelephonyAgent, input: Parameters<typeof mapAgent>[1]): Promise<void> {
    setSavingId(agent.id);
    setNote(null);
    try {
      const updated = await mapAgent(agent.id, input);
      setAgents((current) => (current ?? []).map((row) => (row.id === updated.id ? updated : row)));
    } catch (cause) {
      setError(errorText(cause, 'Unable to save that match.'));
    } finally {
      setSavingId(null);
    }
  }

  const employeeOptions = employees.map((employee) => ({
    value: employee.id,
    label: [employee.fullName, employee.email, employee.teamName].filter(Boolean).join(' · '),
  }));
  const providerLabel = (connectionId: string) => {
    const connection = connections.find((item) => item.id === connectionId);
    return connection ? PROVIDER_NAMES[connection.provider] : '';
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="p-5 pb-3">
        <SectionTitle
          title="Platform users"
          description="Each JustCall or Aircall user is matched to the CRM employee with the same email. Map anyone else by hand; your choice is kept on every sync."
          action={
            <Button
              kind="secondary"
              onClick={() =>
                void rematchAgents()
                  .then((result) => {
                    setNote(`Email matching re-run: ${result.matched} ${result.matched === 1 ? 'user' : 'users'} matched.`);
                    return load();
                  })
                  .catch((cause: unknown) => setError(errorText(cause, 'Unable to re-run matching.')))
              }
            >
              <Icon name="refresh" className="size-4" /> Re-run email matching
            </Button>
          }
        />
        <div role="group" aria-label="Filter platform users" className="inline-flex flex-wrap gap-1.5 rounded-xl border border-app-border bg-app-surface p-1">
          {AGENT_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${filter === item.id ? 'ui-primary' : 'text-app-muted hover:bg-app-background'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {error && <div className="mt-3"><Notice error>{error}</Notice></div>}
        {note && <div className="mt-3"><Notice>{note}</Notice></div>}
      </div>
      {!agents ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : agents.length === 0 ? (
        <p className="px-5 pb-6 text-sm text-app-muted">
          {filter === 'unmatched' ? 'Everyone is matched. New platform users are matched on the next sync.' : 'No platform users here yet. They appear after the first sync.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-y border-app-border text-left text-[11px] font-bold uppercase tracking-wider text-app-muted">
                <th className="px-5 py-3">Platform user</th>
                <th className="px-3 py-3 text-right">Calls · last</th>
                <th className="px-3 py-3">Match</th>
                <th className="px-3 py-3">CRM employee</th>
                <th className="px-5 py-3 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app-border">
              {agents.map((agent) => (
                <tr key={agent.id} className={savingId === agent.id ? 'opacity-60' : ''}>
                  <td className="px-5 py-3">
                    <span className="block font-semibold">{agent.name ?? `User ${agent.externalId}`}</span>
                    <span className="block text-xs text-app-muted">
                      {agent.email ?? 'No email on the platform'} · {providerLabel(agent.connectionId)}
                      {agent.phoneNumbers[0] ? ` · ${formatPhone(agent.phoneNumbers[0])}` : ''}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <span className="font-semibold">{agent.callCount}</span>
                    {agent.lastCallAt && <span className="block whitespace-nowrap text-xs text-app-muted">{timeAgo(agent.lastCallAt)}</span>}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${matchTone(agent.matchMethod)}`}>
                      {MATCH_LABELS[agent.matchMethod]}
                    </span>
                  </td>
                  <td className="w-72 px-3 py-3 [&_label>span:first-child]:sr-only">
                    <SearchableSelect
                      label={`Employee for ${agent.name ?? agent.externalId}`}
                      value={agent.employeeId ?? ''}
                      placeholder="Choose an employee…"
                      disabled={savingId === agent.id}
                      onChange={(value) => void apply(agent, value ? { mode: 'employee', employeeId: value } : { mode: 'auto' })}
                      options={employeeOptions}
                    />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {(agent.matchMethod === 'none' || agent.matchMethod === 'manual') && (
                        <Button kind="secondary" className="whitespace-nowrap" disabled={savingId === agent.id} onClick={() => void apply(agent, { mode: 'ignore' })}>
                          Not an employee
                        </Button>
                      )}
                      {(agent.matchMethod === 'manual' || agent.matchMethod === 'ignored') && (
                        <Button kind="secondary" className="whitespace-nowrap" disabled={savingId === agent.id} onClick={() => void apply(agent, { mode: 'auto' })}>
                          Match by email
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
