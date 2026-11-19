import type { CompanyNavGroup } from './navigation.js';
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface CompanyPageMetadata {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly extension?: ReactNode;
}

interface CompanyNavbarContextValue {
  readonly page: CompanyPageMetadata;
  readonly setPage: (page: CompanyPageMetadata) => void;
  readonly resetPage: () => void;
  readonly utilityTarget: HTMLElement | null;
  readonly setUtilityTarget: (target: HTMLElement | null) => void;
  readonly pageActionTarget: HTMLElement | null;
  readonly setPageActionTarget: (target: HTMLElement | null) => void;
  /** The menu the sidebar is showing, published so the breadcrumb can mirror it. */
  readonly navigation: readonly CompanyNavGroup[];
  readonly setNavigation: (groups: readonly CompanyNavGroup[]) => void;
}

const CompanyNavbarContext = createContext<CompanyNavbarContextValue | null>(null);

export function CompanyNavbarProvider({
  initialPage,
  children,
}: {
  readonly initialPage: CompanyPageMetadata;
  readonly children: ReactNode;
}): React.JSX.Element {
  const [page, setPage] = useState(initialPage);
  const [utilityTarget, setUtilityTarget] = useState<HTMLElement | null>(null);
  const [pageActionTarget, setPageActionTarget] = useState<HTMLElement | null>(null);
  const [navigation, setNavigation] = useState<readonly CompanyNavGroup[]>([]);
  const previousInitialPageRef = useRef(initialPage);

  // Keep the shared shell mounted while routes change. Re-mounting this
  // provider used to recreate the sidebar as well, which reset its own
  // independently managed scroll position back to the top on every click.
  useLayoutEffect(() => {
    const previousInitialPage = previousInitialPageRef.current;
    if (previousInitialPage === initialPage) return;

    // A page such as Dashboard can register hero actions during its layout
    // effect. Only replace the shell default when no page-specific metadata
    // has claimed the hero; otherwise the delayed default reset hides actions
    // like Customize until a later render.
    setPage((current) => current === previousInitialPage ? initialPage : current);
    previousInitialPageRef.current = initialPage;
  }, [initialPage]);

  const resetPage = useCallback(() => setPage(initialPage), [initialPage]);

  const value = useMemo<CompanyNavbarContextValue>(() => ({
    page,
    setPage,
    resetPage,
    utilityTarget,
    setUtilityTarget,
    pageActionTarget,
    setPageActionTarget,
    navigation,
    setNavigation,
  }), [resetPage, page, utilityTarget, pageActionTarget, navigation]);

  return <CompanyNavbarContext.Provider value={value}>{children}</CompanyNavbarContext.Provider>;
}

/** Register page-specific desktop hero content while the page is mounted. */
export function useCompanyPageMetadata(page: CompanyPageMetadata): void {
  const context = useContext(CompanyNavbarContext);
  const setPage = context?.setPage;
  const resetPage = context?.resetPage;

  useLayoutEffect(() => {
    if (!setPage || !resetPage) return;
    setPage(page);
    return () => resetPage();
  }, [setPage, resetPage, page]);
}

export function useCompanyPageMetadataValue(): CompanyPageMetadata | null {
  return useContext(CompanyNavbarContext)?.page ?? null;
}

export function useCompanyHeroUtility() {
  const context = useContext(CompanyNavbarContext);
  return { target: context?.utilityTarget ?? null, setTarget: context?.setUtilityTarget };
}

/** Dedicated desktop slot for the current page's primary actions. */
export function useCompanyHeroPageActions() {
  const context = useContext(CompanyNavbarContext);
  return { target: context?.pageActionTarget ?? null, setTarget: context?.setPageActionTarget };
}

/** The sidebar publishes the menu it renders; a no-op outside a provider (e.g. the client portal). */
export function useRegisterNavigation(groups: readonly CompanyNavGroup[]): void {
  const setNavigation = useContext(CompanyNavbarContext)?.setNavigation;
  useLayoutEffect(() => {
    setNavigation?.(groups);
  }, [setNavigation, groups]);
}

/** The menu the sidebar is showing right now (empty until it has rendered once). */
export function useRegisteredNavigation(): readonly CompanyNavGroup[] {
  return useContext(CompanyNavbarContext)?.navigation ?? [];
}
