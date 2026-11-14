import { useCompanyHeroPageActions, useCompanyHeroUtility, useCompanyPageMetadataValue } from './CompanyNavbarContext.js';

export function CompanyHeroUtilityCapsule(): React.JSX.Element {
  const { setTarget } = useCompanyHeroUtility();
  const { setTarget: setPageActionTarget } = useCompanyHeroPageActions();
  const page = useCompanyPageMetadataValue();
  return (
    <div className="company-hero-capsule">
      {page?.extension}
      <div ref={setPageActionTarget} className="company-hero-capsule-page-actions" />
      <div ref={setTarget} className="company-hero-capsule-controls" />
    </div>
  );
}
