import { useEffect, useState } from 'react';
import { currencySymbol, paiseToRupees } from './proposals-helpers.js';

interface PublicProposal {
  readonly commercialsId: string;
  readonly dealTitle: string;
  readonly version: number;
  readonly currency: string;
  readonly subtotalMinor: string;
  readonly discountMinor: string;
  readonly taxMinor: string;
  readonly totalMinor: string;
  readonly advanceMinor: string;
  readonly validityAt: string | null;
  readonly scope: string | null;
  readonly exclusions: string | null;
  readonly timeline: string | null;
  readonly terms: string | null;
  readonly items: ReadonlyArray<{
    readonly serviceName: string;
    readonly description: string | null;
    readonly quantity: string;
    readonly lineTotalMinor: string;
  }>;
  readonly acceptedAt: string | null;
}

interface Fetched {
  readonly data?: PublicProposal;
  readonly error?: string;
}

/**
 * Minimal customer-facing view of a published commercials version.
 * Reads the public token from the URL path and calls the unauthenticated
 * `/api/public/proposals/:token` endpoint. No session is required.
 */
export function PublicProposalPage({ token }: { token: string }): React.JSX.Element {
  const [state, setState] = useState<Fetched>({});

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/proposals/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? `Proposal unavailable (status ${res.status}).`);
        }
        return (await res.json()) as { data: PublicProposal };
      })
      .then((body) => {
        if (!cancelled) setState({ data: body.data });
      })
      .catch((cause: Error) => {
        if (!cancelled) setState({ error: cause.message });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.error) {
    return (
      <div className="mx-auto max-w-xl p-8 text-center text-app-foreground">
        <h1 className="font-display text-2xl font-bold">Proposal unavailable</h1>
        <p className="mt-3 text-sm text-app-muted">{state.error}</p>
      </div>
    );
  }
  if (!state.data) {
    return (
      <div className="mx-auto max-w-xl p-8 text-center text-sm text-app-muted">Loading proposal…</div>
    );
  }
  const p = state.data;
  const symbol = currencySymbol(p.currency);

  return (
    <div className="mx-auto max-w-3xl p-6 text-app-foreground sm:p-10">
      <header>
        <p className="text-xs font-bold uppercase tracking-wider text-app-accent">Proposal</p>
        <h1 className="mt-2 font-display text-3xl font-bold">{p.dealTitle}</h1>
        <p className="mt-1 text-sm text-app-muted">
          Version {p.version}
          {p.validityAt ? ` · valid until ${new Date(p.validityAt).toLocaleDateString()}` : ''}
        </p>
      </header>

      <section className="mt-8 rounded-xl border border-app-border p-5">
        <h2 className="font-display text-lg font-bold">Line items</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs font-semibold uppercase text-app-muted">
            <tr>
              <th className="py-2">Service</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border">
            {p.items.map((item, i) => (
              <tr key={i}>
                <td className="py-2">
                  <p className="font-semibold">{item.serviceName}</p>
                  {item.description && (
                    <p className="mt-1 text-xs text-app-muted">{item.description}</p>
                  )}
                </td>
                <td className="py-2 text-right">{item.quantity}</td>
                <td className="py-2 text-right font-semibold">
                  {symbol}
                  {paiseToRupees(BigInt(item.lineTotalMinor))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6 grid gap-3 rounded-xl border border-app-border p-5 text-sm sm:grid-cols-2">
        <Fact label="Subtotal" value={`${symbol}${paiseToRupees(BigInt(p.subtotalMinor))}`} />
        <Fact label="Discount" value={`${symbol}${paiseToRupees(BigInt(p.discountMinor))}`} />
        <Fact label="Tax" value={`${symbol}${paiseToRupees(BigInt(p.taxMinor))}`} />
        <Fact label="Advance expected" value={`${symbol}${paiseToRupees(BigInt(p.advanceMinor))}`} />
        <Fact
          label="Total"
          value={`${symbol}${paiseToRupees(BigInt(p.totalMinor))}`}
          emphasize
        />
      </section>

      {p.scope && <Section label="Scope">{p.scope}</Section>}
      {p.exclusions && <Section label="Exclusions">{p.exclusions}</Section>}
      {p.timeline && <Section label="Timeline">{p.timeline}</Section>}
      {p.terms && <Section label="Terms">{p.terms}</Section>}

      {p.acceptedAt ? (
        <p className="mt-6 rounded-lg bg-emerald-500/15 p-3 text-sm text-emerald-700 dark:text-emerald-300">
          Accepted {new Date(p.acceptedAt).toLocaleString()}
        </p>
      ) : (
        <PublicProposalActions token={token} onAccepted={(at) => setState({ data: { ...p, acceptedAt: at } })} />
      )}
    </div>
  );
}

function PublicProposalActions({ token, onAccepted }: { token: string; onAccepted: (at: string) => void }): React.JSX.Element {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'' | 'accept' | 'question'>('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function accept(): Promise<void> {
    setBusy('accept');
    setError(null);
    try {
      const res = await fetch(`/api/public/proposals/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ comment: comment.trim() || undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as { data?: { acceptedAt: string }; message?: string };
      if (!res.ok) throw new Error(body.message ?? `Request failed (status ${res.status}).`);
      if (body.data?.acceptedAt) onAccepted(body.data.acceptedAt);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to accept.');
    } finally {
      setBusy('');
    }
  }

  async function sendQuestion(): Promise<void> {
    if (!comment.trim()) {
      setError('Please share your question or change request before sending.');
      return;
    }
    setBusy('question');
    setError(null);
    try {
      const res = await fetch(`/api/public/proposals/${encodeURIComponent(token)}/question`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ comment: comment.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Request failed (status ${res.status}).`);
      }
      setSent('Thanks — we received your note and will respond shortly.');
      setComment('');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to send.');
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-app-border p-5">
      <h2 className="font-display text-lg font-bold">Your response</h2>
      <p className="mt-1 text-xs text-app-muted">
        Accept to confirm the proposal, or send a question / change request for the team to review.
      </p>
      <label className="mt-3 block text-xs font-semibold text-app-muted">
        <span className="mb-1 block">Comment (optional for accept, required for a question)</span>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
          className="w-full rounded-lg border border-app-border bg-app-background p-2 text-sm"
          placeholder="Share any notes, questions, or requested changes."
        />
      </label>
      {error && <p className="mt-3 text-sm text-app-danger">{error}</p>}
      {sent && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{sent}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy !== ''}
          onClick={() => void accept()}
          className="rounded-lg bg-app-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy === 'accept' ? 'Accepting…' : 'Accept proposal'}
        </button>
        <button
          type="button"
          disabled={busy !== ''}
          onClick={() => void sendQuestion()}
          className="rounded-lg border border-app-border px-4 py-2 text-sm font-semibold disabled:opacity-60"
        >
          {busy === 'question' ? 'Sending…' : 'Request changes'}
        </button>
      </div>
    </section>
  );
}

function Fact({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }): React.JSX.Element {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">{label}</p>
      <p className={`mt-1 ${emphasize ? 'font-display text-xl font-bold' : 'font-semibold'}`}>
        {value}
      </p>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="mt-6">
      <h2 className="font-display text-lg font-bold">{label}</h2>
      <p className="mt-2 whitespace-pre-wrap text-sm">{children}</p>
    </section>
  );
}
