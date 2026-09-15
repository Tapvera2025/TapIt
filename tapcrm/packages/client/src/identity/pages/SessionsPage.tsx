import { useEffect, useState } from 'react';
import { IdentityApiError } from '../api/authApi.js';
import { getMySessions, revokeAllMySessions, revokeMySession, signOutLocally, type IdentitySession } from '../api/sessionsApi.js';

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

  return <main className="min-h-screen bg-app-background p-6 text-app-foreground md:p-10">
    <div className="mx-auto max-w-5xl">
      <button type="button" onClick={onBack} className="mb-6 text-sm font-bold text-app-accent hover:underline">Back to CRM</button>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-app-accent">Account security</p><h1 className="mt-2 font-display text-4xl font-bold tracking-[-0.05em]">Sessions &amp; Devices</h1><p className="mt-3 max-w-xl text-sm leading-6 text-app-muted">Review where your TapCRM account is currently signed in. These are your sessions only.</p></div>
        {!loading && sessions.length > 0 && <button type="button" onClick={() => setConfirm({ kind: 'all' })} className="rounded-lg border border-[#d86b6b]/40 px-4 py-2.5 text-sm font-bold text-[#d86b6b] hover:bg-[#d86b6b]/10">Sign out everywhere</button>}
      </div>
      {notice && <p className="mt-6 rounded-lg border border-app-accent/30 bg-app-accent/10 px-4 py-3 text-sm text-app-accent">{notice}</p>}
      {error && <div className="mt-6 rounded-xl border border-[#d86b6b]/30 bg-[#d86b6b]/10 p-4 text-sm text-[#d86b6b]"><p>{error}</p><button type="button" onClick={() => { void load(); }} className="mt-2 font-bold underline">Retry</button></div>}
      {loading && <div className="mt-8 grid gap-4 md:grid-cols-2" aria-label="Loading sessions" aria-busy="true">{[1, 2].map((item) => <div key={item} className="h-48 animate-pulse rounded-2xl border border-app-border bg-app-surface" />)}</div>}
      {!loading && !error && sessions.length === 0 && <div className="mt-8 rounded-2xl border border-app-border bg-app-surface p-8 text-center"><h2 className="font-display text-xl font-bold">No active sessions</h2><p className="mt-2 text-sm text-app-muted">You&apos;re not currently signed in anywhere else.</p></div>}
      {!loading && sessions.length > 0 && <>
        <section className="mt-8"><h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-app-muted">Current session</h2>{sessions.filter((session) => session.current).map((session) => <SessionCard key={session.id} session={session} onRevoke={() => setConfirm({ kind: 'one', session })} />)}</section>
        <section className="mt-8"><h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-app-muted">Other active sessions</h2>{sessions.filter((session) => !session.current).length === 0 ? <p className="rounded-xl border border-app-border bg-app-surface p-5 text-sm text-app-muted">No other active sessions.</p> : <div className="grid gap-4 md:grid-cols-2">{sessions.filter((session) => !session.current).map((session) => <SessionCard key={session.id} session={session} onRevoke={() => setConfirm({ kind: 'one', session })} />)}</div>}</section>
      </>}
    </div>
    {confirm && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-5 backdrop-blur-sm" role="presentation"><section className="w-full max-w-md rounded-2xl border border-app-border bg-app-surface p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="session-confirm-title"><h2 id="session-confirm-title" className="font-display text-2xl font-bold">{confirm.kind === 'all' ? 'Sign out of all sessions?' : 'Revoke this session?'}</h2><p className="mt-3 text-sm leading-6 text-app-muted">{confirm.kind === 'all' ? 'This will sign out your TapCRM account on all active devices, including this device.' : `The ${deviceName(confirm.session!)} session will be signed out of TapCRM.`}</p><div className="mt-6 flex justify-end gap-3"><button type="button" disabled={busy} onClick={() => setConfirm(null)} className="rounded-lg border border-app-border px-4 py-2.5 text-sm font-bold disabled:opacity-50">Cancel</button><button type="button" disabled={busy} onClick={() => { void confirmRevoke(); }} className="rounded-lg bg-[#d86b6b] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Working...' : confirm.kind === 'all' ? 'Sign out everywhere' : 'Revoke session'}</button></div></section></div>}
  </main>;
}

function SessionCard({ session, onRevoke }: { session: IdentitySession; onRevoke: () => void }): React.JSX.Element {
  return <article className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-[0_14px_40px_rgba(0,0,0,0.08)]"><div className="flex items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-lg text-app-accent" aria-hidden="true">▣</span><div className="min-w-0"><h3 className="truncate font-display text-lg font-bold">{deviceName(session)}</h3><p className="mt-1 truncate text-xs text-app-muted">{session.userAgent ?? 'Browser details unavailable'}</p></div></div>{session.current ? <span className="shrink-0 rounded-full bg-app-accent/15 px-2.5 py-1 text-xs font-bold text-app-accent">Current device</span> : <button type="button" onClick={onRevoke} className="shrink-0 rounded-lg border border-[#d86b6b]/40 px-3 py-1.5 text-xs font-bold text-[#d86b6b] hover:bg-[#d86b6b]/10">Revoke</button>}</div><dl className="mt-5 grid gap-3 border-t border-app-border pt-4 text-sm sm:grid-cols-2"><div><dt className="text-xs text-app-muted">Approximate location</dt><dd className="mt-1 break-words">{session.approxLocation ?? 'Not available'}</dd></div><div><dt className="text-xs text-app-muted">IP address</dt><dd className="mt-1 break-all">{session.ip ?? 'Not available'}</dd></div><div><dt className="text-xs text-app-muted">Activity</dt><dd className="mt-1">{relativeTime(session.lastActiveAt)}</dd></div><div><dt className="text-xs text-app-muted">Created</dt><dd className="mt-1">{formatDate(session.createdAt)}</dd></div></dl></article>;
}
