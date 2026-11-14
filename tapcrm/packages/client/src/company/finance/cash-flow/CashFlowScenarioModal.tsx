import { useState } from 'react';
import { Button, Field, Modal, Notice } from '../../../ui/components.js';
import type { Snapshot } from './cashFlowApi.js';

interface Adjustment { bucketNumber: string; inflowDelta: string; outflowDelta: string; note: string; }
const money = /^-?\d+(\.\d{1,2})?$/;

export function CashFlowScenarioModal({ snapshot, onClose, onSubmit }: { snapshot: Snapshot; onClose: () => void; onSubmit: (body: Record<string, unknown>) => Promise<void> }): React.JSX.Element {
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (index: number, key: keyof Adjustment, value: string) => setAdjustments((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  const validate = (): string | null => {
    if (name.trim().length < 2) return 'Scenario name must contain at least two characters.';
    if (reason.trim().length < 3) return 'A reason of at least three characters is required.';
    const seen = new Set<number>();
    for (const adjustment of adjustments) {
      const bucket = Number(adjustment.bucketNumber);
      if (!Number.isInteger(bucket) || bucket < 1 || bucket > snapshot.horizonWeeks) return `Forecast week must be between 1 and ${snapshot.horizonWeeks}.`;
      if (seen.has(bucket)) return `Forecast week ${bucket} is listed more than once.`;
      seen.add(bucket);
      if (!money.test(adjustment.inflowDelta) || !money.test(adjustment.outflowDelta)) return 'Inflow and outflow adjustments must be valid amounts with up to two decimals.';
      if (adjustment.note.trim().length < 2) return 'Each adjustment needs a note of at least two characters.';
    }
    return null;
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setSaving(true); setError('');
    try { await onSubmit({ name: name.trim(), snapshotId: snapshot.id, baseCurrency: snapshot.baseCurrency, adjustments: adjustments.map((item) => ({ bucketNumber: Number(item.bucketNumber), inflowDelta: item.inflowDelta, outflowDelta: item.outflowDelta, note: item.note.trim() })), reason: reason.trim() }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create scenario.'); }
    finally { setSaving(false); }
  };
  return <Modal title="Create cash-flow scenario" onClose={onClose} size="lg" footer={<div className="flex justify-end gap-2"><Button kind="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="cash-flow-scenario-form" disabled={saving}>{saving ? 'Creating…' : 'Create scenario'}</Button></div>}><form id="cash-flow-scenario-form" onSubmit={(event) => void submit(event)} className="space-y-5">{error && <Notice error>{error}</Notice>}<p className="text-sm text-app-muted">Build a read-only advisory scenario from the {snapshot.baseCurrency} forecast dated {snapshot.asOfDate}. Adjustments affect projections only.</p><Field label="Scenario name" required value={name} onChange={setName} placeholder="Example: Delayed collections" /><div className="space-y-3"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Weekly adjustments</h3><Button kind="secondary" onClick={() => setAdjustments((current) => [...current, { bucketNumber: String(current.length + 1), inflowDelta: '0', outflowDelta: '0', note: '' }])} disabled={adjustments.length >= snapshot.horizonWeeks}>Add week</Button></div>{adjustments.length === 0 ? <p className="text-xs text-app-muted">No adjustments means the scenario uses the base forecast unchanged.</p> : adjustments.map((adjustment, index) => <div className="grid gap-3 rounded-xl border border-app-border p-3 sm:grid-cols-2" key={`${index}-${adjustment.bucketNumber}`}><Field label="Forecast week" required type="number" value={adjustment.bucketNumber} onChange={(value) => update(index, 'bucketNumber', value)} /><Field label="Note" required value={adjustment.note} onChange={(value) => update(index, 'note', value)} /><Field label="Inflow adjustment" required type="number" value={adjustment.inflowDelta} onChange={(value) => update(index, 'inflowDelta', value)} hint="Use a negative value to reduce inflow." /><Field label="Outflow adjustment" required type="number" value={adjustment.outflowDelta} onChange={(value) => update(index, 'outflowDelta', value)} hint="Use a negative value to reduce outflow." /><Button kind="secondary" onClick={() => setAdjustments((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove week</Button></div>)}</div><Field label="Reason" required value={reason} onChange={setReason} placeholder="Explain the planning assumption" hint="This reason is retained in the audit log." /></form></Modal>;
}
