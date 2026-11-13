import { Icon } from '../ui/index.js';
import { SocialPlatformAnalyticsPanel } from './SocialPanels.js';

/**
 * Native analytics for the client's social channels. Google Search (Search
 * Console) reporting is about a website, so it lives in the SEO dashboard:
 * Search visibility → Search Console report.
 */
export function SocialAnalyticsPanel({
  clientId,
  timezone,
  canManage,
  onOpenSeoDashboard,
}: {
  clientId: string;
  timezone: string;
  canManage: boolean;
  onOpenSeoDashboard?: () => void;
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <SocialPlatformAnalyticsPanel clientId={clientId} timezone={timezone} canManage={canManage} />
      {onOpenSeoDashboard && (
        <p className="flex flex-wrap items-center gap-2 px-1 text-xs text-app-muted">
          <Icon name="search" className="size-3.5" />
          Looking for Google Search performance? It is in the SEO dashboard, per website.
          <button type="button" onClick={onOpenSeoDashboard} className="font-semibold text-app-accent hover:underline">
            Open Search Console report
          </button>
        </p>
      )}
    </div>
  );
}
