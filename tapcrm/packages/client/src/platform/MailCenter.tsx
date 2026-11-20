import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../ui/index.js';
import { api, ApiError } from './api.js';

/**
 * Mail Center (Master Admin): every email the platform has sent or tried to send,
 * with the reason a delivery failed and a way to send a failed one again.
 */

type MailStatus = 'QUEUED' | 'RETRYING' | 'SENT' | 'FAILED';

interface MailSummary {
  id: string;
  toAddress: string;
  fromAddress: string | null;
  subject: string;
  status: MailStatus;
  transport: 'smtp' | 'console';
  attempts: number;
  manualRetries: number;
  sensitive: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  lastAttemptAt: string | null;
  sentAt: string | null;
}

interface MailDetail extends MailSummary {
  bodyText: string | null;
}

interface MailPage {
  items: MailSummary[];
  totalCount: number;
  page: number;
  limit: number;
  counts: Record<MailStatus, number>;
}

const PAGE_SIZE = 25;
const REFRESH_MS = 20_000;

const STATUS_STYLE: Record<MailStatus, { label: string; icon: string; tone: string }> = {
  SENT: { label: 'Sent', icon: 'check', tone: 'border-emerald-500/45 text-emerald-600' },
  FAILED: { label: 'Failed', icon: 'alert-circle', tone: 'border-app-danger/45 text-app-danger' },
  RETRYING: { label: 'Retrying', icon: 'refresh', tone: 'border-[#b7791f]/45 text-[#b7791f]' },
  QUEUED: { label: 'Queued', icon: 'clock', tone: 'border-app-accent/45 text-app-accent' },
};

