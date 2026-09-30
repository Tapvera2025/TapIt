import { useEffect, useState } from 'react';
import { IdentityApiError } from '../api/authApi.js';
import { getMySessions, revokeAllMySessions, revokeMySession, signOutLocally, type IdentitySession } from '../api/sessionsApi.js';
import { Icon } from '../../ui/Icon.js';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function relativeTime(value: string): string {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'Active just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Last active ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Last active ${hours}h ago`;
  return `Last active ${Math.round(hours / 24)}d ago`;
}

function deviceName(session: IdentitySession): string {
  if (session.deviceLabel?.trim()) return session.deviceLabel;
  if (session.userAgent?.includes('Chrome')) return 'Chrome browser';
  if (session.userAgent?.includes('Safari')) return 'Safari browser';
  if (session.userAgent?.includes('Firefox')) return 'Firefox browser';
  return 'Web browser';
}

export function SessionsPage({ onBack, onSignedOut }: { onBack: () => void; onSignedOut: () => void }): React.JSX.Element {
  const [sessions, setSessions] = useState<IdentitySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<{ kind: 'one' | 'all'; session?: IdentitySession } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(): Promise<void> {
    setLoading(true); setError('');
    try { setSessions(await getMySessions()); }
    catch (cause) {
      if (cause instanceof IdentityApiError && cause.status === 401) {
        signOutLocally();
        onSignedOut();
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Unable to load your sessions.');
    }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function confirmRevoke(): Promise<void> {
    if (!confirm) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (confirm.kind === 'all') {
        await revokeAllMySessions();
        signOutLocally();
        onSignedOut();
        return;
      }
      if (!confirm.session) return;
      const result = await revokeMySession(confirm.session.id);
      if (result.current) {
        signOutLocally();
        onSignedOut();
        return;
      }
      setSessions((current) => current.filter((session) => session.id !== confirm.session?.id));
      setNotice('The session was revoked.');
      setConfirm(null);
    } catch (cause) {
      setError(cause instanceof IdentityApiError && cause.status === 401 ? 'Your login session has expired.' : cause instanceof Error ? cause.message : 'Unable to revoke the session.');
    } finally { setBusy(false); }
  }

  return <main className="min-h-screen w-full max-w-full overflow-x-hidden bg-app-background p-4 sm:p-6 text-app-foreground md:p-10">
    <div className="mx-auto w-full max-w-5xl">
      <button type="button" onClick={onBack} className="mb-6 text-sm font-bold text-app-accent hover:underline">Back to CRM</button>
      <div className="page-heading flex flex-wrap items-center justify-between gap-4 sm:gap-5">
        <div className="min-w-0 max-w-full">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-app-accent">Account security</p>
          <h1 className="mt-2 break-words font-display text-2xl font-bold tracking-[-0.05em] sm:text-3xl md:text-4xl">
            Sessions &amp; Devices
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-app-muted sm:mt-3">
            Review where your TapCRM account is currently signed in. These are your sessions only.
          </p>
        </div>
        {!loading && sessions.length > 0 && <button type="button" onClick={() => setConfirm({ kind: 'all' })} className="w-full sm:w-auto rounded-lg border border-[#d86b6b]/40 px-4 py-2.5 text-sm font-bold text-app-danger hover:bg-[#d86b6b]/10">Sign out everywhere</button>}
      </div>
      {notice && <p className="mt-6 rounded-lg border border-app-accent/30 bg-app-accent/10 px-4 py-3 text-sm text-app-accent">{notice}</p>}
      {error && <div className="mt-6 rounded-xl border border-[#d86b6b]/30 bg-[#d86b6b]/10 p-4 text-sm text-app-danger"><p>{error}</p><button type="button" onClick={() => { void load(); }} className="mt-2 font-bold underline">Retry</button></div>}
      {loading && <div className="mt-8 grid gap-4 md:grid-cols-2" aria-label="Loading sessions" aria-busy="true">{[1, 2].map((item) => <div key={item} className="h-48 animate-pulse rounded-2xl border border-app-border bg-app-surface" />)}</div>}
      {!loading && !error && sessions.length === 0 && <div className="mt-8 rounded-2xl border border-app-border bg-app-surface p-8 text-center"><h2 className="font-display text-xl font-bold">No active sessions</h2><p className="mt-2 text-sm text-app-muted">You&apos;re not currently signed in anywhere else.</p></div>}
      {!loading && sessions.length > 0 && <>
        <section className="mt-8"><h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-app-muted">Current session</h2>{sessions.filter((session) => session.current).map((session) => <SessionCard key={session.id} session={session} onRevoke={() => setConfirm({ kind: 'one', session })} />)}</section>
        <section className="mt-8"><h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-app-muted">Other active sessions</h2>{sessions.filter((session) => !session.current).length === 0 ? <p className="rounded-xl border border-app-border bg-app-surface p-5 text-sm text-app-muted">No other active sessions.</p> : <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{sessions.filter((session) => !session.current).map((session) => <SessionCard key={session.id} session={session} onRevoke={() => setConfirm({ kind: 'one', session })} />)}</div>}</section>
      </>}
    </div>
    {confirm && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-5 backdrop-blur-sm" role="presentation"><section className="w-full max-w-md rounded-2xl border border-app-border bg-app-surface p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="session-confirm-title"><h2 id="session-confirm-title" className="font-display text-2xl font-bold">{confirm.kind === 'all' ? 'Sign out of all sessions?' : 'Revoke this session?'}</h2><p className="mt-3 text-sm leading-6 text-app-muted">{confirm.kind === 'all' ? 'This will sign out your TapCRM account on all active devices, including this device.' : `The ${deviceName(confirm.session!)} session will be signed out of TapCRM.`}</p><div className="mt-6 flex justify-end gap-3"><button type="button" disabled={busy} onClick={() => setConfirm(null)} className="rounded-lg border border-app-border px-4 py-2.5 text-sm font-bold disabled:opacity-50">Cancel</button><button type="button" disabled={busy} onClick={() => { void confirmRevoke(); }} className="rounded-lg bg-[#d86b6b] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Working...' : confirm.kind === 'all' ? 'Sign out everywhere' : 'Revoke session'}</button></div></section></div>}
  </main>;
}

function SessionCard({ session, onRevoke }: { session: IdentitySession; onRevoke: () => void }): React.JSX.Element {
  return (
    <article className="w-full max-w-full rounded-2xl border border-app-border bg-app-surface p-4 sm:p-5 shadow-[0_14px_40px_rgba(0,0,0,0.08)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-lg text-app-accent" aria-hidden="true">
            <Icon name="monitor" className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 sm:block">
              <h3 className="break-words font-display text-base font-bold sm:truncate sm:text-lg">
                {deviceName(session)}
              </h3>
              {session.current && (
                <span className="shrink-0 rounded-full bg-app-accent/15 px-2.5 py-1 text-xs font-bold text-app-accent sm:hidden">
                  Current device
                </span>
              )}
            </div>
            <p className="mt-1 break-words text-xs text-app-muted sm:truncate">
              {session.userAgent ?? 'Browser details unavailable'}
            </p>
          </div>
        </div>
        {session.current ? (
          <span className="hidden shrink-0 rounded-full bg-app-accent/15 px-2.5 py-1 text-xs font-bold text-app-accent sm:inline-block">
            Current device
          </span>
        ) : (
          <div className="flex justify-end sm:block">
            <button
              type="button"
              onClick={onRevoke}
              className="shrink-0 rounded-lg border border-[#d86b6b]/40 px-3 py-1.5 text-xs font-bold text-app-danger hover:bg-[#d86b6b]/10"
            >
              Revoke
            </button>
          </div>
        )}
      </div>

      {/* Subtle divider on mobile between session identity and session info */}
      <div className="my-3.5 border-t border-app-border sm:hidden" />

      {/* Compact information rows for mobile */}
      <div className="space-y-2 sm:hidden">
        <div className="flex items-center gap-3 rounded-xl border border-app-border/60 bg-app-surface-raised px-3 py-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-app-background/80 text-app-muted">
            <Icon name="pin" className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-app-muted">Approximate location</p>
            <p className="mt-0.5 break-words text-xs font-semibold text-app-foreground">
              {session.approxLocation ?? 'Not available'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-app-border/60 bg-app-surface-raised px-3 py-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-app-background/80 text-app-muted">
            <Icon name="monitor" className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-app-muted">IP address</p>
            <p className="mt-0.5 break-all text-xs font-semibold text-app-foreground">
              {session.ip ?? 'Not available'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-app-border/60 bg-app-surface-raised px-3 py-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-app-background/80 text-app-muted">
            <Icon name="history" className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-app-muted">Activity</p>
            <p className="mt-0.5 text-xs font-semibold text-app-foreground">
              {relativeTime(session.lastActiveAt)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-app-border/60 bg-app-surface-raised px-3 py-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-app-background/80 text-app-muted">
            <Icon name="notepad" className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-app-muted">Created</p>
            <p className="mt-0.5 text-xs font-semibold text-app-foreground">
              {formatDate(session.createdAt)}
            </p>
          </div>
        </div>
      </div>

      {/* Desktop / tablet layout */}
      <dl className="mt-5 hidden grid-cols-2 gap-3 border-t border-app-border pt-4 text-sm sm:grid">
        <div>
          <dt className="text-xs text-app-muted">Approximate location</dt>
          <dd className="mt-1 break-words">{session.approxLocation ?? 'Not available'}</dd>
        </div>
        <div>
          <dt className="text-xs text-app-muted">IP address</dt>
          <dd className="mt-1 break-all">{session.ip ?? 'Not available'}</dd>
        </div>
        <div>
          <dt className="text-xs text-app-muted">Activity</dt>
          <dd className="mt-1">{relativeTime(session.lastActiveAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-app-muted">Created</dt>
          <dd className="mt-1">{formatDate(session.createdAt)}</dd>
        </div>
      </dl>
    </article>
  );
}
