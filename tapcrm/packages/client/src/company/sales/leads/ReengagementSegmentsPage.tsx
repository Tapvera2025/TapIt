import { useEffect, useState } from 'react';
import { Button, Card, Page } from '../../../ui/components.js';
import { getReengagementSegments, type ReengagementSegments } from './api.js';

export function ReengagementSegmentsPage({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [data, setData] = useState<ReengagementSegments | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void getReengagementSegments().then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load re-engagement segments.')); }, []);
  return <Page eyebrow="Sales" title="Re-engagement segments" description="Aggregate closed-lost patterns for future outreach. Individual leads and contact details are not exposed here." action={<Button kind="secondary" onClick={onBack}>Back to leads</Button>}>
    {error && <p className="mb-4 rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger">{error}</p>}
    <Card><p className="text-sm text-app-muted">Closed-lost leads represented: <strong className="text-app-foreground">{data?.total ?? '—'}</strong></p><div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-app-border text-xs text-app-muted"><th className="p-3">Source</th><th className="p-3">Campaign</th><th className="p-3">Loss reason</th><th className="p-3">Lost date</th><th className="p-3 text-right">Count</th></tr></thead><tbody>{data?.segments.map((segment) => <tr key={`${segment.sourceName}-${segment.campaignName}-${segment.lossReason}-${segment.lostDate}`} className="border-b border-app-border"><td className="p-3">{segment.sourceName}</td><td className="p-3">{segment.campaignName ?? '—'}</td><td className="p-3">{segment.lossReason.replaceAll('_', ' ')}</td><td className="p-3">{segment.lostDate}</td><td className="p-3 text-right font-semibold">{segment.count}</td></tr>)}</tbody></table>{data?.segments.length === 0 && <p className="p-6 text-sm text-app-muted">No closed-lost segments are available.</p>}</div></Card>
  </Page>;
}
