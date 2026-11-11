import { useState } from 'react';
import { SocialPlatformAnalyticsPanel } from './SocialPanels.js';
import { SearchConsolePerformance } from './SearchConsolePerformance.js';

type AnalyticsView = 'search' | 'social';

export function SocialAnalyticsPanel({
  clientId,
  timezone,
  canManage,
  canManageIntegrations,
  onManageConnections,
}: {
  clientId: string;
  timezone: string;
  canManage: boolean;
  canManageIntegrations: boolean;
  onManageConnections: () => void;
}): React.JSX.Element {
  const [view, setView] = useState<AnalyticsView>('search');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-app-border/70 bg-app-surface p-2 shadow-sm">
        <div className="flex items-center gap-1" role="tablist" aria-label="Analytics source">
          {([
            ['search', 'Google Search'],
            ['social', 'Social channels'],
          ] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={view === id} type="button" onClick={() => setView(id)} className={`rounded-xl px-4 py-2.5 text-xs font-semibold transition ${view === id ? 'bg-app-accent text-white shadow-sm' : 'text-app-muted hover:bg-app-surface-raised hover:text-app-foreground'}`}>
              {label}
            </button>
          ))}
        </div>
        <p className="px-2 text-[10px] text-app-muted">{view === 'search' ? 'Search Console reporting · direct Google data' : 'Native social platform analytics'}</p>
      </div>
      {view === 'search' ? (
        <SearchConsolePerformance clientId={clientId} timezone={timezone} canManageIntegrations={canManageIntegrations} onManageConnections={onManageConnections} />
      ) : (
        <SocialPlatformAnalyticsPanel clientId={clientId} timezone={timezone} canManage={canManage} />
      )}
    </div>
  );
}
