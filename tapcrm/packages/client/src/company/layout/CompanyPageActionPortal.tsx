import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useCompanyHeroPageActions } from './CompanyNavbarContext.js';

/**
 * Moves an existing page action into the desktop hero capsule without changing
 * its handler, while the normal page header keeps the action on smaller screens.
 */
export function CompanyPageActionPortal({ children }: { readonly children: ReactNode }): React.JSX.Element | null {
  const { target } = useCompanyHeroPageActions();

  if (!target) return null;
  return createPortal(
    <div className="company-page-hero-actions hidden shrink-0 items-center gap-2 xl:flex">{children}</div>,
    target,
  );
}