function when(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ mail }: { mail: MailSummary }): React.JSX.Element {
  // Console transport never delivers anything: calling that "Sent" would be a lie.
  const printed = mail.transport === 'console' && mail.status === 'SENT';
  const style = STATUS_STYLE[mail.status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.05em] ${printed ? 'border-[#b7791f]/45 text-[#b7791f]' : style.tone}`}>
      <Icon name={printed ? 'alert-circle' : style.icon} className="size-3.5" />
      {printed ? 'Logged only' : style.label}
    </span>
  );
}

export function MailCenter(): React.JSX.Element {
  const [data, setData] = useState<MailPage | null>(null);
  const [status, setStatus] = useState<MailStatus | ''>('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MailDetail | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (status) params.set('status', status);
      if (appliedSearch) params.set('search', appliedSearch);
      setData(await api<MailPage>(`/platform/mail?${params.toString()}`));
      setError('');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load the mail log.');
    } finally {
      setLoading(false);
    }
  }, [page, status, appliedSearch]);

  useEffect(() => { void load(); }, [load]);

  // Messages still on their way change state by themselves, so keep the list fresh.
  const inFlight = (data?.counts.QUEUED ?? 0) + (data?.counts.RETRYING ?? 0) > 0;
  useEffect(() => {
    if (!inFlight) return undefined;
    const timer = window.setInterval(() => { void load(true); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [inFlight, load]);

  async function toggle(id: string): Promise<void> {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id);
    setDetail(null);
    try {
      setDetail(await api<MailDetail>(`/platform/mail/${id}`));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not open this email.');
    }
  }

  async function retry(id: string): Promise<void> {
    setBusyId(id);
    setNotice('');
    try {
      await api(`/platform/mail/${id}/retry`, { method: 'POST' });
      setNotice('Queued to send again. The status updates here in a moment.');
      setError('');
      await load(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not retry this email.');
    } finally {
      setBusyId(null);
    }
  }

  const counts = data?.counts;
  const totalPages = data ? Math.max(1, Math.ceil(data.totalCount / PAGE_SIZE)) : 1;

  return (
    <section id="platform-mail" className="mx-auto mt-[18px] w-full scroll-mt-5 rounded-2xl border border-app-border bg-app-surface p-6 shadow-sm max-[560px]:p-[20px_16px]">
      <div className="flex items-end justify-between gap-5 max-[700px]:flex-col max-[700px]:items-start">
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-app-accent">Delivery</p>
          <h2 className="font-display text-[clamp(24px,3vw,32px)] font-bold tracking-[-0.045em]">Mail Center</h2>
          <p className="mt-1.5 text-sm text-app-muted">
            Every email the platform sends, who it went to, and why any of them failed. Sent mail only: replies are not received here.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-app-border bg-app-background px-3 py-2 text-xs font-semibold text-app-muted hover:text-app-foreground disabled:opacity-60">
          <Icon name="refresh" className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['SENT', 'FAILED', 'RETRYING', 'QUEUED'] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={status === key}
            onClick={() => { setStatus(status === key ? '' : key); setPage(1); }}
            className={`rounded-xl border p-4 text-left transition ${status === key ? 'border-app-accent bg-app-accent/10' : 'border-app-border bg-app-background hover:border-app-accent/50'}`}
          >
            <span className="block text-[11px] font-bold uppercase tracking-[0.1em] text-app-muted">{STATUS_STYLE[key].label}</span>
            <strong className={`mt-1 block font-display text-2xl ${key === 'FAILED' && (counts?.FAILED ?? 0) > 0 ? 'text-app-danger' : ''}`}>{counts ? counts[key] : '–'}</strong>
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-xl border border-app-border bg-app-background p-3 max-[700px]:grid-cols-1">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-app-muted" />
          <input
            className="block w-full rounded-xl border border-app-border bg-app-background py-3 pl-10 pr-3 text-sm text-app-foreground outline-none placeholder:text-app-muted focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); setAppliedSearch(search.trim()); setPage(1); } }}
            placeholder="Search recipient or subject"
            aria-label="Search mail"
          />
        </div>
        <button type="button" onClick={() => { setAppliedSearch(search.trim()); setPage(1); }} className="rounded-xl bg-app-accent px-5 py-3 text-sm font-semibold text-app-on-accent">Search</button>
      </div>

      {error ? <p role="alert" className="mt-4 rounded-lg border border-app-danger/40 bg-app-danger/10 px-4 py-3 text-sm text-app-danger">{error}</p> : null}
      {notice ? <p role="status" className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">{notice}</p> : null}

      <div className="mt-4 overflow-hidden rounded-xl border border-app-border bg-app-surface">
        <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_132px_150px_120px] gap-4 border-b border-app-border px-5 py-3 text-[11px] font-bold uppercase tracking-[0.1em] text-app-muted lg:grid">
          <span>To / from</span><span>Subject</span><span>Status</span><span>When</span><span>Actions</span>
        </div>
        {!data ? (
          <p className="px-5 py-10 text-center text-sm text-app-muted">Loading…</p>
        ) : data.items.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-app-muted">No emails match the current filters.</p>
        ) : data.items.map((mail) => (
          <article key={mail.id} className="border-b border-app-border last:border-b-0">
            <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_132px_150px_120px] items-center gap-4 px-5 py-4 text-sm max-[1023px]:grid-cols-1 max-[1023px]:gap-2">
              <div className="min-w-0">
                <span className="block truncate font-semibold text-app-foreground" title={mail.toAddress}>{mail.toAddress}</span>
                <small className="block truncate text-xs text-app-muted" title={mail.fromAddress ?? ''}>from {mail.fromAddress ?? 'not set'}</small>
              </div>
              <span className="min-w-0 truncate text-app-foreground" title={mail.subject}>{mail.subject}</span>
              <div><StatusBadge mail={mail} /></div>
              <span className="text-xs text-app-muted">{when(mail.sentAt ?? mail.createdAt)}</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void toggle(mail.id)} aria-expanded={openId === mail.id} className="rounded-lg border border-app-border px-2.5 py-1.5 text-xs font-semibold text-app-muted hover:text-app-foreground">
                  {openId === mail.id ? 'Hide' : 'Details'}
                </button>
                {mail.status === 'FAILED' && !mail.sensitive ? (
                  <button type="button" onClick={() => void retry(mail.id)} disabled={busyId === mail.id} className="inline-flex items-center gap-1 rounded-lg bg-app-accent px-2.5 py-1.5 text-xs font-semibold text-app-on-accent disabled:opacity-60">
                    <Icon name="refresh" className="size-3.5" />
                    Retry
                  </button>
                ) : null}
              </div>
            </div>
            {openId === mail.id ? (
              <div className="space-y-4 border-t border-app-border bg-app-background px-5 py-4 text-sm">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-4">
                  <div><dt className="font-bold uppercase tracking-[0.07em] text-app-muted">Queued</dt><dd className="mt-1">{when(mail.createdAt)}</dd></div>
                  <div><dt className="font-bold uppercase tracking-[0.07em] text-app-muted">Last attempt</dt><dd className="mt-1">{when(mail.lastAttemptAt)}</dd></div>
                  <div><dt className="font-bold uppercase tracking-[0.07em] text-app-muted">Attempts</dt><dd className="mt-1">{mail.attempts}{mail.manualRetries ? ` (+${mail.manualRetries} manual retr${mail.manualRetries === 1 ? 'y' : 'ies'})` : ''}</dd></div>
                  <div><dt className="font-bold uppercase tracking-[0.07em] text-app-muted">Delivery</dt><dd className="mt-1">{mail.transport === 'console' ? 'Printed to server log (no SMTP)' : 'SMTP'}</dd></div>
                </dl>
                {mail.errorMessage ? (
                  <div className="rounded-lg border border-app-danger/40 bg-app-danger/10 p-3">
                    <p className="text-xs font-bold uppercase tracking-[0.07em] text-app-danger">Why it did not send{mail.errorCode ? ` · ${mail.errorCode}` : ''}</p>
                    <p className="mt-1 break-words text-sm text-app-foreground">{mail.errorMessage}</p>
                  </div>
                ) : null}
                {mail.status === 'FAILED' && mail.sensitive ? (
                  <p className="rounded-lg border border-[#b7791f]/40 bg-[#b7791f]/10 p-3 text-xs text-app-foreground">
                    This email held a one-time link or code, so its content is not stored and it cannot be re-sent from here. Send a fresh one from where it was created (for example, re-send the invitation).
                  </p>
                ) : null}
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-[0.07em] text-app-muted">Message</p>
                  {mail.sensitive ? (
                    <p className="text-xs text-app-muted">Content hidden: this message contains a one-time link or code.</p>
                  ) : detail && detail.id === mail.id ? (
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-app-border bg-app-surface p-3 text-xs text-app-foreground">{detail.bodyText ?? ''}</pre>
                  ) : (
                    <p className="text-xs text-app-muted">Loading…</p>
                  )}
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {data && data.totalCount > PAGE_SIZE ? (
        <div className="mt-4 flex items-center justify-between text-xs text-app-muted">
          <span>{data.totalCount} emails · page {page} of {totalPages}</span>
          <span className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-app-border px-3 py-1.5 font-semibold disabled:opacity-40">Previous</button>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded-lg border border-app-border px-3 py-1.5 font-semibold disabled:opacity-40">Next</button>
          </span>
        </div>
      ) : null}
    </section>
  );
}
