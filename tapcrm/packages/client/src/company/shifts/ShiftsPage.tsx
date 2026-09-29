import { useEffect, useState } from 'react';
import { listShifts, createShift, type ShiftTemplate } from '../api/shiftsApi.js';

function fmtTime(value: string | null): string {
  if (!value) return '—';
  return value.slice(0, 5);
}

export function ShiftsPage(): React.JSX.Element {
  const [shifts, setShifts] = useState<ShiftTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'fixed' | 'flexible'>('fixed');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [graceMinutes, setGraceMinutes] = useState('');
  const [fullDayMinutes, setFullDayMinutes] = useState('');
  const [halfDayMinutes, setHalfDayMinutes] = useState('');

  function load(): void {
    setLoading(true);
    listShifts()
      .then((data) => { setShifts(data); setLoading(false); })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load shifts.');
        setLoading(false);
      });
  }

  useEffect(() => { load(); }, []);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!code.trim() || !name.trim()) { setFormError('Code and name are required.'); return; }
    setSubmitting(true);
    setFormError(null);
    try {
      await createShift({
        code: code.trim(),
        name: name.trim(),
        kind,
        version: {
          ...(effectiveFrom ? { effectiveFrom } : {}),
          ...(startTime ? { startTime } : {}),
          ...(endTime ? { endTime } : {}),
          ...(graceMinutes ? { graceMinutes: Number(graceMinutes) } : {}),
          ...(fullDayMinutes ? { fullDayMinutes: Number(fullDayMinutes) } : {}),
          ...(halfDayMinutes ? { halfDayMinutes: Number(halfDayMinutes) } : {}),
        },
      });
      setShowForm(false);
      setCode(''); setName(''); setKind('fixed'); setEffectiveFrom('');
      setStartTime(''); setEndTime(''); setGraceMinutes(''); setFullDayMinutes(''); setHalfDayMinutes('');
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create shift.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Shift Templates</h2>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-app-accent px-3 py-1.5 text-xs font-semibold text-app-on-accent"
          >
            New shift
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={(e) => void handleSubmit(e)} className="rounded-2xl border border-app-border bg-app-surface p-5 space-y-4">
          <p className="text-sm font-semibold">New shift template</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-app-muted">Code</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="MORNING"
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-app-muted">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Morning Shift"
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-app-muted">Kind</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as 'fixed' | 'flexible')}
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              >
                <option value="fixed">Fixed</option>
                <option value="flexible">Flexible</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-app-muted">Effective from</label>
              <input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              />
            </div>
            {kind === 'fixed' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-app-muted">Start time</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-app-muted">End time</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-app-muted">Grace minutes</label>
                  <input
                    type="number"
                    value={graceMinutes}
                    onChange={(e) => setGraceMinutes(e.target.value)}
                    min="0"
                    className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
                  />
                </div>
              </>
            )}
            <div>
              <label className="block text-xs font-semibold text-app-muted">Full-day minutes</label>
              <input
                type="number"
                value={fullDayMinutes}
                onChange={(e) => setFullDayMinutes(e.target.value)}
                min="0"
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-app-muted">Half-day minutes</label>
              <input
                type="number"
                value={halfDayMinutes}
                onChange={(e) => setHalfDayMinutes(e.target.value)}
                min="0"
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              />
            </div>
          </div>
          {formError && <p className="text-xs text-app-danger">{formError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-app-accent px-4 py-2 text-sm font-semibold text-app-on-accent disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create shift'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setFormError(null); }}
              className="rounded-lg border border-app-border px-4 py-2 text-sm text-app-muted hover:border-app-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p className="text-sm text-app-danger">{error}</p>}
      {loading && <p className="text-sm text-app-muted">Loading shifts…</p>}

      {!loading && shifts.length === 0 && (
        <div className="rounded-2xl border border-app-border bg-app-surface p-8 text-center text-sm text-app-muted">
          No shift templates yet.
        </div>
      )}

      {shifts.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-app-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app-border text-left">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Code</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Name</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Kind</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Hours</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Status</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((shift) => (
                <tr key={shift.id} className="border-b border-app-border last:border-0 hover:bg-app-surface-raised">
                  <td className="px-4 py-3 font-mono text-xs">{shift.code}</td>
                  <td className="px-4 py-3 font-medium">{shift.name}</td>
                  <td className="px-4 py-3 capitalize text-app-muted">{shift.kind}</td>
                  <td className="px-4 py-3 tabular-nums text-app-muted">
                    {shift.startTime && shift.endTime
                      ? `${fmtTime(shift.startTime)}–${fmtTime(shift.endTime)}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${shift.status === 'active' ? 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-200' : 'bg-app-surface-raised text-app-muted'}`}>
                      {shift.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
