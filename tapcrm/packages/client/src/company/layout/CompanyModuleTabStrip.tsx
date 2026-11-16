import type { ReactNode } from 'react';
import {
  LiquidGlassTabs,
  type LiquidGlassTabItem,
} from '../recruitment/components/RecruitmentTabs.js';

interface CompanyModuleTabStripProps {
  readonly items: readonly LiquidGlassTabItem[];
  readonly activeId: string;
  readonly onNavigate: (path: string) => void;
  readonly ariaLabel: string;
  readonly children: ReactNode;
}

/**
 * Desktop-only section navigation shared by workspace modules.
 * The mobile shell keeps its existing navigation and page flow unchanged.
 */
export function CompanyModuleTabStrip({
  items,
  activeId,
  onNavigate,
  ariaLabel,
  children,
}: CompanyModuleTabStripProps): React.JSX.Element {
  return (
    <div className="w-full max-w-full overflow-x-hidden">
      {items.length > 1 && (
        <div className="hidden w-full max-w-full px-4 pt-8 xl:block xl:px-8 xl:pt-10">
          <div className="mx-auto max-w-7xl">
            <LiquidGlassTabs
              items={items}
              activeId={activeId}
              onNavigate={onNavigate}
              ariaLabel={ariaLabel}
            />
          </div>
        </div>
      )}
      <div className="recruitment-route-transition xl:mt-6">{children}</div>
    </div>
  );
}
