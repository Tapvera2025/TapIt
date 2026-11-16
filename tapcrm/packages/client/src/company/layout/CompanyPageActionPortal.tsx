import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useCompanyHeroPageActions } from './CompanyNavbarContext.js';

/**
 * Moves an existing page action into the desktop hero capsule without changing
 * its handler, while the normal page header keeps the action on smaller screens.
 */
export function CompanyPageActionPortal({
  children,
  mobileClassName = '',
}: {
  readonly children: ReactNode;
  readonly mobileClassName?: string | undefined;
}): React.JSX.Element | null {
  const { target } = useCompanyHeroPageActions();

  return (
    <>
      <div className={`company-page-action-mobile xl:hidden ${mobileClassName}`}>{children}</div>
      {target && createPortal(
        <div className="company-page-hero-actions hidden shrink-0 items-center gap-2 xl:flex">{children}</div>,
        target,
      )}
    </>
  );
}
