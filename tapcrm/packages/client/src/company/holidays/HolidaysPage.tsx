import { useEffect, useState } from 'react';
import { listHolidays, type Holiday } from '../api/holidaysApi.js';

function currentYear(): number {
  return new Date().getFullYear();
}

export function HolidaysPage(): React.JSX.Element {
  const [year, setYear] = useState(currentYear());
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    void (async () => {
      try {
        const { holidays: data } = await listHolidays({ from: `${year}-01-01`, to: `${year}-12-31` });
        setHolidays(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load holidays.');
      } finally {
        setLoading(false);
      }
    })();
  }, [year]);

  function fmtDate(value: string | null): string {
    if (!value) return '—';
    return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
  }

  const active = holidays.filter((h) => h.status === 'active');

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setYear((y) => y - 1)}
          className="rounded-lg border border-app-border px-2.5 py-1.5 text-sm hover:border-app-accent"
          aria-label="Previous year"
        >
          ‹
        </button>
        <span className="min-w-12 text-center text-sm font-semibold">{year}</span>
        <button
          type="button"
          onClick={() => setYear((y) => y + 1)}
          className="rounded-lg border border-app-border px-2.5 py-1.5 text-sm hover:border-app-accent"
          aria-label="Next year"
        >
          ›
        </button>
        <span className="text-xs text-app-muted">
          {active.length} holiday{active.length !== 1 ? 's' : ''}
        </span>
      </div>

      {error && <p className="text-sm text-app-danger">{error}</p>}
      {loading && <p className="text-sm text-app-muted">Loading holidays…</p>}

      {!loading && active.length === 0 && (
        <div className="rounded-2xl border border-app-border bg-app-surface p-8 text-center text-sm text-app-muted">
          No holidays for {year}.
        </div>
      )}

      {active.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-app-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app-border text-left">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Date</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Holiday</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Type</th>
              </tr>
            </thead>
            <tbody>
              {active
                .sort((a, b) => (a.holidayDate ?? '').localeCompare(b.holidayDate ?? ''))
                .map((holiday) => (
                  <tr key={holiday.id} className="border-b border-app-border last:border-0 hover:bg-app-surface-raised">
                    <td className="px-4 py-3 tabular-nums text-app-muted">{fmtDate(holiday.holidayDate)}</td>
                    <td className="px-4 py-3 font-medium">{holiday.name}</td>
                    <td className="px-4 py-3 capitalize text-app-muted">{holiday.type}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
