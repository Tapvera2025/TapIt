import { useEffect, useState } from 'react';
import { Button, GlassSurface, Icon } from '../../../ui/index.js';
import { ErrorToast } from '../../../ui/ErrorToast.js';
import { ProposalDocument, type ProposalDocumentData } from './ProposalDocument.js';

interface Fetched {
  readonly data?: ProposalDocumentData;
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
    setState({});
    fetch(`/api/public/proposals/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? `Proposal unavailable (status ${res.status}).`);
        }
        return (await res.json()) as { data: ProposalDocumentData };
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
      <GlassSurface className="mx-auto max-w-xl rounded-2xl p-8 text-center text-app-foreground">
        <h1 className="font-display text-2xl font-bold">Proposal unavailable</h1>
        <p className="mt-3 text-sm text-app-muted">{state.error}</p>
      </GlassSurface>
    );
  }
  if (!state.data) {
    return (
      <GlassSurface className="mx-auto max-w-xl rounded-2xl p-8 text-center text-sm text-app-muted">Loading proposal…</GlassSurface>
    );
  }
  const proposal = state.data;
  return (
    <main className="proposal-public-page">
      <div className="proposal-print-toolbar">
        <Button kind="secondary" onClick={() => window.print()}>
          <Icon name="download" className="size-4" /> Print or save as PDF
        </Button>
      </div>
      <ProposalDocument
        proposal={proposal}
        response={<PublicProposalActions token={token} onAccepted={(at) => setState({ data: { ...proposal, acceptedAt: at } })} />}
      />
    </main>
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
    <div className="proposal-document-response">
      <p className="mt-1 text-xs text-[var(--proposal-muted)]">
        Accept to confirm the proposal, or send a question / change request for the team to review.
      </p>
      <label className="mt-3 block text-xs font-semibold text-[var(--proposal-muted)]">
        <span className="mb-1 block">Comment (optional for accept, required for a question)</span>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
          maxLength={2000}
          className="ui-form-control p-2 text-sm"
          placeholder="Share any notes, questions, or requested changes."
        />
      </label>
      {error && <ErrorToast message={error} />}
      {sent && <p className="mt-3 text-sm text-emerald-700">{sent}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          kind="primary"
          disabled={busy !== ''}
          onClick={() => void accept()}
          className="px-4 py-2 text-sm disabled:opacity-60"
        >
          {busy === 'accept' ? 'Accepting…' : 'Accept proposal'}
        </Button>
        <Button
          kind="secondary"
          disabled={busy !== ''}
          onClick={() => void sendQuestion()}
          className="px-4 py-2 text-sm disabled:opacity-60"
        >
          {busy === 'question' ? 'Sending…' : 'Request changes'}
        </Button>
      </div>
    </div>
  );
}
