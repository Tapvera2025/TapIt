import { Button, Modal } from '../../../ui/components.js';
import type { AdvertisingSpend } from './profitabilityApi.js';

export interface ProfitabilityDetail {
  label: string;
  value: React.ReactNode;
}

export function AdvertisingSpendHistory({ spends }: { spends: AdvertisingSpend[] }): React.JSX.Element {
  if (!spends.length) return <span className="text-app-muted">No spend records yet.</span>;
  return <div className="w-full space-y-2">{spends.map((spend) => <div className="rounded-lg border border-app-border p-2 text-xs" key={spend.id}><div className="flex justify-between gap-2 font-semibold"><span>{spend.campaignName || 'Unassigned campaign'}</span><span>{spend.amount} {spend.currency}</span></div><div className="mt-1 text-app-muted">{spend.spendDate} · reference {spend.externalSpendId}</div><div className="mt-1 text-app-muted">{spend.projectName ?? 'No project'}{spend.clientName ? ` · ${spend.clientName}` : ''}</div></div>)}</div>;
}

export function ProfitabilityDetailModal({ title, details, onClose }: { title: string; details: ProfitabilityDetail[]; onClose: () => void }): React.JSX.Element {
  return <Modal title={title} onClose={onClose} size="md" footer={<div className="flex justify-end"><Button kind="secondary" onClick={onClose}>Close</Button></div>}><div className="grid gap-4 sm:grid-cols-2">{details.map((detail) => <div key={detail.label} className="rounded-xl border border-app-border bg-app-surface-raised/40 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-app-muted">{detail.label}</p><p className="mt-1 break-words text-sm font-semibold text-app-foreground">{detail.value || '—'}</p></div>)}</div></Modal>;
}
