import { useCompanyHeroPageActions, useCompanyHeroUtility, useCompanyPageMetadataValue } from './CompanyNavbarContext.js';
import { useEffect, useRef } from 'react';

export function CompanyHeroUtilityCapsule(): React.JSX.Element {
  const { setTarget } = useCompanyHeroUtility();
  const { setTarget: setPageActionTarget } = useCompanyHeroPageActions();
  const page = useCompanyPageMetadataValue();
  const capsuleRef = useRef<HTMLDivElement>(null);
  const previousSizeRef = useRef<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const capsule = capsuleRef.current;
    if (!capsule) return;

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      const previous = previousSizeRef.current;
      previousSizeRef.current = next;
      if (!previous || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (Math.abs(next.width - previous.width) < 1 && Math.abs(next.height - previous.height) < 1) return;

      capsule.getAnimations().forEach((animation) => animation.cancel());
      capsule.animate(
        [
          {
            transform: `translateZ(0) scale(${Math.max(0.82, previous.width / next.width)}, ${Math.max(0.82, previous.height / next.height)})`,
            opacity: 0.92,
          },
          { transform: 'translateZ(0) scale(1.015, 1.02)', opacity: 1, offset: 0.72 },
          { transform: 'translateZ(0) scale(1, 1)', opacity: 1 },
        ],
        { duration: 430, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    });

    observer.observe(capsule);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={capsuleRef} className="company-hero-capsule">
      {page?.extension}
      <div ref={setPageActionTarget} className="company-hero-capsule-page-actions" />
      <div ref={setTarget} className="company-hero-capsule-controls" />
    </div>
  );
}
