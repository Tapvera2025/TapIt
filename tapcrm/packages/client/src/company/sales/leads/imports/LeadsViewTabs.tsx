import { LiquidGlassTabs } from '../../../recruitment/components/RecruitmentTabs.js';
import { IMPORTED_LEADS_PATH } from './import-format.js';

/** The Leads page's two views: every lead, or the ones brought in by imports. */
export function LeadsViewTabs({ active, onNavigate }: { active: 'all' | 'imported'; onNavigate: (path: string) => void }): React.JSX.Element {
  return (
    <LiquidGlassTabs
      ariaLabel="Lead views"
      activeId={active}
      onNavigate={onNavigate}
      items={[
        { id: 'all', label: 'All leads', path: '/company/sales/leads', iconName: 'users' },
        { id: 'imported', label: 'Imported leads', path: IMPORTED_LEADS_PATH, iconName: 'upload' },
      ]}
    />
  );
}
