import { useEffect, useState } from 'react';
import {
  approveCorrection,
  listCorrections,
  rejectCorrection,
  type CorrectionListItem,
} from './attendanceApi.js';
import { Button, Notice } from '../../ui/components.js';

type Filter = 'pending' | 'approved' | 'rejected' | 'all';

const KIND_LABEL: Record<CorrectionListItem['kind'], string> = {
  'add-event': 'Add punch',
  'replace-event': 'Change punch',
  'void-event': 'Remove punch',
  'confirm-as-is': 'Confirm as is',
};

const EVENT_LABEL: Record<string, string> = {
  in: 'In',
  out: 'Out',
  'break-start': 'Break start',
  'break-end': 'Break end',
};

function time(value: string | undefined | null): string {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function describe(item: CorrectionListItem): string {
  const kind = KIND_LABEL[item.kind];
  const event = item.payload.kind ? `${EVENT_LABEL[item.payload.kind] ?? item.payload.kind}` : '';
  const at = time(item.payload.at);
  return [kind, event && `· ${event}`, at && `at ${at}`].filter(Boolean).join(' ');
}

export function CorrectionsPage(): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('pending');
  const [rows, setRows] = useState<CorrectionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function load(): Promise<void> {
    setLoading(true);
    try {
      setRows((await listCorrections({ status: filter })).corrections);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load corrections.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [filter]);

  async function decide(item: CorrectionListItem, approve: boolean): Promise<void> {
    setBusy(item.id);
    setNotice(null);
    try {
      const note = notes[item.id]?.trim() || undefined;
      if (approve) await approveCorrection(item.id, note);
      else await rejectCorrection(item.id, note);
      setNotice(`${approve ? 'Approved' : 'Rejected'}: ${item.userName}, ${item.workDate}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to decide this correction.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap gap-2">
        {(['pending', 'approved', 'rejected', 'all'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold capitalize ${filter === key ? 'bg-app-accent text-app-on-accent' : 'border border-app-border text-app-muted hover:text-app-foreground'}`}
          >
            {key}
          </button>
        ))}
      </div>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {loading ? (
        <p className="text-sm text-app-muted">Loading corrections…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-app-border bg-app-surface p-8 text-center text-sm text-app-muted">
          {filter === 'pending' ? 'No corrections are waiting for a decision.' : 'Nothing here yet.'}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((item) => (
            <div key={item.id} className="rounded-2xl border border-app-border bg-app-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{item.userName} · {item.workDate}</p>
                  <p className="mt-0.5 text-sm">{describe(item)}</p>
                  <p className="mt-1 text-xs text-app-muted">“{item.reason}”</p>
                  <p className="mt-1 text-xs text-app-muted">
                    Requested by {item.requestedByName} · {new Date(item.requestedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                  {item.status !== 'pending' && (
                    <p className="mt-1 text-xs text-app-muted">
                      {item.status === 'approved' ? 'Approved' : 'Rejected'} by {item.decidedByName ?? '—'}
                      {item.decisionNote ? ` — ${item.decisionNote}` : ''}
                    </p>
                  )}
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${item.status === 'approved' ? 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-200' : item.status === 'rejected' ? 'bg-rose-500/12 text-rose-800 dark:text-rose-200' : 'bg-amber-500/14 text-amber-800 dark:text-amber-200'}`}>
                  {item.status}
                </span>
              </div>
              {item.canDecide && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    value={notes[item.id] ?? ''}
                    onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                    placeholder="Note (optional)"
                    className="min-w-[14rem] flex-1 rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm"
                  />
                  <Button disabled={busy !== null} onClick={() => void decide(item, true)}>
                    {busy === item.id ? 'Saving…' : 'Approve'}
                  </Button>
                  <Button kind="danger" disabled={busy !== null} onClick={() => void decide(item, false)}>
                    Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
