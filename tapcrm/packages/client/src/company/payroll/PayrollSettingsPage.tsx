import { useCallback, useEffect, useState } from 'react';
import {
  acceptConfig,
  formatDate,
  formatMonth,
  listConfigs,
  type PayrollConfig,
} from '../api/payrollApi.js';
import { Button, Card, Notice, Page, SkeletonTable } from '../../ui/components.js';

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const STATUS_LABELS: Record<PayrollConfig['status'], string> = {
  active: 'In use',
  superseded: 'Replaced',
  voided: 'Voided',
};

export function PayrollSettingsPage(): React.JSX.Element {
  const [configs, setConfigs] = useState<PayrollConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [month, setMonth] = useState(thisMonth());
  const [approval, setApproval] = useState('');
  const [payDay, setPayDay] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setConfigs((await listConfigs()).configs);
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Unable to load payroll settings.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const effectiveFrom = `${month}-01`;
  const replacing = configs.find((c) => c.status === 'active' && c.effectiveFrom === effectiveFrom) ?? null;
  const inUse = configs
    .filter((c) => c.status === 'active')
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0] ?? null;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const settings: Record<string, unknown> = { currency: 'INR' };
      if (payDay.trim()) settings['payDay'] = Number(payDay);
      if (notes.trim()) settings['notes'] = notes.trim();
      await acceptConfig({
        effectiveFrom,
        caHrApproval: approval.trim(),
        settings,
        supersedesConfigId: replacing?.id ?? null,
      });
      setNotice(
        replacing
          ? `Settings for ${formatMonth(effectiveFrom)} replaced.`
          : `Settings accepted, effective ${formatMonth(effectiveFrom)}. Payroll can now be run for that month and later.`,
      );
      setShowForm(false);
      setApproval('');
      setNotes('');
      setPayDay('');
      await load();
    } catch (err) {
      setError(errorText(err, 'Unable to accept the settings.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      eyebrow="Payroll"
      title="Payroll settings"
      description="Payroll runs only for months covered by accepted settings. Accepted settings are kept as evidence and never edited: to change them, accept new settings from a month on."
      action={!showForm && <Button onClick={() => setShowForm(true)}>Accept settings</Button>}
    >
      {!loading && configs.length === 0 && !showForm && (
        <div className="mt-6">
          <Notice error>No payroll settings are accepted yet, so no payroll run can be created. Accept settings to get started.</Notice>
        </div>
      )}
      {inUse && (
        <Card className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-app-muted">In use</p>
          <p className="mt-1 text-lg font-semibold">From {formatMonth(inUse.effectiveFrom)}</p>
          <p className="text-sm text-app-muted">Approved by {inUse.caHrApproval}</p>
        </Card>
      )}
      {showForm && (
        <Card className="mt-6">
          <form onSubmit={(e) => void submit(e)} className="grid gap-4 md:grid-cols-2">
            <label className="text-xs font-semibold text-app-muted">
              <span className="mb-2 block">Applies from month</span>
              <input
                type="month"
                required
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
              />
            </label>
            <label className="text-xs font-semibold text-app-muted">
              <span className="mb-2 block">Approved by (CA / HR, with reference)</span>
              <input
                required
                value={approval}
                placeholder="e.g. CA R. Mehta, email of 12 Sep 2026"
                onChange={(e) => setApproval(e.target.value)}
                className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
              />
            </label>
            <label className="text-xs font-semibold text-app-muted">
              <span className="mb-2 block">Pay day (optional)</span>
              <input
                inputMode="numeric"
                value={payDay}
                placeholder="e.g. 1"
                onChange={(e) => setPayDay(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
              />
            </label>
            <label className="text-xs font-semibold text-app-muted">
              <span className="mb-2 block">Notes (optional)</span>
              <input
                value={notes}
                placeholder="e.g. PF at 12% of basic, professional tax as per Maharashtra slab"
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
              />
            </label>
            {replacing && (
              <div className="md:col-span-2">
                <Notice>Settings for {formatMonth(effectiveFrom)} are already accepted. Saving replaces them; the earlier version stays on record.</Notice>
              </div>
            )}
            <div className="flex gap-2 md:col-span-2">
              <Button type="submit" disabled={busy || approval.trim() === ''}>{busy ? 'Saving…' : replacing ? 'Replace settings' : 'Accept settings'}</Button>
              <Button kind="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}
      {notice && <div className="mt-4"><Notice>{notice}</Notice></div>}
      {error && <div className="mt-4"><Notice error>{error}</Notice></div>}
      {loading && <div className="mt-6"><SkeletonTable columns={5} rows={5} /></div>}
      {configs.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-app-border bg-app-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app-border text-left text-xs uppercase tracking-wider text-app-muted">
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">Approved by</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3">Accepted</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {configs.map((config) => (
                <tr key={config.id} className={`border-b border-app-border last:border-0 ${config.status !== 'active' ? 'text-app-muted' : ''}`}>
                  <td className="px-4 py-3 font-medium">{formatMonth(config.effectiveFrom)}</td>
                  <td className="px-4 py-3">{config.caHrApproval}</td>
                  <td className="px-4 py-3 text-xs">
                    {typeof config.settings['notes'] === 'string' ? config.settings['notes'] : '—'}
                    {typeof config.settings['payDay'] === 'number' && <span className="block">Pay day: {String(config.settings['payDay'])}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">{config.acceptedByName ?? '—'}, {formatDate(config.acceptedAt)}</td>
                  <td className="px-4 py-3 text-xs">{STATUS_LABELS[config.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
