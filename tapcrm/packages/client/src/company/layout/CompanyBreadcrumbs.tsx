import { useLayoutEffect, useRef } from 'react';
import { Icon } from '../../ui/index.js';
import type { Crumb } from './breadcrumbs.js';
import './breadcrumbs.css';

/**
 * Where the user is, as a trail they can walk back along. Pure view: the trail
 * comes from `breadcrumbTrail`, which derives it from the sidebar's own menu.
 */
export function CompanyBreadcrumbs({
  crumbs,
  onNavigate,
}: {
  readonly crumbs: readonly Crumb[];
  readonly onNavigate: (path: string) => void;
}): React.JSX.Element | null {
  const listRef = useRef<HTMLOListElement>(null);
  // On a phone a long trail scrolls sideways; start at the end, where the current page is.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollLeft = list.scrollWidth;
  }, [crumbs]);
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="company-breadcrumbs">
      <ol ref={listRef}>
        {crumbs.map((crumb, index) => (
          <li key={`${index}-${crumb.label}`}>
            {index > 0 && <Icon name="chevron-right" className="company-crumb-sep" />}
            {crumb.current ? (
              <span className="company-crumb is-current" aria-current="page" title={crumb.label}>
                {crumb.label}
              </span>
            ) : crumb.path ? (
              <button
                type="button"
                className="company-crumb is-link"
                onClick={() => onNavigate(crumb.path!)}
                title={crumb.label}
              >
                {crumb.icon === 'home' ? (
                  <>
                    <Icon name="home" className="company-crumb-home" />
                    <span className="sr-only">{crumb.label}</span>
                  </>
                ) : (
                  crumb.label
                )}
              </button>
            ) : (
              // A section, not a page: shown for context, not clickable.
              <span className="company-crumb" title={crumb.label}>
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
